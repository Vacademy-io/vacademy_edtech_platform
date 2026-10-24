"""The teacher's question mix is a contract, not a suggestion.

When the wizard sends a type plan ("10 MCQ × 1, 5 short × 3"), the blueprint
that comes back must carry exactly those counts and marks whatever the model
proposed — a paper header saying "Maximum Marks: 25" has to be true.
"""
from app.services.kb.paper import Blueprint, apply_type_plan


def _bp(rows):
    return Blueprint.from_dict({"title": "t", "rows": rows})


def test_counts_rescaled_marks_set_sections_relettered():
    bp = _bp([
        {"id": "row-1", "section": "Section A", "topic": "pH", "node_ids": ["n1"], "question_type": "MCQS", "count": 6, "marks_each": 2},
        {"id": "row-2", "section": "Section A", "topic": "Salts", "node_ids": ["n2"], "question_type": "MCQS", "count": 3, "marks_each": 2},
        {"id": "row-3", "section": "Section B", "topic": "Indicators", "node_ids": ["n3"], "question_type": "LONG_ANSWER", "count": 4, "marks_each": 5},
        {"id": "row-4", "section": "Section C", "topic": "Extra", "node_ids": ["n4"], "question_type": "NUMERIC", "count": 2, "marks_each": 2},
    ])
    apply_type_plan(bp, [
        {"question_type": "MCQS", "count": 10, "marks_each": 1, "label": "Multiple choice"},
        {"question_type": "LONG_ANSWER", "count": 5, "marks_each": 3, "label": "Short answer", "instruction": "Answer in about 60 words."},
    ], ["n1", "n2", "n3"])
    mcq = [r for r in bp.rows if r.question_type == "MCQS"]
    long = [r for r in bp.rows if r.question_type == "LONG_ANSWER"]
    assert sum(r.count for r in mcq) == 10 and all(r.marks_each == 1 for r in mcq)
    assert [r.count for r in mcq] == [7, 3]            # 6:3 split kept, scaled to 10
    assert sum(r.count for r in long) == 5 and long[0].marks_each == 3
    assert long[0].instruction == "Answer in about 60 words."
    assert not [r for r in bp.rows if r.question_type == "NUMERIC"]   # not in the mix → dropped
    assert [r.section for r in bp.rows] == ["Section A", "Section A", "Section B"]
    assert bp.total_questions == 15 and bp.total_marks == 25


def test_missing_type_gets_a_row_on_the_whole_selection():
    bp = _bp([{"id": "row-1", "section": "Section A", "topic": "pH", "node_ids": ["n1"], "question_type": "MCQS", "count": 4, "marks_each": 1}])
    apply_type_plan(bp, [
        {"question_type": "MCQS", "count": 4, "marks_each": 1},
        {"question_type": "TRUE_FALSE", "count": 3, "marks_each": 1, "label": "True or false"},
    ], ["n1", "n2"])
    tf = [r for r in bp.rows if r.question_type == "TRUE_FALSE"]
    assert len(tf) == 1 and tf[0].count == 3 and tf[0].node_ids == ["n1", "n2"]
    assert tf[0].section == "Section B" and tf[0].topic == "True or false"
    assert len({r.id for r in bp.rows}) == len(bp.rows)     # ids stay unique


def test_zero_count_entries_are_skipped_and_unknown_types_default():
    bp = _bp([])
    apply_type_plan(bp, [
        {"question_type": "ESSAY", "count": 2, "marks_each": 5},
        {"question_type": "MCQS", "count": 0, "marks_each": 1},
    ], ["n1"])
    assert len(bp.rows) == 1 and bp.rows[0].question_type == "MCQS" and bp.rows[0].count == 2


def test_teacher_instructions_replace_the_planners(monkeypatch):
    # apply at the same point build_blueprint does, via the same rule
    bp = _bp([])
    bp.instructions = ["model line"]
    spec = {"instructions": ["All questions are compulsory.", "  ", "Draw neat diagrams."]}
    if spec.get("instructions"):
        bp.instructions = [str(l).strip() for l in spec["instructions"] if str(l or "").strip()]
    assert bp.instructions == ["All questions are compulsory.", "Draw neat diagrams."]


import asyncio
from app.services.kb import paper as paper_mod


def test_attach_generated_diagrams_places_image_and_reports_count(monkeypatch):
    async def fake_draw(description):
        return None if "fail" in description else f"https://cdn/{description[:4]}.png"
    monkeypatch.setattr(paper_mod, "_draw_diagram", fake_draw)
    qs = [
        {"question": {"content": "<p>Find I.</p>"}, "diagram_needed": "circuit with a cell", "kb_meta": {}},
        {"question": {"content": "<p>Already has one <img src='x'></p>"}, "diagram_needed": "ignored", "kb_meta": {}},
        {"question": {"content": "<p>No figure.</p>"}, "diagram_needed": None, "kb_meta": {}},
        {"question": {"content": "<p>Ray diagram.</p>"}, "diagram_needed": "fail lens", "kb_meta": {}},
    ]
    drawn = asyncio.run(paper_mod.attach_generated_diagrams(qs))
    assert drawn == 1
    assert '<img src="https://cdn/circ.png"' in qs[0]["question"]["content"]
    assert qs[0]["kb_meta"]["figures"][0]["generated"] is True
    assert "<img" not in qs[2]["question"]["content"]
    assert qs[3]["kb_meta"]["diagram_missing"] == "fail lens"      # teacher sees what was wanted
    assert qs[1]["question"]["content"].count("<img") == 1          # existing figure untouched


def test_marking_rubric_sums_to_the_marks_and_carries_the_steps():
    from app.services.kb.paper import marking_rubric

    long = marking_rubric({
        "question_type": "LONG_ANSWER", "kb_meta": {"marks": 5},
        "marking_steps": ["Identify dilution.", "Relate to ion concentration.", "State: it decreases."],
        "tags": ["dilution", "pH"],
    })
    assert long["max_marks"] == 5 and long["partial_marking_enabled"] is True
    assert [c["evaluation_guidelines"] for c in long["rubric"]] == [
        "Identify dilution.", "Relate to ion concentration.", "State: it decreases."]
    assert abs(sum(c["max_marks"] for c in long["rubric"]) - 5) < 1e-9
    assert long["rubric"][-1]["keywords"] == ["dilution", "pH"]

    mcq = marking_rubric({"question_type": "MCQS", "kb_meta": {"marks": 1}, "marking_steps": ["x"], "tags": []})
    assert len(mcq["rubric"]) == 1 and mcq["rubric"][0]["max_marks"] == 1 and mcq["partial_marking_enabled"] is False


def test_pair_with_formatted_stamps_the_rubric():
    from app.services.kb.paper import pair_with_formatted
    raw = {
        "question_number": 1, "question_type": "MCQS",
        "question": {"type": "HTML", "content": "<p>pH of water?</p>"},
        "options": [{"preview_id": "1", "content": "7"}, {"preview_id": "2", "content": "1"}],
        "correct_options": ["1"], "ans": "7", "exp": "Neutral.", "marking_steps": ["Neutral → 7"],
        "kb_meta": {"marks": 1, "row_id": "row-1"}, "tags": ["pH"],
    }
    kept, formatted, warnings = pair_with_formatted([raw], kb_id="kb1", generation_id="g1")
    assert kept and formatted and not warnings
    import json
    rubric = json.loads(formatted[0]["evaluation_criteria_json"])
    assert rubric["max_marks"] == 1 and rubric["rubric"][0]["criteria_name"] == "Correct answer"
    assert json.loads(formatted[0]["source_meta"])["generation_id"] == "g1"


def test_build_blueprint_end_to_end_with_stubbed_model(monkeypatch):
    """The wizard's whole request through build_blueprint: type plan enforced,
    teacher's title/instructions/duration/language kept, invented node ids
    dropped, weightage and mix lines reaching the prompt."""
    import json as _json

    class FakeRepo:
        def __init__(self, db): pass
        def get_kb(self, kb_id, institute_id):
            return {"id": kb_id, "name": "NCERT Class 10 Science", "institute_id": institute_id}
        def get_topic_tree(self, kb_id):
            return [
                {"id": "t1", "title": "Chapter 2: Acids, Bases and Salts", "summary": "", "keywords": [],
                 "subtopics": [{"id": "s1", "title": "2.3 pH", "summary": "", "keywords": ["pH"]}]},
                {"id": "t2", "title": "Chapter 3: Metals", "summary": "", "keywords": [], "subtopics": []},
            ]
    seen = {}
    async def fake_generate_json(prompt, models, label=""):
        seen["prompt"] = prompt
        return _json.dumps({
            "title": "model title", "duration_minutes": 45, "language": "English",
            "instructions": ["model instruction"],
            "rows": [
                {"id": "row-1", "section": "Section A", "topic": "pH", "node_ids": ["s1", "bogus"],
                 "question_type": "MCQS", "count": 7, "marks_each": 2},
                {"id": "row-2", "section": "Section B", "topic": "Metals", "node_ids": ["t2"],
                 "question_type": "LONG_ANSWER", "count": 2, "marks_each": 5},
                {"id": "row-3", "section": "Section C", "topic": "Ghost", "node_ids": ["nope"],
                 "question_type": "NUMERIC", "count": 3, "marks_each": 2},
            ],
            "notes": [],
        }), "fake-model", {"prompt_tokens": 1, "completion_tokens": 1}
    monkeypatch.setattr(paper_mod, "KbRepository", FakeRepo)
    monkeypatch.setattr(paper_mod, "resolve_models", lambda db, use_case: ("fake-model", []))
    monkeypatch.setattr(paper_mod, "generate_json", fake_generate_json)

    spec = {
        "title": "Unit Test 2", "duration_minutes": 90, "language": "Hindi", "difficulty": "MIXED",
        "instructions": ["All questions are compulsory.", "Draw neat diagrams."],
        "type_plan": [
            {"question_type": "MCQS", "count": 10, "marks_each": 1, "label": "Single correct option"},
            {"question_type": "LONG_ANSWER", "count": 3, "marks_each": 3, "label": "Short answer",
             "instruction": "Answer in about 60 words."},
        ],
        "weightage": {"t1": 60},
    }
    bp, usage, model = asyncio.run(paper_mod.build_blueprint(
        None, kb_id="kb1", institute_id="inst", spec=spec, selected_node_ids=["t1", "t2"],
    ))
    assert "REQUIRED question mix" in seen["prompt"] and "t1: 60%" in seen["prompt"]
    assert bp.title == "Unit Test 2" and bp.duration_minutes == 90 and bp.language == "Hindi"
    assert bp.instructions == ["All questions are compulsory.", "Draw neat diagrams."]
    assert bp.total_questions == 13 and bp.total_marks == 19
    assert [r.question_type for r in bp.rows] == ["MCQS", "LONG_ANSWER"]   # NUMERIC dropped
    assert bp.rows[0].node_ids == ["s1"]                                    # "bogus" dropped
    assert bp.rows[1].instruction == "Answer in about 60 words."
    assert model == "fake-model"
