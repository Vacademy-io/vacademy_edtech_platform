"""Live AI Tutor compiler — the contracts everything else hangs off.

Board ops: only whitelisted ops, stable unique ids, safe SVG, https media, and
a deterministic HTML render. Validator: small boards, narration in both
languages, checks on every concept but a topic's first. Quiz compiler: a quiz
slide becomes a plan with no model call, correct answers resolved from every
auto_evaluation_json shape the platform has used. Prompt helper: JSON is
extracted from fenced or chatty replies.
"""
import json

import pytest

from app.schemas.tutor import TeachingPlanDraft
from app.services.tutor import board_ops, compile_prompts
from app.services.tutor.plan_validator import QUIZ_LIMITS, validate_plan
from app.services.tutor.quiz_compiler import compile_quiz
from app.services.tutor.slide_source import QuizQuestion, SlideSource, _correct_option_ids, html_to_text


# ── board ops ────────────────────────────────────────────────────────────────

def test_sanitize_svg_strips_scripts_and_keeps_part_ids():
    raw = ('<svg viewBox="0 0 100 100"><script>alert(1)</script>'
           '<circle id="nucleus" cx="50" cy="50" r="10" onclick="x()"/>'
           '<a href="javascript:evil()"><text x="1" y="2">hi</text></a></svg>')
    out = board_ops.sanitize_svg(raw)
    assert "<script" not in out and "onclick" not in out and "javascript:" not in out
    assert 'id="nucleus"' in out
    assert board_ops.svg_ids(out) == {"nucleus"}


def test_materialize_escapes_text_and_renders_each_op():
    ops = [
        {"op": "heading", "id": "h", "text": "<b>Force</b>"},
        {"op": "bullet", "id": "b", "items": ["push", "pull"]},
        {"op": "formula", "id": "f", "latex": "F = m a"},
        {"op": "image", "id": "i", "url": "https://x.test/a.png", "description": "a ball"},
        {"op": "image", "id": "bad", "url": "http://x.test/a.png", "description": "insecure"},
        {"op": "callout", "id": "c", "text": "tip", "kind": "tip"},
        {"op": "annotate", "id": "a", "target": "b", "text": "note"},
        {"op": "highlight", "target": "b"},
    ]
    html = board_ops.materialize(ops)
    assert "&lt;b&gt;Force&lt;/b&gt;" in html and "<b>Force" not in html
    assert 'data-op-id="b"' in html and "<li>push</li>" in html
    assert 'data-latex="F = m a"' in html
    assert 'src="https://x.test/a.png"' in html
    assert "http://x.test" not in html            # non-https image dropped
    assert 'data-target="b"' in html
    assert "highlight" not in html                 # live-only op leaves no mark


def test_validate_ops_rejects_live_ops_duplicates_and_dangling_targets():
    ops = [
        {"op": "text", "id": "a", "text": "x"},
        {"op": "text", "id": "a", "text": "dup"},
        {"op": "annotate", "id": "n", "target": "missing", "text": "?"},
        {"op": "reveal", "target": "a"},
        {"op": "svg", "id": "s", "svg": "<svg><rect id='r'/></svg>", "description": "d", "parts": [{"id": "nope", "label": "x"}]},
    ]
    errors, ids = board_ops.validate_ops(ops)
    joined = " | ".join(errors)
    assert "duplicate element id 'a'" in joined
    assert "annotate target 'missing'" in joined
    assert "'reveal' is a live-session op" in joined
    assert "svg part id" not in joined            # unknown parts are pruned, not fatal
    assert ids == {"a", "n", "s"}


def test_svg_ids_accepts_single_quotes_and_clean_ops_prunes_unknown_parts():
    svg = "<svg viewBox='0 0 10 10'><circle id='nucleus' r='1'/><rect id=\"wall\" width='1' height='1'/></svg>"
    assert board_ops.svg_ids(svg) == {"nucleus", "wall"}
    out = board_ops.clean_ops([{"op": "svg", "id": "s", "svg": svg, "description": "cell",
                                "parts": [{"id": "nucleus", "label": "N"}, {"id": "ghost", "label": "?"}]}])
    assert [p["id"] for p in out[0]["parts"]] == ["nucleus"]


# ── validator ────────────────────────────────────────────────────────────────

def _plan(**overrides):
    base = {
        "language": "en",
        "objectives": ["Define force"],
        "key_terms": [{"term": "force", "meaning": "a push or a pull"}],
        "topics": [{
            "id": "t1", "title": "What is a force?", "estimated_seconds": 120,
            "concepts": [
                {"id": "t1c1", "title": "Push and pull", "concept_tags": ["force.definition"],
                 "board_ops": [{"op": "heading", "id": "t1-h", "text": "What is force?"},
                               {"op": "svg", "id": "t1c1-d", "svg": "<svg viewBox='0 0 10 10'><circle id='ball' r='2'/></svg>",
                                "description": "a ball being pushed", "parts": [{"id": "ball", "label": "Ball"}]},
                               {"op": "bullet", "id": "t1c1-b", "items": ["A push or a pull"]}],
                 "say": "A force is a push or a pull. Look at the board.",
                 "say_i18n": {"hi": "बल एक धक्का या खिंचाव है।"},
                 "check": {"type": "none"}},
                {"id": "t1c2", "title": "Examples", "concept_tags": ["force.examples"],
                 "board_ops": [{"op": "text", "id": "t1c2-t", "text": "Kicking a ball is a push."}],
                 "say": "Kicking a ball is a push. Pulling a rope is a pull.",
                 "say_i18n": {"hi": "गेंद को लात मारना धक्का है।"},
                 "check": {"type": "open", "prompt": "Give one push and one pull.",
                           "expected": "any push and any pull", "rubric": "one of each", "pass_threshold": 0.7}},
            ],
        }],
    }
    base.update(overrides)
    return TeachingPlanDraft.model_validate(base)


def test_valid_plan_passes():
    assert validate_plan(_plan(), "en") == []


def test_validator_catches_missing_translation_and_check():
    """Structural gaps stay fatal; a bloated board is quality advice instead
    (a plan is never thrown away for wordiness — see plan_validator's docstring)."""
    from app.services.tutor.plan_validator import board_quality_errors
    p = _plan()
    p.topics[0].concepts[1].say_i18n = {}
    p.topics[0].concepts[1].check.type = "none"
    bullet = next(op for op in p.topics[0].concepts[0].board_ops if getattr(op, "op", "") == "bullet")
    bullet.items = ["word"] * 80
    errors = " | ".join(validate_plan(p, "en"))
    assert "say_i18n['hi'] is missing" in errors
    assert "every concept after the first of a board needs a check" in errors
    assert "keep a concept under" not in errors
    assert "keep a concept under" in " | ".join(board_quality_errors(p))


def test_validator_rejects_ids_reused_across_concepts():
    p = _plan()
    p.topics[0].concepts[1].board_ops[0].id = "t1c1-b"
    errors = " | ".join(validate_plan(p, "en"))
    assert "duplicate element id 't1c1-b'" in errors


# ── quiz compiler ────────────────────────────────────────────────────────────

def _quiz_source():
    q1 = QuizQuestion(id="q1", order=1, question_type="MCQS", stem="What is 2+2?",
                      options=[{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}],
                      correct_option_ids=["o2"], correct_texts=["4"])
    q2 = QuizQuestion(id="q2", order=2, question_type="LONG_ANSWER", stem="Explain gravity.",
                      correct_texts=[], explanation="Mass attracts mass.")
    return SlideSource(slide_id="s", title="Arithmetic check", source_type="QUIZ", source_id="qs",
                       kind="quiz", questions=[q1, q2])


def test_quiz_compiles_deterministically_and_validates():
    draft = compile_quiz(_quiz_source(), "en")
    assert validate_plan(draft, "en", limits=QUIZ_LIMITS) == []
    assert len(draft.topics) == 3                       # intro + one board per question
    intro, q1, q2 = (t.concepts[0] for t in draft.topics)
    assert intro.check.type == "none"
    assert q1.check.type == "mcq" and q1.check.options == ["3", "4"]
    assert q1.check.expected == "4" and q1.check.pass_threshold == 1.0
    assert q2.check.type == "open" and "Mass attracts" in (q2.check.expected or "")
    assert "{student_name}" in intro.say
    assert q1.say_i18n["hi"]


@pytest.mark.parametrize("auto_json,expected", [
    ('{"correctAnswers":[1]}', ["o2"]),                      # 0-based index (copilot)
    ('{"correctAnswers":["o1"]}', ["o1"]),                   # option ids
    ('{"data":{"correctOptionIds":["o2"]}}', ["o2"]),        # nested shape
    ('{"validAnswers":["2"]}', ["o2"]),                      # 1-based string
    ('not json', []),
    (None, []),
])
def test_correct_option_ids_handles_every_shape(auto_json, expected):
    options = [{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}]
    assert _correct_option_ids(auto_json, options) == expected


# ── source text + prompts ────────────────────────────────────────────────────

def test_html_to_text_keeps_structure_and_drops_scripts():
    html = "<h2>Force</h2><script>x</script><p>A push or a pull.</p><ul><li>push</li><li>pull</li></ul><img alt='ball'>"
    txt = html_to_text(html)
    assert "## Force" in txt and "- push" in txt and "[image: ball]" in txt and "x" != txt.strip()
    assert "script" not in txt


def test_extract_json_tolerates_fences_and_prose():
    obj = {"topics": []}
    assert compile_prompts.extract_json("```json\n" + json.dumps(obj) + "\n```") == obj
    assert compile_prompts.extract_json("Here you go: " + json.dumps(obj) + " done") == obj
    assert compile_prompts.extract_json("no json here") is None


def test_prompts_mention_both_languages_and_ops():
    sys_ = compile_prompts.system_prompt("Asha", "en")
    assert "Asha" in sys_ and "media_task" not in sys_.split("BOARD OPERATIONS")[0]
    user = compile_prompts.user_prompt(slide_title="Force", chapter_title="Motion", course_title="Physics",
                                       slide_kind="document", source_text="A force is a push.", lang="en")
    assert '"say_i18n": {"hi"' in user and "SLIDE MATERIAL" in user
    media = compile_prompts.media_task_user_prompt(slide_title="Cell video", chapter_title=None, course_title=None,
                                                   kind="video", description="It shows the parts of a cell.", lang="hi")
    assert '"media_task"' in media and '"say_i18n": {"en"' in media


# ── review fixes (2026-09-03 adversarial pass) ──────────────────────────────

from pydantic import ValidationError

from app.schemas.tutor import CompileRequest, RecompileOptions
from app.services.tutor.plan_validator import QUIZ_LIMITS


def test_media_task_without_url_is_allowed_before_media_stage_and_required_after():
    data = _plan().model_dump(by_alias=True)
    data["topics"][0]["concepts"][0]["board_ops"] = [
        {"op": "media_task", "id": "t1c1-m", "kind": "video", "description": "Watch the cell video"}
    ]
    p = TeachingPlanDraft.model_validate(data)
    assert validate_plan(p, "en", require_media_urls=False) == []
    errors = " | ".join(validate_plan(p, "en", require_media_urls=True))
    assert "media_task needs a url or file_id" in errors


def test_quiz_with_many_long_mcqs_validates_under_quiz_limits():
    stem = "Which of the following statements about the assessment of the olfactory nerve is correct in a patient " \
           "presenting with a head injury and reduced sense of smell after a road traffic accident?"
    opts = [{"id": f"o{i}", "text": f"Option {i}: a fairly long distractor sentence that a clinician might write here"} for i in range(6)]
    qs = [QuizQuestion(id=f"q{i}", order=i, question_type="MCQS", stem=stem, options=opts,
                       correct_option_ids=["o2"], correct_texts=[opts[2]["text"]]) for i in range(1, 9)]
    src = SlideSource(slide_id="s", title="Cranial nerves check", source_type="QUIZ", source_id="q", kind="quiz", questions=qs)
    draft = compile_quiz(src, "en")
    assert len(draft.topics) == 9                      # intro + one board per question
    assert validate_plan(draft, "en", limits=QUIZ_LIMITS) == []
    assert all(len(t.concepts) == 1 for t in draft.topics[1:])


def test_bad_op_yields_one_targeted_error_not_one_per_union_member():
    data = _plan().model_dump(by_alias=True)
    data["topics"][0]["concepts"][0]["board_ops"] = [{"op": "bullet", "id": "x"}]   # missing items
    with pytest.raises(ValidationError) as ei:
        TeachingPlanDraft.model_validate(data)
    assert len(ei.value.errors()) <= 2
    data["topics"][0]["concepts"][0]["board_ops"] = [{"op": "explode", "id": "x"}]
    with pytest.raises(ValidationError) as ei:
        TeachingPlanDraft.model_validate(data)
    assert len(ei.value.errors()) == 1 and "explode" in str(ei.value)


def test_clean_ops_sanitizes_svg_and_drops_unsafe_media():
    ops = [
        {"op": "svg", "id": "s", "svg": '<svg><circle id="c" r="1" style="fill:url(javascript:x)"/><script>1</script></svg>', "description": "d"},
        {"op": "svg", "id": "empty", "svg": "<script>only</script>", "description": "d"},
        {"op": "image", "id": "i", "url": "http://insecure/x.png", "description": "d"},
        {"op": "image", "id": "ok", "url": "https://x.test/a.png", "description": "d"},
        {"op": "media_task", "id": "m", "kind": "pdf", "description": "read"},
    ]
    out = board_ops.clean_ops(ops)
    ids = [o["id"] for o in out]
    assert ids == ["s", "ok"]
    assert "<script" not in out[0]["svg"] and 'style=' not in out[0]["svg"] and 'id="c"' in out[0]["svg"]


def test_svg_style_attribute_is_stripped():
    out = board_ops.sanitize_svg('<svg><rect id="r" style="fill:red" fill="red"/></svg>')
    assert "style=" not in out and 'fill="red"' in out


def test_compile_request_bounds():
    with pytest.raises(ValidationError):
        CompileRequest(package_id="p", compile_run_id="x" * 65)
    with pytest.raises(ValidationError):
        CompileRequest(package_id="p", language="fr")
    with pytest.raises(ValidationError):
        CompileRequest(package_id="p", slide_ids=[str(i) for i in range(401)])
    ok = CompileRequest(package_id="p", slide_ids=["a"], compile_run_id="run-1:abc", teacher_name="Asha")
    assert ok.language == "en" and ok.force is False
    assert RecompileOptions().teacher_name == "Asha"


@pytest.mark.asyncio
async def test_router_caller_rejects_non_staff(monkeypatch):
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.routers import tutor as tutor_router

    async def fake_principal(request, authorization, settings):
        return SimpleNamespace(institute_id="inst", user_id="u", roles=["STUDENT"], is_root_user=False)
    monkeypatch.setattr(tutor_router, "get_pinned_principal", fake_principal)
    with pytest.raises(HTTPException) as ei:
        await tutor_router._caller(request=None, authorization="Bearer x", settings=None)
    assert ei.value.status_code == 403

    async def staff_principal(request, authorization, settings):
        return SimpleNamespace(institute_id="inst", user_id="u", roles=["STUDENT", "ADMIN"], is_root_user=False)
    monkeypatch.setattr(tutor_router, "get_pinned_principal", staff_principal)
    caller = await tutor_router._caller(request=None, authorization="Bearer x", settings=None)
    assert caller.institute_id == "inst" and "ADMIN" in caller.roles


def test_missing_check_on_first_concept_is_allowed_and_empty_checks_normalize_to_none():
    data = _plan().model_dump(by_alias=True)
    del data["topics"][0]["concepts"][0]["check"]                      # omitted entirely
    data["topics"][0]["concepts"][1]["check"] = {"type": "open"}      # present but empty
    p = TeachingPlanDraft.model_validate(data)
    assert p.topics[0].concepts[0].check.type == "none"
    errors = validate_plan(p, "en")
    assert p.topics[0].concepts[1].check.type == "none"                # coerced, not rejected as empty
    joined = " | ".join(errors)
    assert "check needs a prompt" not in joined
    assert "every concept after the first of a board needs a check" in joined   # still required later


def test_board_without_anything_to_look_at_is_advice_not_a_failure():
    from app.services.tutor.plan_validator import board_quality_errors
    p = _plan()
    p.topics[0].concepts[0].board_ops = [op for op in p.topics[0].concepts[0].board_ops if getattr(op, "op", "") != "svg"]
    assert validate_plan(p, "en") == []                                   # still servable
    assert "nothing to look at" in " | ".join(board_quality_errors(p))     # but flagged once
    assert "nothing to look at" not in " | ".join(board_quality_errors(p, limits=QUIZ_LIMITS))


def test_structured_rubric_is_flattened_not_rejected():
    # 2026-09-23 speaking-skills demos: a source listing "Look for:" criteria
    # made the model return the rubric as a list / object, and the schema's
    # str type failed the whole compile after three model calls.
    from app.schemas.tutor import Check
    assert Check(type="open", prompt="p", rubric=["a hook", "under 15 words"]).rubric == "a hook; under 15 words"
    assert Check(type="open", prompt="p", rubric={"look_for": ["claim", "promise"], "avoid": "topic only"}).rubric \
        == "look_for: claim, promise; avoid: topic only"
    assert Check(type="open", prompt="p", rubric="plain prose").rubric == "plain prose"
    assert Check().rubric is None


def test_missing_concept_title_is_derived_not_fatal():
    from app.schemas.tutor import ConceptDraft
    say = "Say your own three sentences now, present past future."
    assert ConceptDraft(id="c1", title="Kept", say=say).title == "Kept"
    assert ConceptDraft(id="c1", name="From an alternate key", say=say).title == "From an alternate key"
    assert ConceptDraft(id="c1", say=say).title == "Say your own three sentences now…"
    assert ConceptDraft(id="open-with-hook", say="  ").title == "Open with hook"
    with pytest.raises(ValidationError):
        ConceptDraft(say="no id")  # the id stays mandatory: ops and checks reference it
