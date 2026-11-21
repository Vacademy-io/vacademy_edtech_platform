"""Scan Station header read + probe (scan/header_read.py) and the label-template
guard (scan/headers_guard.py). The vision model is stubbed: no network.
"""
from __future__ import annotations

import asyncio
import base64
import json

import pytest

from app.services.copy_check.scan import header_read as hr
from app.services.copy_check.scan import headers_guard as hg
from copy_check_scan_synth import front_page, label_header, paper, question_header, rot180, write_lines


def _strips_in(messages) -> list[bytes]:
    parts = messages[1]["content"]
    return [base64.b64decode(p["image_url"]["url"].split(",", 1)[1]) for p in parts if p["type"] == "image_url"]


class _StubLLM:
    """Answers per strip from `answer(strip_bytes) -> dict`, or from scripted replies."""

    def __init__(self, answer=None, script=None):
        self.answer = answer
        self.script = list(script or [])
        self.calls: list[int] = []

    async def chat_completion(self, messages, temperature, max_tokens, institute_id, model):
        strips = _strips_in(messages)
        self.calls.append(len(strips))
        assert temperature == 0.0 and model == "m-x"
        texts = [p["text"] for p in messages[1]["content"] if p["type"] == "text"]
        assert texts[1:] == [f"Image {k}" for k in range(1, len(strips) + 1)]
        if self.script:
            item = self.script.pop(0)
            if isinstance(item, Exception):
                raise item
            return {"content": item(strips) if callable(item) else item,
                    "usage": {"prompt_tokens": 10, "completion_tokens": 3}}
        reply = [dict(i=k, **self.answer(s)) for k, s in enumerate(strips, start=1)]
        return {"content": json.dumps(reply), "usage": {"prompt_tokens": 100, "completion_tokens": 20}}


def _none(_s):
    return {"label_kind": "NONE", "name_value": None, "name_legible": False, "roll_value": None, "confidence": 0.9}


def _reader(llm):
    async def no_sleep(_s):
        return None
    return hr.HeaderReader(llm, "m-x", "inst", concurrency=3, sleep=no_sleep)


def test_parse_reply_is_strict():
    reply = '```json\n[{"i": 2, "label_kind": "question_text"}, {"i": 1, "label_kind": "PRINTED_FIELD", ' \
            '"name_value": " Aarav  Sharma ", "name_legible": "yes", "roll_value": "null", "confidence": 90}]\n```'
    a, b = hr.parse_reply(reply, 2)
    assert (a.label_kind, a.name_value, a.name_legible, a.roll_value, a.confidence) == \
        ("PRINTED_FIELD", "Aarav Sharma", True, None, 0.9)
    assert b.label_kind == "QUESTION_TEXT" and b.name_value is None and not b.name_legible
    assert hr.parse_reply('[{"i":1,"label_kind":"BOX"}]', 1)[0].label_kind == "NONE"
    with pytest.raises(hr._Mismatch):
        hr.parse_reply('[{"i":1}]', 2)
    with pytest.raises(hr._Mismatch):
        hr.parse_reply('[{"i":1},{"i":1}]', 2)
    with pytest.raises(ValueError):
        hr.parse_reply("no array", 1)


def test_chunks_of_eight_and_usage_is_summed():
    llm = _StubLLM(answer=_none)
    reader = _reader(llm)
    reads = asyncio.run(reader.read([b"s%d" % i for i in range(19)]))
    assert len(reads) == 19
    assert sorted(llm.calls) == [3, 8, 8]
    assert reader.usage.as_dict() == {"model": "m-x", "model_calls": 3, "prompt_tokens": 300, "completion_tokens": 60}


def test_short_array_falls_back_to_one_strip_per_call():
    short = json.dumps([{"i": 1, "label_kind": "NONE"}, {"i": 2, "label_kind": "NONE"}])
    one = json.dumps([{"i": 1, "label_kind": "PRINTED_FIELD", "name_value": "Riya", "name_legible": True}])
    llm = _StubLLM(script=[short, one, one, one])
    reads = asyncio.run(_reader(llm).read([b"a", b"b", b"c"]))
    assert llm.calls == [3, 1, 1, 1]
    assert [r.name_value for r in reads] == ["Riya"] * 3


def test_two_failures_raise_retryable():
    llm = _StubLLM(script=[RuntimeError("502"), RuntimeError("502")])
    with pytest.raises(hr.ScanRetryable):
        asyncio.run(_reader(llm).read([b"a", b"b"]))
    assert llm.calls == [2, 2]
    # one failure then success is fine
    ok = json.dumps([{"i": 1}, {"i": 2}])
    llm = _StubLLM(script=[RuntimeError("502"), ok])
    assert len(asyncio.run(_reader(llm).read([b"a", b"b"]))) == 2


def test_client_has_reasoning_disabled(monkeypatch):
    monkeypatch.setattr("app.services.api_key_resolver.ApiKeyResolver.__init__", lambda self, db: None)
    monkeypatch.setattr("app.services.api_key_resolver.ApiKeyResolver.resolve_keys",
                        lambda self, **_k: ("k", None, "m"))
    llm = hr.make_llm(object())
    assert llm.disable_reasoning is True


def test_keys_are_resolved_once_up_front_and_never_again(monkeypatch):
    """make_llm reads the institute's keys from the session at once; the client
    it returns never touches the session again, so the route can close it
    before the long analysis."""
    calls = []

    def init(self, db):
        self._db = db

    def resolve(self, institute_id, user_id=None, **_k):
        calls.append((self._db, institute_id, user_id))
        return ("or-key", None, "env/model")

    monkeypatch.setattr("app.services.api_key_resolver.ApiKeyResolver.__init__", init)
    monkeypatch.setattr("app.services.api_key_resolver.ApiKeyResolver.resolve_keys", resolve)
    db = object()
    llm = hr.make_llm(db, institute_id="inst-1")
    assert calls == [(db, "inst-1", None)]
    assert llm._resolve("inst-1", None) == ("or-key", None, "env/model")
    assert llm._resolve("other", "u") == ("or-key", None, "env/model")
    assert len(calls) == 1                                      # no further session use
    hr.make_llm(db)
    assert calls[-1] == (db, "default", None)                   # same default ChatLLMClient used


def test_model_falls_back_to_the_copy_check_default(monkeypatch):
    from app.services import model_selection
    from app.services.copy_check.grader import DEFAULT_MODEL

    seen = {}

    def fake_resolve(db, use_case, preferred_model=None, hard_fallback=None):
        seen.update(use_case=use_case, preferred=preferred_model, fallback=hard_fallback)
        return "vision/model-1", []

    monkeypatch.setattr(model_selection, "resolve_models", fake_resolve)
    assert hr.header_model(object(), "pref") == "vision/model-1"
    assert seen == {"use_case": "copy_check_scan_header", "preferred": "pref", "fallback": DEFAULT_MODEL}

    def broken(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(model_selection, "resolve_models", broken)
    assert hr.header_model(object()) == DEFAULT_MODEL


def test_use_case_is_registered_as_vision():
    from app.constants.model_use_cases import KIND_VISION, USE_CASE_CATALOG

    assert USE_CASE_CATALOG["copy_check_scan_header"].kind == KIND_VISION


def test_probe_picks_the_fronts_pass_and_180_rotation():
    # pass 1 = backs, pass 2 = fronts scanned upside down: only pass 2's
    # turned strips show the printed field.
    strips = {p: [(f"p{p}i{i}-up".encode(), f"p{p}i{i}-down".encode()) for i in range(6)] for p in (1, 2)}

    def answer(s):
        tag = s.decode()
        if tag.startswith("p2") and tag.endswith("down") and tag[3] in "024":
            return {"label_kind": "PRINTED_FIELD", "name_value": "X", "name_legible": True, "confidence": 0.9}
        return _none(s)

    llm = _StubLLM(answer=answer)
    res = asyncio.run(hr.probe(_reader(llm), strips))
    assert llm.calls == [12]                      # 3 pages x 2 passes x 2 ways up, ONE call
    assert (res.found, res.fronts_pass, res.fronts_rotation) == (True, 2, 180)
    assert set(res.reads) == {0, 1, 2}
    assert res.reads[0].label_kind == "PRINTED_FIELD" and res.reads[1].label_kind == "NONE"


def test_probe_reads_the_next_six_pages_then_gives_up():
    strips = {p: [(f"p{p}i{i}-up".encode(), f"p{p}i{i}-down".encode()) for i in range(12)] for p in (1, 2)}
    hit_late = _StubLLM(answer=lambda s: (
        {"label_kind": "PRINTED_FIELD", "confidence": 0.8} if s.decode() == "p1i7-up" else _none(s)))
    res = asyncio.run(hr.probe(_reader(hit_late), strips))
    assert (res.found, res.fronts_pass, res.fronts_rotation) == (True, 1, 0)
    assert hit_late.calls == [12, 12, 12]         # 12 first, then 24 more in two chunks
    nothing = _StubLLM(answer=_none)
    assert asyncio.run(hr.probe(_reader(nothing), strips)).found is False


# ── label-template guard ──────────────────────────────────────────────────────

def _label_front(seed):
    return front_page(seed, label=True, name_seed=seed)


def test_guard_flags_an_unusual_label_and_a_back_with_the_label():
    label_maps = [hg.header_map(_label_front(s)) for s in (1, 2, 3, 4)]
    templ = hg.template(label_maps)
    sims = [hg.similarity(templ, m) for m in label_maps]
    assert min(sims) >= 0.6, sims
    # the model called an answer line "Name the gas ..." a printed field
    gas = hg.header_map(write_lines(question_header(paper()), seed=9, top=300, density=0.4))
    assert hg.similarity(templ, gas) < 0.35
    # A page full of writing on the same ruled lines shares their row pattern
    # (0.47 here; 0.56 on a real 11-18 continuation front), so the guard alone
    # cannot catch every misread label - but it never looks like a label to
    # the BACK_HAS_LABEL threshold.
    assert hg.similarity(templ, hg.header_map(write_lines(paper(), seed=8, top=200))) < 0.6
    # a sheet turned over in the pile: its labelled front sits among the backs
    turned_over = hg.header_map(_label_front(77))
    assert hg.similarity(templ, turned_over) >= 0.6
    assert hg.similarity(templ, hg.header_map(rot180(rot180(_label_front(78))))) >= 0.6


def test_guard_without_a_template_says_nothing():
    assert hg.template([]) is None
    assert hg.similarity(None, hg.header_map(paper())) is None
    templ = hg.template([hg.header_map(_label_front(1))])
    assert hg.similarity(templ, hg.header_map(paper())) == 0.0


def test_label_header_helper_draws_a_box():
    page = label_header(paper(), 1)
    assert hg.header_map(page).sum() > 50
