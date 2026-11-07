"""The answer key and the marking scheme can come as their own PDFs.

The teacher uploads the paper and, separately, the institute's answer key and
marking scheme (or one PDF holding both). They are read with the paper, never
as questions; the scheme's per-point marks become the rubric's weights, and a
read without them works exactly as before.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.routers import paper_digitise as router
from app.services import paper_digitise as pd


def _q(number, text, qtype="LONG_ANSWER", marks=None, **extra):
    q = {
        "question_number": number,
        "section": None,
        "marks": marks,
        "marks_source": "printed" if marks is not None else "none",
        "question": {"type": "HTML", "content": text},
        "question_type": qtype,
        "tags": ["t"],
        "level": "medium",
    }
    q.update(extra)
    return q


def _pdf(url, pages=2, name=None):
    return pd.PaperPdf(url=url, file_name=name or url.rsplit("/", 1)[-1], content=b"%PDF", pages=pages)


# ---------------------------------------------------------------------------
# prompt
# ---------------------------------------------------------------------------

def test_prompt_without_documents_is_unchanged():
    prompt = pd._build_prompt("<p>x</p>", [])
    assert prompt == pd._PROMPT.format(paper_html="<p>x</p>", documents="", continuation="")
    assert "<answer_key>" not in prompt and "<marking_scheme>" not in prompt
    assert "Rules for the document" not in prompt
    # The paper is followed by the same blank lines as before the documents slot existed.
    assert "</paper>\n\n\n\nExtract EVERY question" in prompt


def test_prompt_carries_each_document_in_its_own_block_with_the_rules():
    prompt = pd._build_prompt("<p>paper</p>", [], "<p>1. (b)</p>", "<p>Q5: formula 1, steps 2</p>")
    assert "<answer_key>\n<p>1. (b)</p>\n</answer_key>" in prompt
    assert "<marking_scheme>\n<p>Q5: formula 1, steps 2</p>\n</marking_scheme>" in prompt
    assert "never take a question from it" in prompt
    assert '"marking_point_marks"' in prompt and 'marks_source "scheme"' in prompt
    # The documents sit between the paper and the JSON instructions.
    assert prompt.index("</paper>") < prompt.index("<answer_key>") < prompt.index("Extract EVERY")


def test_prompt_with_only_an_answer_key_has_no_scheme_block():
    prompt = pd._build_prompt("<p>paper</p>", [], "<p>key</p>", None)
    assert "<answer_key>" in prompt and "<marking_scheme>" not in prompt
    assert "Rules for the document" in prompt


def test_one_pdf_for_both_is_sent_once():
    prompt = pd._build_prompt("<p>paper</p>", [], "<p>both</p>", "<p>both</p>")
    assert prompt.count("<p>both</p>") == 1
    assert "<answer_key_and_marking_scheme>" in prompt


def test_braces_in_a_document_do_not_break_formatting():
    prompt = pd._build_prompt("<p>x</p>", [], "<p>f(x) = {1, 2}</p>", None)
    assert "{1, 2}" in prompt


# ---------------------------------------------------------------------------
# rubric from the marking scheme
# ---------------------------------------------------------------------------

def test_scheme_point_marks_become_the_rubric_weights():
    raw = _q("5", "Derive.", marks=5, marking_points=["Formula", "Substitution", "Answer"],
             marking_point_marks=[1, 2, 2])
    pd._coerce_question(raw)
    rubric = pd.marking_rubric(raw)
    assert [c["max_marks"] for c in rubric["rubric"]] == [1.0, 2.0, 2.0]
    assert [c["evaluation_guidelines"] for c in rubric["rubric"]] == ["Formula", "Substitution", "Answer"]
    assert rubric["partial_marking_enabled"] is True


def test_scheme_weights_are_scaled_to_the_question_marks():
    # The scheme says 1 + 1 but the question is worth 4 (the teacher's paper wins).
    raw = _q("2", "Explain.", marks=4, marking_points=["a", "b"], marking_point_marks=["1", "1 mark"])
    pd._coerce_question(raw)
    marks = [c["max_marks"] for c in pd.marking_rubric(raw)["rubric"]]
    assert marks == [2.0, 2.0] and sum(marks) == 4


def test_uneven_scaling_still_sums_to_the_question_marks():
    raw = _q("3", "Explain.", marks=5, marking_points=["a", "b", "c"], marking_point_marks=[1, 1, 1])
    pd._coerce_question(raw)
    marks = [c["max_marks"] for c in pd.marking_rubric(raw)["rubric"]]
    assert round(sum(marks), 2) == 5.0


@pytest.mark.parametrize("point_marks", [[], [1, 2], [1, None, 2], None, [0, 1, 1]])
def test_without_a_mark_for_every_point_the_split_stays_equal(point_marks):
    raw = _q("4", "Explain.", marks=3, marking_points=["a", "b", "c"], marking_point_marks=point_marks)
    pd._coerce_question(raw)
    assert [c["max_marks"] for c in pd.marking_rubric(raw)["rubric"]] == [1.0, 1.0, 1.0]


def test_objective_questions_ignore_point_marks():
    raw = _q("1", "2+2?", qtype="MCQS", marks=1, answer_source="paper",
             marking_points=["4"], marking_point_marks=[1])
    pd._coerce_question(raw)
    rubric = pd.marking_rubric(raw)
    assert len(rubric["rubric"]) == 1 and rubric["rubric"][0]["criteria_name"] == "Correct answer"


# ---------------------------------------------------------------------------
# build_paper / extract / digitise
# ---------------------------------------------------------------------------

def _round_with_model_answer():
    return {
        "title": "T",
        "questions": [
            _q("1", "Capital of France?", qtype="ONE_WORD", marks=1, ans="Paris", answer_source="model"),
        ],
        "is_process_completed": True,
    }


def test_warning_names_the_uploaded_key_when_it_misses_a_question():
    paper = pd.build_paper([_round_with_model_answer()], pdf_url="u", file_name="f.pdf",
                           expected_total=None, has_answer_key_document=True)
    assert any("answer key you uploaded does not cover 1" in w for w in paper.warnings)
    plain = pd.build_paper([_round_with_model_answer()], pdf_url="u", file_name="f.pdf", expected_total=None)
    assert any("The paper prints no answer key" in w for w in plain.warnings)


def test_scheme_marks_are_trusted_like_printed_ones():
    round_ = {"questions": [_q("1", "Explain.", marks=3, marks_source="scheme")], "is_process_completed": True}
    paper = pd.build_paper([round_], pdf_url="u", file_name="f.pdf", expected_total=None)
    assert paper.raw_questions[0]["marks"] == 3 and paper.raw_questions[0]["marks_source"] == "scheme"
    assert not any("no marks printed" in w for w in paper.warnings)


def test_extract_sends_the_documents_in_every_round_and_restores_their_tags(monkeypatch):
    prompts = []
    replies = [
        {"title": "T", "questions": [_q("1", "a", marks=1)], "is_process_completed": False},
        {"questions": [_q("2", "b", marks=1, ans="see figure")], "is_process_completed": True},
    ]

    async def fake_generate(prompt, models, label=None):
        prompts.append(prompt)
        return json.dumps(replies[len(prompts) - 1]), "m", {"prompt_tokens": 1, "completion_tokens": 1}

    monkeypatch.setattr(pd.llm_json, "generate_json", fake_generate)
    paper = asyncio.run(pd.extract_questions(
        "<p>paper</p>", ["m"], pdf_url="u", file_name="f.pdf", expected_total=None,
        answer_key_html="<p>key</p>", marking_scheme_html="<p>scheme</p>",
    ))
    assert len(prompts) == 2
    assert all("<answer_key>" in p and "<marking_scheme>" in p for p in prompts)
    assert len(paper.questions) == 2


def test_digitise_converts_a_shared_document_once(monkeypatch):
    converted = []

    async def fake_html(doc):
        converted.append(doc.url)
        return f"<p>{doc.url}</p>"

    seen = {}

    async def fake_extract(html, models, **kwargs):
        seen.update(kwargs)
        return "paper"

    monkeypatch.setattr(pd, "_to_html", fake_html)
    monkeypatch.setattr(pd, "extract_questions", fake_extract)
    both = _pdf("https://x/key.pdf")
    asyncio.run(pd.digitise(_pdf("https://x/paper.pdf"), ["m"], expected_total=None,
                            answer_key=both, marking_scheme=both))
    assert converted == ["https://x/paper.pdf", "https://x/key.pdf"]
    assert seen["answer_key_html"] == seen["marking_scheme_html"] == "<p>https://x/key.pdf</p>"


def test_digitise_without_documents_reads_only_the_paper(monkeypatch):
    converted = []

    async def fake_html(doc):
        converted.append(doc.url)
        return "<p>paper</p>"

    seen = {}

    async def fake_extract(html, models, **kwargs):
        seen.update(kwargs)
        return "paper"

    monkeypatch.setattr(pd, "_to_html", fake_html)
    monkeypatch.setattr(pd, "extract_questions", fake_extract)
    asyncio.run(pd.digitise(_pdf("https://x/paper.pdf"), ["m"], expected_total=None))
    assert converted == ["https://x/paper.pdf"]
    assert seen["answer_key_html"] is None and seen["marking_scheme_html"] is None


def test_digitise_fails_with_a_named_sentence_when_a_document_is_empty(monkeypatch):
    async def fake_html(doc):
        return "" if "scheme" in doc.url else "<p>x</p>"

    monkeypatch.setattr(pd, "_to_html", fake_html)
    with pytest.raises(RuntimeError, match="marking scheme PDF converted to an empty document"):
        asyncio.run(pd.digitise(_pdf("https://x/paper.pdf"), ["m"], expected_total=None,
                                marking_scheme=_pdf("https://x/scheme.pdf")))


# ---------------------------------------------------------------------------
# router: which documents are fetched, and the pages billed
# ---------------------------------------------------------------------------

def _fake_fetch(monkeypatch, pages=None):
    calls = []

    async def fetch(url, label=pd.QUESTION_PAPER):
        calls.append((url, label))
        return _pdf(url, pages=(pages or {}).get(url, 2))

    monkeypatch.setattr(router.paper_digitise, "fetch_paper_pdf", fetch)
    return calls


def test_paper_only_request_fetches_only_the_paper(monkeypatch):
    calls = _fake_fetch(monkeypatch)
    docs = asyncio.run(router._fetch_documents(router.EstimateRequest(pdf_url="https://x/p.pdf")))
    assert calls == [("https://x/p.pdf", "question paper")]
    assert docs.pages == 2 and docs.answer_key is None and docs.marking_scheme is None
    assert docs.summary() == [{"role": "question_paper", "file_name": "p.pdf", "pages": 2}]


def test_separate_key_and_scheme_are_fetched_with_their_names_and_billed(monkeypatch):
    calls = _fake_fetch(monkeypatch, {"https://x/k.pdf": 1, "https://x/s.pdf": 3})
    docs = asyncio.run(router._fetch_documents(router.EstimateRequest(
        pdf_url="https://x/p.pdf", answer_key_url="https://x/k.pdf", marking_scheme_url=" https://x/s.pdf ",
    )))
    assert [label for _, label in calls] == ["question paper", "answer key", "marking scheme"]
    assert docs.pages == 2 + 1 + 3
    assert [d["role"] for d in docs.summary()] == ["question_paper", "answer_key", "marking_scheme"]


def test_one_pdf_for_key_and_scheme_is_fetched_and_billed_once(monkeypatch):
    calls = _fake_fetch(monkeypatch, {"https://x/ks.pdf": 4})
    docs = asyncio.run(router._fetch_documents(router.EstimateRequest(
        pdf_url="https://x/p.pdf", answer_key_url="https://x/ks.pdf", marking_scheme_url="https://x/ks.pdf",
    )))
    assert len(calls) == 2 and docs.answer_key is docs.marking_scheme
    assert docs.pages == 6
    assert docs.summary()[1]["role"] == "answer_key_and_marking_scheme"


def test_the_paper_itself_given_as_the_key_is_ignored(monkeypatch):
    calls = _fake_fetch(monkeypatch)
    docs = asyncio.run(router._fetch_documents(router.EstimateRequest(
        pdf_url="https://x/p.pdf", answer_key_url="https://x/p.pdf", marking_scheme_url="",
    )))
    assert len(calls) == 1 and docs.answer_key is None and docs.marking_scheme is None


def test_too_many_pages_together_is_a_400_sentence(monkeypatch):
    _fake_fetch(monkeypatch, {"https://x/p.pdf": 30, "https://x/k.pdf": 30, "https://x/s.pdf": 5})
    with pytest.raises(pd.PaperPdfError, match="65 pages together"):
        asyncio.run(router._fetch_documents(router.EstimateRequest(
            pdf_url="https://x/p.pdf", answer_key_url="https://x/k.pdf", marking_scheme_url="https://x/s.pdf",
        )))


def test_job_payload_reports_the_documents_read():
    class Task:
        id = "t1"
        status = "COMPLETED"
        status_message = None
        created_at = None
        result_json = json.dumps({"digitised": {"questions": []}})
        dynamic_values_map = json.dumps({"params": {
            "pdf_url": "https://x/p.pdf", "answer_key_url": "https://x/k.pdf", "marking_scheme_url": None,
        }})

    payload = router._job_payload(Task())
    assert payload["sources"] == {
        "pdf_url": "https://x/p.pdf", "answer_key_url": "https://x/k.pdf", "marking_scheme_url": None,
    }

    class OldTask(Task):
        dynamic_values_map = None

    assert router._job_payload(OldTask())["sources"]["answer_key_url"] is None
