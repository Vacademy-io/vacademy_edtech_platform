"""A question paper attached to an offline test becomes the test's real questions.

The AI checker grades per question against each question's marks, so the
digitiser has to keep every printed question, carry its marks, never invent
a mark it did not see without saying so, and tell the teacher what to verify.
"""
from __future__ import annotations

import asyncio
import json

import fitz  # PyMuPDF
import httpx
import pytest

from app.services import paper_digitise as pd


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _q(number, text, qtype="LONG_ANSWER", marks=None, section=None, **extra):
    q = {
        "question_number": number,
        "section": section,
        "marks": marks,
        "marks_source": "printed" if marks is not None else "none",
        "question": {"type": "HTML", "content": text},
        "question_type": qtype,
        "tags": ["t"],
        "level": "medium",
    }
    q.update(extra)
    return q


def _pdf_bytes(pages=2, encrypt=False) -> bytes:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Q{i + 1}. Explain. [5]")
    kwargs = {}
    if encrypt:
        kwargs = {"encryption": fitz.PDF_ENCRYPT_AES_256, "user_pw": "secret", "owner_pw": "secret"}
    return doc.tobytes(**kwargs)


# ---------------------------------------------------------------------------
# marks
# ---------------------------------------------------------------------------

def test_marks_printed_on_the_question_win_and_sections_fill_the_rest():
    qs = [
        _q("1", "a", marks=3, section="A"),
        _q("2", "b", section="A"),                  # from the section
        _q("3", "c", qtype="MCQS", section="B"),    # from the section
    ]
    sections = [{"name": "A", "marks_each": 2}, {"name": "b", "marks_each": 1}]
    warnings = pd.reconcile_marks(qs, sections, stated_total=6, expected_total=None)
    assert [q["marks"] for q in qs] == [3, 2, 1]
    assert qs[1]["marks_source"] == "section"
    assert warnings == []


def test_unprinted_marks_split_the_known_remainder_and_warn():
    qs = [_q("1", "a", marks=10), _q("2", "b"), _q("3", "c")]
    warnings = pd.reconcile_marks(qs, [], stated_total=None, expected_total=20)
    assert [q["marks"] for q in qs] == [10, 5, 5]
    assert all(q["marks_source"] == "split" for q in qs[1:])
    assert any("split equally" in w for w in warnings)


def test_no_total_anywhere_defaults_to_one_mark_and_says_so():
    qs = [_q("1", "a"), _q("2", "b")]
    warnings = pd.reconcile_marks(qs, [], stated_total=None, expected_total=None)
    assert [q["marks"] for q in qs] == [1.0, 1.0]
    assert any("set to 1 mark" in w for w in warnings)


def test_total_mismatch_is_reported_against_the_paper_first_then_the_teacher():
    qs = [_q("1", "a", marks=4), _q("2", "b", marks=4)]
    assert any("states 10 marks" in w for w in pd.reconcile_marks(qs, [], 10, 8))
    qs = [_q("1", "a", marks=4), _q("2", "b", marks=4)]
    assert any("You entered 10" in w for w in pd.reconcile_marks(qs, [], None, 10))
    qs = [_q("1", "a", marks=4), _q("2", "b", marks=4)]
    assert pd.reconcile_marks(qs, [], 8, 8) == []


def test_marks_written_as_text_are_read():
    qs = [_q("1", "a", marks="5 marks"), _q("2", "b", marks="[2]")]
    pd.reconcile_marks(qs, [], None, None)
    assert [q["marks"] for q in qs] == [5.0, 2.0]


# ---------------------------------------------------------------------------
# rubric
# ---------------------------------------------------------------------------

def test_written_answer_rubric_splits_marks_over_the_marking_points_exactly():
    raw = _q("4", "Explain photosynthesis.", marks=5, marking_points=["light", "chlorophyll", "glucose"])
    rubric = pd.marking_rubric(raw)
    assert rubric["max_marks"] == 5 and rubric["partial_marking_enabled"] is True
    assert [c["max_marks"] for c in rubric["rubric"]] == [1.67, 1.67, 1.66]
    assert sum(c["max_marks"] for c in rubric["rubric"]) == pytest.approx(5)
    assert rubric["rubric"][2]["keywords"] == ["t"]


def test_objective_rubric_is_one_criterion_and_flags_a_model_answer():
    raw = _q("1", "2+2?", qtype="MCQS", marks=1, answer_source="model")
    rubric = pd.marking_rubric(raw)
    assert len(rubric["rubric"]) == 1 and rubric["rubric"][0]["max_marks"] == 1
    assert "inferred by the model" in rubric["rubric"][0]["evaluation_guidelines"]
    printed = pd.marking_rubric(_q("1", "2+2?", qtype="MCQS", marks=1, answer_source="paper"))
    assert "inferred" not in printed["rubric"][0]["evaluation_guidelines"]


# ---------------------------------------------------------------------------
# shaping
# ---------------------------------------------------------------------------

def _mcq(number, marks=1, answer_source="model"):
    return _q(
        number, f"Question {number}?", qtype="MCQS", marks=marks,
        options=[
            {"type": "HTML", "preview_id": "1", "content": "A"},
            {"type": "HTML", "preview_id": "2", "content": "B"},
        ],
        correct_options=["2"], answer_source=answer_source,
    )


def test_build_paper_merges_rounds_dedupes_and_stamps_provenance_and_rubric():
    round1 = {
        "title": "Half Yearly Mock", "total_marks": 7, "duration_minutes": 90,
        "sections": [{"name": "Section A", "instruction": "All compulsory", "marks_each": 1}],
        "questions": [_mcq("1"), _q("2", "Describe soil.", marks=5, marking_points=["types", "uses"])],
        "notes": ["Q2 has an OR choice"], "is_process_completed": False,
    }
    round2 = {
        "questions": [_mcq("1"), _mcq("3", answer_source="paper")],  # Q1 repeated by the model
        "notes": ["Q2 has an OR choice"],
    }
    paper = pd.build_paper([round1, round2], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=7)

    assert paper.title == "Half Yearly Mock" and paper.total_marks == 7 and paper.duration_minutes == 90
    assert [q["question_number"] for q in paper.raw_questions] == ["1", "2", "3"]
    assert len(paper.questions) == 3
    dto = paper.questions[1]
    assert dto["question_type"] == "LONG_ANSWER"
    assert dto["source_type"] == pd.SOURCE_TYPE
    meta = json.loads(dto["source_meta"])
    assert meta == {
        "paper_url": "https://x/p.pdf", "paper_file": "p.pdf", "question_number": "2",
        "marks": 5, "marks_source": "printed", "section": None, "answer_source": None,
    }
    rubric = json.loads(dto["evaluation_criteria_json"])
    assert rubric["max_marks"] == 5 and [c["evaluation_guidelines"] for c in rubric["rubric"]] == ["types", "uses"]
    # The MCQ key comes through in both spellings the readers use.
    key = json.loads(paper.questions[0]["auto_evaluation_json"])["data"]
    assert key["correctOptionIds"] == key["correct_option_ids"]
    # One warning for the model-suggested key (Q1 only; Q3's was printed), notes deduplicated.
    assert sum("AI suggested answers for 1" in w for w in paper.warnings) == 1
    assert paper.warnings.count("Q2 has an OR choice") == 1
    assert paper.marks_total == 7


def test_build_paper_drops_unreadable_questions_but_keeps_the_rest():
    bad = _q("2", "", marks=1)  # no text → the formatter refuses it
    paper = pd.build_paper(
        [{"questions": [_mcq("1"), bad, _q("3", "ok", marks=2)]}],
        pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=None,
    )
    assert [q["question_number"] for q in paper.raw_questions] == ["1", "3"]
    assert any("left out: 2" in w for w in paper.warnings)


def test_build_paper_falls_back_to_the_file_name_as_title_and_normalises_types():
    paper = pd.build_paper(
        [{"questions": [_q("1", "x", qtype="mcq", marks=1, options=[
            {"type": "HTML", "preview_id": "1", "content": "A"},
            {"type": "HTML", "preview_id": "2", "content": "B"}], correct_options=["1"])]}],
        pdf_url="https://x/Class-7-Maths.pdf", file_name="Class-7-Maths.pdf", expected_total=None,
    )
    assert paper.title == "Class-7-Maths"
    assert paper.questions[0]["question_type"] == "MCQS"


# ---------------------------------------------------------------------------
# extraction rounds
# ---------------------------------------------------------------------------

def test_extract_questions_continues_until_the_model_says_done_and_sums_usage(monkeypatch):
    calls = []

    async def fake_generate_json(prompt, models, *, label):
        calls.append(prompt)
        if len(calls) == 1:
            data = {"title": "T", "questions": [_q("1", "a", marks=1), _q("2", "b", marks=1)],
                    "is_process_completed": False}
            return json.dumps(data), "m", {"prompt_tokens": 100, "completion_tokens": 50}
        data = {"questions": [_q("3", "c", marks=1)], "is_process_completed": True}
        return json.dumps(data), "m", {"prompt_tokens": 80, "completion_tokens": 20}

    monkeypatch.setattr(pd.llm_json, "generate_json", fake_generate_json)
    paper = asyncio.run(pd.extract_questions(
        "<p>Q1 a</p>", ["m"], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=3,
    ))
    assert len(calls) == 2
    assert "ALREADY returned questions 1, 2" in calls[1]
    assert [q["question_number"] for q in paper.raw_questions] == ["1", "2", "3"]
    assert (paper.prompt_tokens, paper.completion_tokens, paper.rounds) == (180, 70, 2)


def test_extract_questions_stops_when_a_round_adds_nothing_new(monkeypatch):
    calls = []

    async def fake_generate_json(prompt, models, *, label):
        calls.append(1)
        data = {"questions": [_q("1", "a", marks=1)], "is_process_completed": False}
        return json.dumps(data), "m", {}

    monkeypatch.setattr(pd.llm_json, "generate_json", fake_generate_json)
    paper = asyncio.run(pd.extract_questions(
        "<p>x</p>", ["m"], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=None,
    ))
    assert len(calls) == 2  # first round, then one that repeated itself
    assert len(paper.raw_questions) == 1


def test_extract_questions_keeps_images_through_the_tag_protector(monkeypatch):
    seen = {}

    async def fake_generate_json(prompt, models, *, label):
        seen["prompt"] = prompt
        marker = prompt[prompt.index("<!--DS_TAG:"):prompt.index("-->") + 3]
        data = {"questions": [_q("1", f"Look: {marker}", marks=1)], "is_process_completed": True}
        return json.dumps(data), "m", {}

    monkeypatch.setattr(pd.llm_json, "generate_json", fake_generate_json)
    paper = asyncio.run(pd.extract_questions(
        '<p>Q1 <img src="https://cdn/fig.png"></p>', ["m"],
        pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=None,
    ))
    assert "cdn/fig.png" not in seen["prompt"]  # the model never sees the raw tag
    assert '<img src="https://cdn/fig.png">' in paper.questions[0]["text"]["content"]


# ---------------------------------------------------------------------------
# fetching the attachment
# ---------------------------------------------------------------------------

class _FakeResponse:
    def __init__(self, status_code=200, body=b"", headers=None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}

    async def aiter_bytes(self):
        step = 1024
        for i in range(0, len(self._body), step):
            yield self._body[i:i + step]


class _FakeStream:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc):
        return False


def _fake_client(response=None, error=None):
    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url):
            if error:
                raise error
            return _FakeStream(response)

    return _Client


def test_fetch_reads_a_real_pdf_and_counts_pages(monkeypatch):
    body = _pdf_bytes(pages=3)
    monkeypatch.setattr(pd.httpx, "AsyncClient", _fake_client(_FakeResponse(200, body, {"content-type": "application/pdf"})))
    pdf = asyncio.run(pd.fetch_paper_pdf("https://cdn.example.com/x/Mock%20Test%204.pdf"))
    assert pdf.pages == 3 and pdf.file_name == "Mock Test 4.pdf" and pdf.size_bytes == len(body)


@pytest.mark.parametrize(
    "url, response, error, message",
    [
        ("ftp://x/p.pdf", None, None, "not a valid web address"),
        ("https://x/p.pdf", _FakeResponse(403, b""), None, "HTTP 403"),
        ("https://x/p.pdf", _FakeResponse(200, b"", {}), None, "is empty"),
        ("https://x/p.docx", _FakeResponse(200, b"PK\x03\x04docx", {"content-type": "application/vnd.openxmlformats"}), None, "Only PDF"),
        ("https://x/p.pdf", _FakeResponse(200, b"%PDF-1.4 broken", {}), None, "not a readable PDF"),
        ("https://x/p.pdf", None, httpx.ConnectError("boom"), "Check that the attachment opens"),
        ("https://x/p.pdf", _FakeResponse(200, b"x", {"content-length": str(pd.MAX_PDF_BYTES + 1)}), None, "MB"),
    ],
)
def test_fetch_rejects_what_cannot_be_digitised(monkeypatch, url, response, error, message):
    monkeypatch.setattr(pd.httpx, "AsyncClient", _fake_client(response, error))
    with pytest.raises(pd.PaperPdfError) as excinfo:
        asyncio.run(pd.fetch_paper_pdf(url))
    assert message in str(excinfo.value)


def test_fetch_rejects_password_protected_and_oversized_page_counts(monkeypatch):
    monkeypatch.setattr(pd.httpx, "AsyncClient", _fake_client(_FakeResponse(200, _pdf_bytes(1, encrypt=True))))
    with pytest.raises(pd.PaperPdfError, match="password-protected"):
        asyncio.run(pd.fetch_paper_pdf("https://x/locked.pdf"))

    monkeypatch.setattr(pd, "MAX_PAGES", 2)
    monkeypatch.setattr(pd.httpx, "AsyncClient", _fake_client(_FakeResponse(200, _pdf_bytes(3))))
    with pytest.raises(pd.PaperPdfError, match="3 pages"):
        asyncio.run(pd.fetch_paper_pdf("https://x/long.pdf"))


def test_tool_params_and_pricing_key_exist():
    from app.services.tool_cost_estimator import DEFAULT_TOOL_PRICING
    assert pd.tool_params(4) == {"num_pages": 4}
    assert DEFAULT_TOOL_PRICING[pd.TOOL_KEY]["unit_field"] == "pages"


def test_ai_center_retry_refuses_a_digitise_task_instead_of_rerunning_it_generically():
    from app.services import retry_dispatch
    with pytest.raises(retry_dispatch.NotRetryable, match="offline test"):
        retry_dispatch.make_work(
            "PDF_TO_QUESTIONS", {"tool": pd.TOOL_KEY, "pdf_url": "https://x/p.pdf", "pages": 3}, ["m"],
            institute_id="inst", user_id="u", task_id="t",
        )
    # The generic PDF task is untouched.
    work = retry_dispatch.make_work(
        "PDF_TO_QUESTIONS", {"pdfId": "abc"}, ["m"], institute_id="inst", user_id="u", task_id="t",
    )
    assert callable(work)


# ---- 2026-09-20: the first real paper (Class IX English, 64 questions) -------
# Every question saved to the bank failed with `AssessmentRichTextData.content`
# NOT NULL, both TRUE_FALSE keys were lost, a NUMERIC with no answer claimed one,
# and the title carried literal <br>. Each of those is pinned here.


def _raw(**over):
    base = {"question_number": "1", "question": {"type": "HTML", "content": "Q?"}, "marks": 1,
            "answer_source": "model"}
    base.update(over)
    return base


def test_explanation_is_empty_string_never_null():
    paper = pd.build_paper(
        [{"questions": [_raw(question_type="LONG_ANSWER", marking_points=["a"]),
                        _raw(question_number="2", question_type="ONE_WORD", ans="x")]}],
        pdf_url="u", file_name="f.pdf", expected_total=None)
    assert [q["explanation_text"]["content"] for q in paper.questions] == ["", ""]


def test_true_false_key_written_as_the_word_maps_to_the_option():
    paper = pd.build_paper(
        [{"questions": [_raw(question_type="TRUE_FALSE", options=[], correct_options=["FALSE"], ans="FALSE"),
                        _raw(question_number="2", question_type="TRUE_FALSE", options=[], correct_options=["T"])]}],
        pdf_url="u", file_name="f.pdf", expected_total=None)
    keys = [json.loads(q["auto_evaluation_json"])["data"]["correct_option_ids"] for q in paper.questions]
    assert keys == [["2"], ["1"]]
    assert [r["answer_source"] for r in paper.raw_questions] == ["model", "model"]
    assert not any(w.startswith("No answer could be read") for w in paper.warnings)


def test_mcq_key_written_as_the_option_text_maps_and_letters_still_win():
    options = [{"preview_id": "1", "content": "Strata"}, {"preview_id": "2", "content": "<b>Parity</b>"}]
    paper = pd.build_paper(
        [{"questions": [_raw(question_type="MCQS", options=options, correct_options=["parity"]),
                        _raw(question_number="2", question_type="MCQS", options=options, correct_options=["A"])]}],
        pdf_url="u", file_name="f.pdf", expected_total=None)
    keys = [json.loads(q["auto_evaluation_json"])["data"]["correct_option_ids"] for q in paper.questions]
    assert keys == [["2"], ["1"]]


def test_yes_no_and_t_f_options_match_their_own_words():
    from app.services.question_format import match_option_text
    yes_no = [{"preview_id": "1", "text": {"content": "Yes"}}, {"preview_id": "2", "text": {"content": "No"}}]
    t_f = [{"preview_id": "1", "text": {"content": "T"}}, {"preview_id": "2", "text": {"content": "F"}}]
    assert match_option_text(["yes"], yes_no) == ["1"]
    assert match_option_text(["FALSE"], t_f) == ["2"]
    assert match_option_text(["maybe"], yes_no) == []


def test_objective_question_without_a_usable_key_is_flagged_not_pretended():
    paper = pd.build_paper(
        [{"questions": [_raw(question_number="2", question_type="NUMERIC", ans="", answer_source="model"),
                        _raw(question_number="7", question_type="MCQS",
                           options=[{"preview_id": "1", "content": "a"}], correct_options=["zzz"])]}],
        pdf_url="u", file_name="f.pdf", expected_total=None)
    assert [r["answer_source"] for r in paper.raw_questions] == ["none", "none"]
    for q in paper.questions:
        meta = json.loads(q["source_meta"])
        rubric = json.loads(q["evaluation_criteria_json"])["rubric"][0]["evaluation_guidelines"]
        assert meta["answer_source"] == "none"
        assert rubric.startswith("No answer key was available")
    assert any("question(s) 2, 7" in w for w in paper.warnings)
    # they are not counted among the model's suggested answers either
    assert not any("suggested answers" in w for w in paper.warnings)


def test_title_loses_printed_line_breaks():
    paper = pd.build_paper(
        [{"title": "ENGLISH GRAMMAR <br> Part Test-04 &lt;br&gt; Class IX", "questions": [_raw(question_type="ONE_WORD", ans="x")]}],
        pdf_url="u", file_name="f.pdf", expected_total=None)
    assert paper.title == "ENGLISH GRAMMAR - Part Test-04 - Class IX"
    assert pd.clean_title("<b>Maths</b>") == "Maths"
    assert pd.clean_title(None) == ""


def test_a_flattened_question_shape_is_repaired_not_fatal():
    # 2026-09-20: one `"question": "text"` (a bare string) failed the whole read
    # with `'str' object has no attribute 'get'` in _dedupe_key.
    rounds = [{"questions": [
        {"question_number": "1", "question": "State Newton's first law.", "question_type": "LONG_ANSWER",
         "marks": 2, "marking_points": "inertia", "tags": "laws"},
        {"question_number": "2", "question": {"type": "HTML", "content": "Pick one"}, "question_type": "MCQS",
         "options": ["Red", "Blue"], "correct_options": "2", "marks": 1, "answer_source": "model"},
    ]}]
    paper = pd.build_paper(rounds, pdf_url="u", file_name="f.pdf", expected_total=None)
    assert [q["text"]["content"] for q in paper.questions] == ["State Newton's first law.", "Pick one"]
    mcq = json.loads(paper.questions[1]["auto_evaluation_json"])["data"]
    assert mcq["correct_option_ids"] == ["2"]
    assert paper.questions[1]["options"][1]["text"]["content"] == "Blue"
    rubric = json.loads(paper.questions[0]["evaluation_criteria_json"])["rubric"]
    assert rubric[0]["evaluation_guidelines"] == "inertia"


def test_section_header_count_times_marks_means_marks_each_is_the_second_number():
    # "(8 × 1 = 8 Marks)" was read as marks_each 8; eight one-mark tense items
    # became 8/8 each on the first real copy check.
    rounds = [{"sections": [{"name": "Section B", "marks_each": 8, "question_count": 8, "total_marks": 8}],
               "questions": [_raw(question_number=str(i), section="Section B", question_type="ONE_WORD",
                                   ans="x", marks=None) for i in range(1, 4)]}]
    paper = pd.build_paper(rounds, pdf_url="u", file_name="f.pdf", expected_total=None)
    assert [r["marks"] for r in paper.raw_questions] == [1.0, 1.0, 1.0]
    assert paper.sections[0]["marks_each"] == 1.0
    # a consistent header is left alone; no header figures → the model's value stands
    assert pd._section_marks_each({"marks_each": 2, "question_count": 5, "total_marks": 10}) == 2
    assert pd._section_marks_each({"marks_each": 3}) == 3
    assert pd._section_marks_each({}) is None


# ---------------------------------------------------------------------------
# internal choice ("answer any FOUR of the following")
# ---------------------------------------------------------------------------

def _lit_paper_round():
    """The shape of the X English Literature paper: 18 printed questions, MM 40."""
    qs = [_q(f"VI({i})", f"Extract question {i}?", marks=m, section="VI") for i, m in zip("1234", (1, 1, 1, 2))]
    qs += [_q(f"VII({i})", f"Poem question {i}?", marks=m, section="VII") for i, m in zip("1234", (1, 1, 1, 2))]
    qs += [_q(str(i), f"Short answer {i}?", section="VIII") for i in range(1, 6)]   # marks from the header
    qs += [_q(str(i), f"Short answer B{i}?", section="IX") for i in range(1, 4)]
    qs += [_q("X", "Long answer X?", marks=6, section="X"), _q("XI", "Long answer XI?", marks=6, section="XI")]
    return {
        "title": "Literature", "total_marks": 40,
        "sections": [
            {"name": "VI", "instruction": "Read the extract"},
            {"name": "VII", "instruction": "Read the extract"},
            # The model reads "(4*3M=12)" as count 4 - or as the 5 printed; both must give 3 each.
            {"name": "VIII", "instruction": "Answer any FOUR", "marks_each": 3, "question_count": 5,
             "total_marks": 12, "attempt": 4},
            {"name": "IX", "instruction": "Answer any TWO", "question_count": 2, "total_marks": 6, "attempt": 2},
            {"name": "X", "instruction": ""}, {"name": "XI", "instruction": ""},
        ],
        "questions": qs,
    }


def test_any_n_sections_become_choice_groups_and_the_paper_totals_40_not_46():
    paper = pd.build_paper([_lit_paper_round()], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=40)

    marks = {f'{q["section"]}:{q["question_number"]}': q["marks"] for q in paper.raw_questions}
    assert [marks[f"VIII:{i}"] for i in range(1, 6)] == [3, 3, 3, 3, 3]   # 12 / attempt 4, never 12 / 5 printed
    assert [marks[f"IX:{i}"] for i in range(1, 4)] == [3, 3, 3]
    assert paper.marks_total == 46                     # every printed question, as before
    assert paper.paper_total == 40                     # what the paper is out of
    groups = paper.choice_groups
    assert [(g["label"], g["attempt"], g["policy"], len(g["question_indexes"])) for g in groups] == [
        ("VIII", 4, "best", 5), ("IX", 2, "best", 3)]
    # Positions point at the questions handed to the assessment builder.
    assert [paper.raw_questions[i]["section"] for i in groups[0]["question_indexes"]] == ["VIII"] * 5
    assert not any("add up to" in w for w in paper.warnings)
    out = paper.to_dict()
    assert out["paper_total"] == 40 and out["choice_groups"] == groups


def test_a_wrong_stated_total_is_still_reported_against_the_choice_total():
    paper = pd.build_paper([{**_lit_paper_round(), "total_marks": 45}], pdf_url="https://x/p.pdf",
                           file_name="p.pdf", expected_total=None)
    assert any("states 45 marks but the questions add up to 40" in w for w in paper.warnings)


def test_attempt_not_below_the_section_size_is_no_choice():
    round_ = _lit_paper_round()
    for s in round_["sections"]:
        if s["name"] == "IX":
            s["attempt"] = 3          # all three answered: not a choice
    paper = pd.build_paper([round_], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=None)
    assert [g["label"] for g in paper.choice_groups] == ["VIII"]
    # IX is now three compulsory questions sharing the header's 6 marks.
    assert [q["marks"] for q in paper.raw_questions if q["section"] == "IX"] == [2, 2, 2]
    assert paper.paper_total == 40


def test_a_paper_without_choice_is_unchanged():
    round_ = _lit_paper_round()
    for s in round_["sections"]:
        s.pop("attempt", None)
    round_["sections"][2].update(question_count=4, total_marks=12)
    paper = pd.build_paper([round_], pdf_url="https://x/p.pdf", file_name="p.pdf", expected_total=None)
    assert paper.choice_groups == [] and paper.paper_total == paper.marks_total
    assert any("states 40 marks but the questions add up to" in w for w in paper.warnings)


def test_prompt_asks_for_attempt_and_the_printed_maximum():
    prompt = pd._build_prompt("<p>x</p>", [])
    assert '"attempt": number | null' in prompt and "Internal choice" in prompt
    assert "MM: 40" in prompt
