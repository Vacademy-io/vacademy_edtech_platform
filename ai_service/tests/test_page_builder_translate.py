"""POST /page-builder/v1/translate — the website builder's site-language texts.

The builder keeps each other language as a dictionary keyed by the EXACT base
text, so these pin: results keyed by the exact source; HTML tags (attributes
included), links, digits, {{placeholders}} and text-pattern {placeholders}
("Explore {stream}") never reach the model and come back byte-exact — also when
one sits inside another (`<img src="{{course.image}}">`, `https://x.org/{{id}}`,
`{{step2}}`); style/script/pre/code elements are masked whole; a reply (or a
remembered translation) that drops/invents a token or a {placeholder}, changes
the block markup or the numbers (Devanagari digits) is reported as failed —
inline spans may move (Hindi word order); long HTML gets a call of its own; at most three calls run
at once; translation memory first (and re-checked), skippable; only website
editors (admin/owner) may spend credits here; credits pre-flighted on the
texts the model translates, ONE charge per request on the summed usage,
nothing charged when the model never answered.

The model, the translation memory, the glossary and billing are stubbed;
nothing here touches the network or a database.
"""
from __future__ import annotations

import asyncio
import json
import re
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

pb = pytest.importorskip("app.routers.page_builder")

from app.core.security import get_pinned_principal  # noqa: E402
from app.db import db_dependency  # noqa: E402
from app.models.ai_token_usage import RequestType  # noqa: E402
from app.services import translation_service as ts  # noqa: E402
from app.services.tool_cost_estimator import KNOWN_TOOLS, ToolCostEstimator  # noqa: E402

MODEL = "google/gemini-2.5-flash"
USAGE = {"prompt_tokens": 100, "completion_tokens": 40}
TOKEN = re.compile(r"__PH_\d+__")


def _batch_payload(prompt: str) -> Dict[str, str]:
    return json.loads(prompt.split("TEXTS:\n", 1)[1])


def _item_payload(prompt: str) -> str:
    return prompt.split("CONTENT:\n<<<\n", 1)[1].rsplit("\n>>>", 1)[0]


def _hindi(masked: str) -> str:
    """A stand-in translation that keeps every token where it was."""
    return "हिं " + masked


def default_reply(label: str, prompt: str) -> Dict[str, Any]:
    if label == "page-translate:item":
        return {"translation": _hindi(_item_payload(prompt))}
    return {alias: _hindi(masked) for alias, masked in _batch_payload(prompt).items()}


def admin() -> SimpleNamespace:
    return SimpleNamespace(institute_id="inst-1", user_id="u1", roles=["ADMIN"], is_root_user=False)


class Harness:
    def __init__(
        self,
        monkeypatch: pytest.MonkeyPatch,
        *,
        reply: Callable[[str, str], Dict[str, Any]] = default_reply,
        memory: Optional[Dict[str, str]] = None,
        model_down: bool = False,
        sufficient: bool = True,
        principal: Optional[SimpleNamespace] = None,
    ):
        self.calls: List[tuple] = []
        self.billed: List[Dict[str, Any]] = []
        self.preflights: List[Dict[str, Any]] = []
        self.tm_writes: List[Dict[str, Any]] = []
        self.lookups = 0
        self.active = 0
        self.max_active = 0
        memory_by_hash = {ts.sha256_text(s): t for s, t in (memory or {}).items()}

        async def fake_generate_json(prompt, models, *, attempts=3, label="llm"):
            self.calls.append((label, prompt, list(models)))
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            await asyncio.sleep(0.01)
            self.active -= 1
            if model_down:
                raise RuntimeError("every model failed")
            return json.dumps(reply(label, prompt), ensure_ascii=False), MODEL, dict(USAGE)

        def fake_lookup(db, institute_id, source_locale, target_locale, source_hash):
            self.lookups += 1
            return memory_by_hash.get(source_hash)

        @contextmanager
        def fake_session():
            yield object()

        monkeypatch.setattr(ts, "generate_json", fake_generate_json)
        monkeypatch.setattr(ts, "db_session", fake_session)
        monkeypatch.setattr(ts, "tm_lookup", fake_lookup)
        monkeypatch.setattr(ts, "tm_write", lambda db, **kw: self.tm_writes.append(kw))
        monkeypatch.setattr(
            ts, "build_glossary_lines", lambda db, inst, loc: ['- "NEET" must be kept EXACTLY as-is (do not translate)']
        )
        monkeypatch.setattr(
            ts, "resolve_models", lambda db, use_case, preferred_model=None, **kw: (MODEL, ["deepseek/deepseek-v3.2"])
        )
        monkeypatch.setattr(pb, "record_tool_billing", lambda **kw: self.billed.append(kw))

        def fake_preflight(db, **kw):
            self.preflights.append(kw)
            return {"sufficient": sufficient, "estimated_credits": 3, "current_balance": 100 if sufficient else 0}

        monkeypatch.setattr(pb, "preflight_tool_credits", fake_preflight)

        app = FastAPI()
        app.include_router(pb.router)
        who = principal or admin()
        app.dependency_overrides[get_pinned_principal] = lambda: who
        app.dependency_overrides[db_dependency] = lambda: object()
        self.client = TestClient(app)

    def post(self, **body: Any):
        body.setdefault("target_locale", "hi")
        return self.client.post(pb.router.prefix + "/v1/translate", json=body)

    @property
    def prompts(self) -> str:
        return "\n".join(c[1] for c in self.calls)


# ── the happy path ───────────────────────────────────────────────────────────

LINK_HTML = '<p>Visit <a href="https://example.org/a?b=1" class="btn">our site</a> today</p>'


def test_translates_keyed_by_exact_source_with_protected_parts_byte_exact(monkeypatch):
    h = Harness(monkeypatch)
    strings = ["Learn the Indian way", "  Join now ", "Fees: ₹1,599 only", LINK_HTML, "Hello {{name}}, mail us at info@example.org"]
    res = h.post(strings=strings)
    assert res.status_code == 200, res.text
    data = res.json()
    assert list(data["translations"]) == strings
    assert data["failed"] == []
    t = data["translations"]
    assert t["Learn the Indian way"] == "हिं Learn the Indian way"
    assert t["  Join now "].startswith("  हिं") and t["  Join now "].endswith(" ")
    assert t["Fees: ₹1,599 only"] == "हिं Fees: ₹1,599 only"
    assert '<a href="https://example.org/a?b=1" class="btn">' in t[LINK_HTML]
    assert "{{name}}" in t[strings[4]] and "info@example.org" in t[strings[4]]
    # Links, digits, markup and placeholders never reached the model.
    for hidden in ("https://example.org", "1,599", "<a ", "{{name}}", "info@example.org"):
        assert hidden not in h.prompts
    assert data["model"] == MODEL and data["tm_hits"] == 0 and data["run_id"]


def test_one_charge_per_request_on_summed_usage(monkeypatch):
    h = Harness(monkeypatch)
    strings = ["Learn the Indian way", "Join now"]
    assert h.post(strings=strings).status_code == 200
    assert len(h.billed) == 1
    bill = h.billed[0]
    assert bill["tool_key"] == "page_translate"
    assert bill["request_type"] == RequestType.TRANSLATION
    assert bill["tool_params"] == {"transcript_chars": sum(len(s) for s in strings)}
    assert bill["prompt_tokens"] == USAGE["prompt_tokens"] * len(h.calls)
    assert bill["institute_id"] == "inst-1" and bill["user_id"] == "u1"
    assert bill["idempotency_key"].startswith("page_translate:")
    assert h.preflights[0]["tool_key"] == "page_translate"
    assert h.preflights[0]["tool_params"] == {"transcript_chars": sum(len(s) for s in strings)}
    # Fresh results go to the translation memory under the website domain.
    assert {w["domain"] for w in h.tm_writes} == {"WEBSITE"}
    assert {w["source_text_value"] for w in h.tm_writes} == set(strings)


def test_uses_the_translation_model_and_the_glossary(monkeypatch):
    h = Harness(monkeypatch)
    h.post(strings=["NEET coaching"])
    assert h.calls[0][2] == [MODEL, "deepseek/deepseek-v3.2"]
    assert '"NEET" must be kept EXACTLY as-is' in h.calls[0][1]


# ── safety checks ────────────────────────────────────────────────────────────

FEES = "Fees: ₹1,599 only"
EXTRA_DIGITS = "Batch of 2026"
BLOCKS = "<h2>Title</h2><p>Body text</p>"
INLINE = "Click <a href='/x'>here</a> to <strong>start</strong>"
PLAIN = "Plain text"


def _mangling_reply(label: str, prompt: str) -> Dict[str, Any]:
    out = {}
    for alias, masked in _batch_payload(prompt).items():
        tokens = TOKEN.findall(masked)
        if masked.startswith("Fees"):
            out[alias] = "शुल्क: ₹१,५९९ मात्र"  # token dropped, Devanagari digits
        elif masked.startswith("Batch"):
            out[alias] = f"{tokens[0]} (२०२६) का बैच"  # token kept, digits added
        elif masked.startswith(tokens[0] if tokens else "\0") and "Title" in masked:
            # <h2>…</h2><p>…</p> → <p>…</p><h2>…</h2>: block order changed
            t = tokens
            out[alias] = f"{t[2]}मुख्य पाठ{t[3]}{t[0]}शीर्षक{t[1]}"
        elif masked.startswith("Click"):
            # inline spans move with Hindi word order: allowed
            t = tokens
            out[alias] = f"{t[2]}शुरू{t[3]} करने के लिए {t[0]}यहाँ{t[1]} क्लिक करें"
        else:
            out[alias] = "__PH_9__ सादा पाठ"  # invented token
    return out


def test_mangled_replies_are_reported_not_used(monkeypatch):
    h = Harness(monkeypatch, reply=_mangling_reply)
    res = h.post(strings=[FEES, EXTRA_DIGITS, BLOCKS, INLINE, PLAIN])
    assert res.status_code == 200, res.text
    data = res.json()
    reasons = {f["source"]: f["reason"] for f in data["failed"]}
    assert set(reasons) == {FEES, EXTRA_DIGITS, BLOCKS, PLAIN}
    assert "dropped or repeated" in reasons[FEES]
    assert "numbers changed" in reasons[EXTRA_DIGITS]
    assert "markup changed" in reasons[BLOCKS]
    assert "invented" in reasons[PLAIN]
    assert data["translations"] == {
        INLINE: "<strong>शुरू</strong> करने के लिए <a href='/x'>यहाँ</a> क्लिक करें"
    }
    assert any("could not be translated safely" in w for w in data["warnings"])
    # The call happened, so it is charged (once) even though most items failed.
    assert len(h.billed) == 1
    # Only accepted translations are remembered.
    assert [w["source_text_value"] for w in h.tm_writes] == [INLINE]


def test_website_checks_unit():
    source = '<b>Only</b> ₹499 at https://x.org &amp; {{city}}'
    masked, mapping = ts.mask_website_text(source)
    # Only the words (and the currency sign) are left for the model…
    assert TOKEN.sub("|", masked) == "|Only| ₹| at | | |"
    assert set(mapping.values()) == {"<b>", "</b>", "499", "https://x.org", "&amp;", "{{city}}"}
    # …and putting the tokens back restores the source byte for byte.
    assert ts.restore_protected(masked, mapping) == source
    assert ts.website_translation_problem("Only 499", "केवल ४९९") == "the numbers changed"
    assert ts.website_translation_problem("<p>a</p>", "<p>अ") == "the HTML markup changed"
    assert ts.website_translation_problem("<p>a <b>b</b> <i>c</i></p>", "<p><i>स</i> <b>ब</b> अ</p>") is None
    assert ts.website_translation_problem("x", "  ") == "the translation is empty"


# ── protected parts inside protected parts ───────────────────────────────────

IMG = '<p><img src="{{course.image}}" alt="Course"> Learn with us</p>'
ANCHOR = '<a href="{{link}}">Enroll</a>'
LINKED = "Visit https://x.org/{{id}} today"
DATA_CODE = '<div data-code="abc">Hello</div>'
STEP = "Step {{step2}} of 3"
MATH = "Solve $$x^2$$ now"
NESTED = [IMG, ANCHOR, LINKED, DATA_CODE, STEP, MATH]


@pytest.mark.parametrize("source", NESTED + ["<b>Only</b> ₹499 at https://x.org &amp; {{city}}"])
def test_masking_never_nests_tokens_and_restores_byte_exact(source):
    masked, mapping = ts.mask_website_text(source)
    # Every token stands for source text, never for another token…
    assert not any(TOKEN.search(original) for original in mapping.values())
    assert TOKEN.findall(masked) == list(mapping)
    # …so a reply that carries each token once restores the source exactly.
    assert ts.restore_website_tokens(masked, mapping) == source


def test_a_token_written_in_the_source_comes_back_as_written():
    masked, mapping = ts.mask_website_text("Use __PH_3__ here")
    assert masked == "Use __PH_0__ here" and mapping == {"__PH_0__": "__PH_3__"}
    assert ts.restore_website_tokens("यहाँ __PH_0__ लिखें", mapping) == "यहाँ __PH_3__ लिखें"


def test_texts_with_placeholders_in_tags_and_links_translate(monkeypatch):
    """Course-page templates put {{course.*}} tokens in src/href attributes."""
    h = Harness(monkeypatch)
    res = h.post(strings=NESTED)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["failed"] == []
    t = data["translations"]
    assert t[IMG] == "हिं " + IMG
    assert t[ANCHOR] == "हिं " + ANCHOR
    assert t[LINKED] == "हिं " + LINKED
    assert t[DATA_CODE] == "हिं " + DATA_CODE
    assert t[STEP] == "हिं " + STEP and t[MATH] == "हिं " + MATH
    for hidden in ("{{course.image}}", "{{link}}", "https://x.org", "data-code", "{{step2}}", "$$x^2$$"):
        assert hidden not in h.prompts


def test_style_script_pre_and_code_are_masked_whole(monkeypatch):
    source = (
        "<style>.hero{color:red;font-family:Roboto}</style><p>Hello</p>"
        "<SCRIPT>if (a < b) go()</SCRIPT><pre>npm run dev</pre> Use <code>npm i</code> first"
    )
    masked, mapping = ts.mask_website_text(source)
    assert TOKEN.sub("|", masked) == "||Hello||| Use | first"
    assert mapping["__PH_0__"] == "<style>.hero{color:red;font-family:Roboto}</style>"
    h = Harness(monkeypatch)
    data = h.post(strings=[source]).json()
    assert data["translations"] == {source: "हिं " + source}
    for hidden in ("color:red", "Roboto", "go()", "npm"):
        assert hidden not in h.prompts


# ── text-pattern placeholders ({stream}, {title}) ────────────────────────────
#
# The header mega menu's "Button label" and "Categories heading" are text
# patterns the site fills per stream by the placeholder's ASCII name, so the
# Hindi pattern must carry each placeholder back exactly as typed: '{धारा} देखें'
# would show literally, a dropped one gives every stream the same heading.

CTA = "Explore {stream}"
HEADING = "Categories in {stream}"
BOTH = "{title} · {stream}"
BROWSE = "Browse {title}"
PATTERNS = [
    CTA,
    BOTH,
    '<a href="/streams/{stream}">Explore {stream}</a>',  # the tag keeps its own copy
    "Step {step2} of 3",                                  # digits stay inside the placeholder
    "Hi {{name}}, explore {stream} at https://x.org/{id}",
]


def test_text_pattern_placeholders_are_masked_and_restored():
    masked, mapping = ts.mask_website_text(CTA)
    assert masked == "Explore __PH_0__" and mapping == {"__PH_0__": "{stream}"}
    assert ts.restore_website_tokens("__PH_0__ देखें", mapping) == "{stream} देखें"
    masked, mapping = ts.mask_website_text(BOTH)
    assert masked == "__PH_0__ · __PH_1__"
    assert mapping == {"__PH_0__": "{title}", "__PH_1__": "{stream}"}
    assert list(ts.mask_website_text("Step {step2} of 3")[1].values()) == ["{step2}", "3"]


@pytest.mark.parametrize("source", PATTERNS)
def test_text_pattern_masking_never_nests_tokens(source):
    masked, mapping = ts.mask_website_text(source)
    assert not any(TOKEN.search(original) for original in mapping.values())
    assert TOKEN.findall(masked) == list(mapping)
    assert "{" not in masked and "}" not in masked
    assert ts.restore_website_tokens(masked, mapping) == source


def test_double_brace_placeholders_still_mask_whole():
    """{{…}} wins over {…} at the same start: one token, restored byte-exact."""
    assert ts.mask_website_text("Hello {{name}}") == ("Hello __PH_0__", {"__PH_0__": "{{name}}"})
    masked, mapping = ts.mask_website_text("{{course.title}} in {stream}")
    assert masked == "__PH_0__ in __PH_1__"
    assert mapping == {"__PH_0__": "{{course.title}}", "__PH_1__": "{stream}"}
    assert ts.website_translation_problem("Hello {{name}}", "नमस्ते {{name}}") is None
    assert ts.website_translation_problem("Read {{course.title}} now", "{{course.title}} अभी पढ़ें") is None


@pytest.mark.parametrize(
    "source, translated",
    [
        (CTA, "{धारा} देखें"),            # renamed in the target script
        (CTA, "{Stream} देखें"),          # renamed in case only
        (CTA, "देखें"),                   # dropped
        (CTA, "{stream} {stream} देखें"),  # repeated
        (CTA, "{stream} देखें {title}"),   # invented
        (BOTH, "{title} · {title}"),
        ("Hello {{name}}", "नमस्ते"),      # a remembered translation that lost a {{name}}
    ],
)
def test_a_changed_placeholder_is_a_problem(source, translated):
    assert ts.website_translation_problem(source, translated) == "the {placeholders} changed"


def test_placeholders_may_move_with_word_order():
    assert ts.website_translation_problem(CTA, "{stream} देखें") is None
    assert ts.website_translation_problem(BOTH, "{stream} · {title}") is None
    assert ts.website_translation_problem("Plain text", "सादा पाठ") is None


def test_text_patterns_translate_without_the_model_seeing_placeholders(monkeypatch):
    h = Harness(monkeypatch)
    strings = [CTA, HEADING, BOTH]
    data = h.post(strings=strings).json()
    assert data["failed"] == []
    assert data["translations"] == {s: "हिं " + s for s in strings}
    assert "{stream}" not in h.prompts and "{title}" not in h.prompts


def _placeholder_mangling_reply(label: str, prompt: str) -> Dict[str, Any]:
    out = {}
    for alias, masked in _batch_payload(prompt).items():
        tokens = TOKEN.findall(masked)
        if masked.startswith("Explore"):
            out[alias] = "{धारा} देखें"                   # placeholder rewritten: its token is gone
        elif masked.startswith("Categories"):
            out[alias] = "श्रेणियाँ"                      # placeholder dropped
        elif masked.startswith("Browse"):
            out[alias] = f"{tokens[0]} देखें {{stream}}"  # token kept, a placeholder invented
        else:
            out[alias] = f"{tokens[1]} में {tokens[0]}"   # placeholders moved: fine
    return out


def test_mangled_placeholders_are_reported_not_used(monkeypatch):
    h = Harness(monkeypatch, reply=_placeholder_mangling_reply)
    data = h.post(strings=[CTA, HEADING, BROWSE, BOTH]).json()
    reasons = {f["source"]: f["reason"] for f in data["failed"]}
    assert set(reasons) == {CTA, HEADING, BROWSE}
    assert "dropped or repeated" in reasons[CTA] and "dropped or repeated" in reasons[HEADING]
    assert reasons[BROWSE] == "the {placeholders} changed"
    assert data["translations"] == {BOTH: "{stream} में {title}"}
    assert [w["source_text_value"] for w in h.tm_writes] == [BOTH]


def test_a_remembered_translation_with_a_changed_placeholder_is_redone(monkeypatch):
    memory = {CTA: "{धारा} देखें", HEADING: "{stream} में श्रेणियाँ"}
    h = Harness(monkeypatch, memory=memory)
    data = h.post(strings=[CTA, HEADING]).json()
    assert data["tm_hits"] == 1
    assert data["translations"] == {CTA: "हिं " + CTA, HEADING: "{stream} में श्रेणियाँ"}
    # Only the redone text is pre-flighted, sent and charged.
    assert h.preflights[0]["tool_params"] == {"transcript_chars": len(CTA)}
    assert "Categories" not in h.prompts
    assert h.billed[0]["tool_params"] == {"transcript_chars": len(CTA)}


# ── who may spend credits ────────────────────────────────────────────────────

def _member(*roles: str, root: bool = False) -> SimpleNamespace:
    return SimpleNamespace(institute_id="inst-1", user_id="u2", roles=list(roles), is_root_user=root)


@pytest.mark.parametrize("principal", [_member("STUDENT"), _member("TEACHER"), _member()])
def test_only_website_editors_can_translate(monkeypatch, principal):
    h = Harness(monkeypatch, principal=principal)
    res = h.post(strings=["Join now"])
    assert res.status_code == 403
    assert "admins" in res.json()["detail"]
    assert h.preflights == [] and h.calls == [] and h.billed == [] and h.lookups == 0


@pytest.mark.parametrize("principal", [_member("OWNER"), _member("TEACHER", "ADMIN"), _member(root=True)])
def test_admins_owners_and_root_users_can_translate(monkeypatch, principal):
    h = Harness(monkeypatch, principal=principal)
    assert h.post(strings=["Join now"]).status_code == 200


# ── chunking ─────────────────────────────────────────────────────────────────

def test_long_html_gets_its_own_call_and_concurrency_is_capped(monkeypatch):
    h = Harness(monkeypatch)
    long_html = "<section>" + "".join(f"<p>Paragraph {i} about learning the Indian way.</p>" for i in range(60)) + "</section>"
    short = [f"Short text number {chr(65 + i % 26)}{i // 26}" for i in range(60)]
    res = h.post(strings=[long_html, *short])
    assert res.status_code == 200, res.text
    assert res.json()["failed"] == []
    labels = [c[0] for c in h.calls]
    assert labels.count("page-translate:item") == 1
    assert labels.count("page-translate:batch") == 3  # 25 + 25 + 10
    item_prompt = next(c[1] for c in h.calls if c[0] == "page-translate:item")
    assert "Short text number" not in item_prompt
    assert all(len(_batch_payload(c[1])) <= ts.WEBSITE_BATCH_ITEMS for c in h.calls if c[0] == "page-translate:batch")
    assert h.max_active <= ts.WEBSITE_LLM_CONCURRENCY
    assert len(h.billed) == 1


# ── translation memory ───────────────────────────────────────────────────────

def test_memory_hits_are_free_and_rechecked(monkeypatch):
    memory = {"Learn the Indian way": "भारतीय तरीके से सीखें", FEES: "शुल्क: ₹१,५९९ मात्र"}
    h = Harness(monkeypatch, memory=memory)
    data = h.post(strings=["Learn the Indian way", FEES, "Join now"]).json()
    assert data["tm_hits"] == 1
    assert data["translations"]["Learn the Indian way"] == "भारतीय तरीके से सीखें"
    # The remembered Fees translation fails the number check, so it is redone.
    assert data["translations"][FEES] == "हिं Fees: ₹1,599 only"
    assert "Learn the Indian way" not in h.prompts
    assert h.billed[0]["tool_params"] == {"transcript_chars": len(FEES) + len("Join now")}


def test_skip_memory_sends_everything(monkeypatch):
    h = Harness(monkeypatch, memory={"Learn the Indian way": "भारतीय तरीके से सीखें"})
    data = h.post(strings=["Learn the Indian way"], skip_memory=True).json()
    assert h.lookups == 0
    assert data["translations"]["Learn the Indian way"] == "हिं Learn the Indian way"


def test_all_from_memory_costs_nothing(monkeypatch):
    h = Harness(monkeypatch, memory={"Join now": "अभी जुड़ें"})
    data = h.post(strings=["Join now"]).json()
    assert data["translations"] == {"Join now": "अभी जुड़ें"}
    assert data["model"] == "translation-memory"
    assert h.calls == [] and h.billed == []


def test_credits_are_checked_only_for_what_the_model_translates(monkeypatch):
    h = Harness(monkeypatch, memory={"Join now": "अभी जुड़ें"})
    h.post(strings=["Join now", "Learn the Indian way"])
    assert h.preflights[0]["tool_params"] == {"transcript_chars": len("Learn the Indian way")}
    # Served from memory with no credits left: no 402, no credit check at all.
    broke = Harness(monkeypatch, memory={"Join now": "अभी जुड़ें"}, sufficient=False)
    res = broke.post(strings=["Join now"])
    assert res.status_code == 200, res.text
    assert res.json()["translations"] == {"Join now": "अभी जुड़ें"}
    assert broke.preflights == [] and broke.calls == [] and broke.billed == []


# ── refusals ─────────────────────────────────────────────────────────────────

def test_402_before_any_model_call_when_credits_are_short(monkeypatch):
    h = Harness(monkeypatch, sufficient=False)
    res = h.post(strings=["Join now"])
    assert res.status_code == 402
    assert "Insufficient credits" in res.json()["detail"]
    assert h.calls == [] and h.billed == []


def test_model_down_is_a_502_and_never_charged(monkeypatch):
    h = Harness(monkeypatch, model_down=True)
    res = h.post(strings=["Join now", "Learn the Indian way"])
    assert res.status_code == 502
    assert "not charged" in res.json()["detail"]
    assert h.billed == []


@pytest.mark.parametrize(
    "body, detail",
    [
        ({"strings": ["x y"], "target_locale": "xx"}, "Unsupported language"),
        ({"strings": ["x y"], "target_locale": "en"}, "base language"),
        ({"strings": ["x y"], "target_locale": "hi", "source_locale": "zz"}, "Unsupported language"),
        ({"strings": [f"Text {i}" for i in range(201)], "target_locale": "hi"}, "at most 200"),
    ],
)
def test_bad_requests(monkeypatch, body, detail):
    h = Harness(monkeypatch)
    res = h.client.post(pb.router.prefix + "/v1/translate", json=body)
    assert res.status_code == 400
    assert detail in res.json()["detail"]
    assert h.calls == []


def test_blank_and_duplicate_texts_are_dropped_and_huge_ones_reported(monkeypatch):
    h = Harness(monkeypatch)
    huge = "<p>" + "x " * 20000 + "</p>"
    data = h.post(strings=["Join now", "Join now", "   ", huge]).json()
    assert list(data["translations"]) == ["Join now"]
    assert data["failed"] == [{"source": huge, "reason": "too long to translate automatically — translate it by hand"}]
    empty = h.post(strings=[]).json()
    assert empty["translations"] == {} and empty["warnings"] == ["Nothing to translate."]


# ── pricing ──────────────────────────────────────────────────────────────────

class _NoPricingTables:
    """A session whose pricing tables do not exist yet: code defaults apply."""

    @contextmanager
    def begin_nested(self):
        yield

    def execute(self, *args, **kwargs):
        raise RuntimeError("relation ai_tool_pricing does not exist")


def test_page_translate_is_priced_per_100_chars_with_a_one_credit_floor():
    assert "page_translate" in KNOWN_TOOLS
    est = ToolCostEstimator(_NoPricingTables()).estimate("page_translate", {"transcript_chars": 250})
    assert est["request_type"] == "translation"
    assert est["unit_field"] == "chars"
    assert est["estimated_credits"] == 1
    big = ToolCostEstimator(_NoPricingTables()).estimate("page_translate", {"transcript_chars": 25_000})
    assert big["estimated_credits"] == 3  # 250 units × 0.01 = 2.5 → 3
