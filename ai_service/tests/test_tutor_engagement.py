"""Engagement build (review of 2026-09-05): diagram gate + auto layout, the
soft engagement rules, columns, predict-then-reveal, live notes, the
sentence segmenter and the learner's pace — the parts without a DB."""
from app.schemas.tutor import TeachingPlanDraft
from app.services.tutor import board_ops
from app.services.tutor.plan_validator import DEFAULT_LIMITS, QUIZ_LIMITS, soft_errors, validate_plan
from app.services.tutor.svg_check import auto_layout_svg, check_svg_geometry
from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.decision import _sanitize_ops
from app.routers.tutor_ws import PACE_MULTIPLIER, _step_pace, _tutor_segments

GOOD_SVG = ("<svg viewBox='0 0 640 360'><g id='a'><rect x='40' y='120' width='200' height='80' rx='10' fill='#DBEAFE' stroke='#1D4ED8' stroke-width='2'/>"
            "<text x='140' y='166' text-anchor='middle' font-size='18'>Impairment</text></g>"
            "<g id='b'><rect x='400' y='120' width='200' height='80' rx='10' fill='#DCFCE7' stroke='#15803D' stroke-width='2'/>"
            "<text x='500' y='166' text-anchor='middle' font-size='18'>Disability</text></g>"
            "<line x1='240' y1='160' x2='396' y2='160' stroke='#475569' stroke-width='2'/></svg>")
BAD_SVG = ('<svg viewBox="0 0 400 150"><text x="30" y="75" font-size="14">Clinical Information</text>'
           '<path d="M 150 75 L 250 75" stroke="black" fill="none"/><text x="165" font-size="14">Assessment</text></svg>')


def test_svg_gate_flags_the_real_bad_diagram_and_passes_a_good_one():
    assert check_svg_geometry(GOOD_SVG) == []
    errs = check_svg_geometry(BAD_SVG)
    text = " ".join(errs)
    assert "viewBox is 400x150" in text and "no y coordinate" in text and "14px" in text


def test_auto_layout_draws_every_part_with_ids_and_passes_the_gate():
    parts = [{"id": "impairment", "label": "Impairment", "step": 0}, {"id": "limitation", "label": "Functional Limitation", "step": 1},
             {"id": "disability", "label": "Disability", "step": 2}]
    svg, used = auto_layout_svg("Levels of disablement", parts)
    assert check_svg_geometry(svg, used) == []
    assert [u["id"] for u in used] == ["impairment", "limitation", "disability"] and used[2]["step"] == 2
    assert svg.count("<g id=") == 3 and "marker-end" in svg and board_ops.sanitize_svg(svg)


def _plan(quick=True, with_engagement=True):
    def check(kind, prompt, i):
        c = {"type": kind, "prompt": prompt, "expected": "x", "hint": "think about the body part first", "pass_threshold": 0.7,
             "prompt_i18n": {"hi": "ऐसा क्यों है?"}, "hint_i18n": {"hi": "पहले body part के बारे में सोचिए"}}
        if kind == "mcq":
            c["options"] = ["a", "b", "c"]
        return c
    topics = []
    for t in range(2):
        concepts = []
        for c in range(3):
            cid = f"t{t + 1}c{c + 1}"
            ops = [{"op": "heading", "id": f"{cid}-h", "text": "T", "say_index": 0},
                   {"op": "svg", "id": f"{cid}-s", "svg": GOOD_SVG, "description": "two boxes and a line", "parts": [{"id": "a", "label": "A"}], "say_index": 1}]
            if c == 1 and with_engagement:
                ops.append({"op": "callout", "id": f"{cid}-e", "kind": "example", "text": "A pianist with arthritis.", "say_index": 1})
            concept = {"id": cid, "title": f"C{c}", "board_ops": ops, "say": "One idea. Another idea.", "say_i18n": {"hi": "एक। दो।"},
                       "check": check("mcq" if (quick and c == 1) else "open", "Why is that?", c) if c > 0 else {"type": "none"}}
            if t > 0 and c == 0 and with_engagement:
                concept["predict"] = "What do you think happens next?"
                concept["predict_i18n"] = {"hi": "आपको क्या लगता है आगे क्या होगा?"}
            concepts.append(concept)
        topic = {"id": f"t{t + 1}", "title": f"Topic {t}", "concepts": concepts,
                 "summary_ops": [{"op": "bullet", "id": f"t{t + 1}-recap", "items": ["one", "two", "three"]}] if with_engagement else [],
                 "summary_say": "That is the topic in short." if with_engagement else None,
                 "summary_say_i18n": {"hi": "संक्षेप में यही topic है।"} if with_engagement else {}}
        topics.append(topic)
    return TeachingPlanDraft.model_validate({"language": "en", "objectives": ["o"], "topics": topics})


def test_engagement_rules_are_soft_and_specific():
    good = _plan()
    assert validate_plan(good, "en", limits=DEFAULT_LIMITS, require_media_urls=False) == []
    assert soft_errors(good) == []
    bare = _plan(quick=False, with_engagement=False)
    assert validate_plan(bare, "en", limits=DEFAULT_LIMITS, require_media_urls=False) == []   # still a valid plan
    text = " ".join(soft_errors(bare))
    assert "recap bullet" in text and "summary_say" in text and "'example'" in text and "predict" in text and "quick" in text
    assert soft_errors(bare, limits=QUIZ_LIMITS) == []   # quizzes are exempt


def test_columns_validate_render_and_count_words():
    op = {"op": "columns", "id": "cmp", "columns": [
        [{"op": "heading", "id": "l-h", "text": "Physical"}, {"op": "bullet", "id": "l-b", "items": ["body", "structure"]}],
        [{"op": "heading", "id": "r-h", "text": "Functional"}, {"op": "bullet", "id": "r-b", "items": ["tasks", "daily life"]}],
    ]}
    errors, ids = board_ops.validate_ops([op], set(), where="x.")
    assert errors == [] and {"cmp", "l-h", "l-b", "r-h", "r-b"} <= ids
    assert board_ops.op_words(op) == 7
    html = board_ops.materialize([op])
    assert 'class="tb-columns tb-columns-2"' in html and html.count('class="tb-col"') == 2 and 'data-op-id="r-b"' in html
    bad = dict(op, columns=[[{"op": "annotate", "id": "z", "target": "l-h", "text": "no"}]])
    errs, _ = board_ops.validate_ops([bad], set(), where="x.")
    assert any("columns needs 2 or 3" in e for e in errs) and any("may only hold" in e for e in errs)
    assert board_ops.clean_ops([op])[0]["columns"][0][0]["id"] == "l-h"


def test_predict_then_reveal_in_the_state_machine():
    L = sm.from_plan_view({
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [],
        "topics": [
            {"id": "t1", "title": "A", "order": 1, "summary_ops": [], "summary_say": "Recap one.", "concepts": [
                {"id": "a", "title": "a", "order": 1, "concept_tags": [], "board_ops": [], "say": "s", "say_i18n": {}, "teach_notes": None, "check": {"type": "none"}}]},
            {"id": "t2", "title": "B", "order": 2, "summary_ops": [], "concepts": [
                {"id": "b", "title": "b", "order": 1, "concept_tags": [], "board_ops": [{"op": "text", "id": "x", "text": "y"}], "say": "s",
                 "say_i18n": {}, "teach_notes": None, "check": {"type": "open", "prompt": "q", "expected": "e", "hint": "a nudge here"}, "predict": "Guess?"}]},
        ],
    })
    assert L.topics[0].summary_say == "Recap one." and L.topics[1].concepts[0].hint == "a nudge here"
    s = sm.enter(L, sm.Pointer())
    assert s.kind == "teach"
    s = sm.after_teach(L, s.pointer)                 # topic 1 done → summary
    assert s.kind == "topic_summary"
    s = sm.next_topic(L, s.pointer)                  # topic 2 opens with a guess, board cleared
    assert s.kind == "predict" and s.pointer.phase == sm.PREDICT and s.clear_board and s.board_ops == []
    s = sm.after_predict(L, s.pointer)               # then the teaching, without clearing again
    assert s.kind == "teach" and s.pointer.predicted and not s.clear_board and s.board_ops
    # repeat keeps the guess answered; advancing to a new concept resets it
    assert sm.repeat(L, s.pointer).pointer.predicted is True


def test_live_note_is_allowed_once_and_only_while_remediating():
    board = [{"op": "heading", "id": "h", "text": "x"}]
    ops = [{"op": "callout", "kind": "example", "text": " ".join(["w"] * 50)},
           {"op": "callout", "kind": "tip", "text": "second"},
           {"op": "highlight", "target": "h"}]
    out = _sanitize_ops(ops, board, action="remediate")
    notes = [o for o in out if o.get("note")]
    assert len(notes) == 1 and len(notes[0]["text"].split()) == 30 and notes[0]["id"].startswith("live-note")
    assert any(o["op"] == "highlight" for o in out)
    assert not any(o.get("note") for o in _sanitize_ops(ops, board, action="advance"))


def test_sentence_segments_and_pace_steps():
    segs = _tutor_segments("One short idea. Another one here! A third, with a question? " + "x" * 199 + ". Last.")
    assert segs[0] == ("One short idea. Another one here! A third, with a question?", 0, 3)
    assert segs[1][1] == 3 and segs[1][2] == 1 and len(segs[1][0]) > 150    # a long sentence is never cut
    assert segs[2] == ("Last.", 4, 1)
    assert _step_pace("normal", -1) == "slow" and _step_pace("slow", -1) == "slower" and _step_pace("slower", -1) == "slower"
    assert _step_pace("normal", 1) == "fast" and _step_pace("fast", 1) == "fast"
    assert PACE_MULTIPLIER["slower"] < PACE_MULTIPLIER["slow"] < PACE_MULTIPLIER["normal"] < PACE_MULTIPLIER["fast"]


def test_spoken_lines_follow_the_session_language():
    from app.services.tutor.plan_validator import is_hinglish
    assert is_hinglish("physical assessment physiotherapy plan की नींव है।")
    assert not is_hinglish("Physical assessment gives the foundation: subjective history plus objective examination.")
    L = sm.from_plan_view({
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [],
        "topics": [{"id": "t1", "title": "A", "order": 1, "summary_ops": [], "summary_say": "Recap.", "summary_say_i18n": {"hi": "सार।"}, "concepts": [
            {"id": "a", "title": "a", "order": 1, "concept_tags": [], "board_ops": [], "say": "s", "say_i18n": {"hi": "स"}, "teach_notes": None,
             "check": {"type": "open", "prompt": "Why?", "prompt_i18n": {"hi": "क्यों?"}, "hint": "think", "hint_i18n": {}},
             "predict": "Guess?", "predict_i18n": {"hi": "अंदाज़ा?"}}]}],
    })
    c = L.topics[0].concepts[0]
    assert c.check_prompt("en", "en") == "Why?" and c.check_prompt("hi", "en") == "क्यों?"
    assert c.hint_for("en", "en") == "think" and c.hint_for("hi", "en") is None          # no Hindi hint: nothing rather than English
    assert c.predict_text("hi", "en") == "अंदाज़ा?" and L.topics[0].recap("hi", "en") == "सार।" and L.topics[0].recap("en", "en") == "Recap."
    # the soft rules ask for the missing Hindi hint and reject an English "Hindi" line
    plan = _plan()
    plan.topics[0].summary_say_i18n = {"hi": "This is English pretending."}
    plan.topics[0].concepts[1].check.hint_i18n = {}
    text = " ".join(soft_errors(plan))
    assert "summary_say_i18n['hi'] is not Hindi" in text and "check.hint_i18n['hi'] is missing" in text


def test_prepared_voice_lines_and_keys():
    from app.services.tutor.runtime.speech import cache_key, effective_pace, tutor_segments
    from app.services.tutor.voice_cache import spoken_lines
    from app.services.provider_rates import image_cost_usd, ocr_cost_usd, stt_cost_usd, tts_cost_usd
    view = {"topics": [{"title": "Force", "summary_say": "Recap here.", "summary_say_i18n": {"hi": "सार।"}, "concepts": [
        {"say": "Hi {student_name}, a force is a push. It moves things.", "say_i18n": {"hi": "नमस्ते {student_name}, force एक push है।"},
         "check": {"type": "mcq", "prompt": "Which is a push?", "prompt_i18n": {"hi": "कौन सा push है?"}, "hint": "Think of kicking.", "hint_i18n": {}, "expected": "kicking"},
         "predict": "What moves it?", "predict_i18n": {"hi": "इसे क्या हिलाता है?"}}]}]}
    en = spoken_lines(view, "en", "en")
    assert en[0] == "A force is a push. It moves things."   # the name is gone, the sentence is kept
    assert not any("{student_name}" in l for l in en)
    assert "Which is a push?" in en and "Take your time. Here's a hint: Think of kicking." in en and "Recap here." in en
    assert any(l.startswith("Before I show you") for l in en) and "Okay, let's move on." in en
    hi = spoken_lines(view, "hi", "en")
    assert "कौन सा push है?" in hi and "सार।" in hi and not any("Think of kicking" in l for l in hi)   # no Hindi hint → not spoken
    # the warm-up keys exactly what the socket will look up
    seg = tutor_segments("Recap here.")[0][0]
    assert cache_key("smallest", "nirupma", "en-IN", str(effective_pace(1.0, "normal", seg)), seg) == cache_key("smallest", "nirupma", "en-IN", "1.0", "Recap here.")
    assert effective_pace(1.0, "normal", "This means that") == 0.92 and effective_pace(0.9, "slower", "") == 0.63
    assert tts_cost_usd("smallest", 1000) == 0.025 and tts_cost_usd("edge", 5000) == 0 and stt_cost_usd("sarvam", 3600) == 0.36
    assert ocr_cost_usd(7) == 0.175 and image_cost_usd(None) == 0.04


def test_neutralize_name_keeps_the_sentence():
    from app.services.tutor.runtime.prompts import neutralize_name
    assert neutralize_name("Hi {student_name}, a force is a push. It moves things.") == "A force is a push. It moves things."
    assert neutralize_name("Look, {student_name}, at the arrow on the left.") == "Look at the arrow on the left."
    assert neutralize_name("नमस्ते {student_name}, force एक push है।") == "Force एक push है।"
    assert neutralize_name("No name here.") == "No name here."


def test_spoken_form_reads_maths_not_dates():
    from app.services.tutor.runtime.speech import spoken_form
    assert spoken_form("The answer is 3/16, not 9/16.") == "The answer is 3 by 16, not 9 by 16."
    assert spoken_form("9:3:3:1 ratio") == "9 is to 3 is to 3 is to 1 ratio"
    assert "8:30" in spoken_form("Children arrive at 8:30")              # a time is left alone
    assert spoken_form("a = F ÷ m, so 2 × 3 = 6") == "a equals F divided by m, so 2 into 3 equals 6"
    assert spoken_form("x^2 + 2x, 5 m/s²") == "x squared plus 2x, 5 metres per second squared"
    assert spoken_form("Profit 5%") == "Profit 5 percent"
    assert spoken_form("D = (k - 4)(k + 1)") == "D equals (k minus 4)(k plus 1)"
    assert spoken_form("a well-known rule") == "a well-known rule"                       # hyphenated words untouched
    assert spoken_form("12/09/2026") == "12/09/2026"                                    # dates untouched
    assert spoken_form("3/16", "hi") == "3 बटा 16"


def test_spoken_form_reads_titles_and_acronyms_like_a_person():
    from app.services.tutor.runtime.speech import spoken_form
    # A title's spaced hyphen is a pause, not subtraction; JEE is spelled out.
    assert spoken_form("Last time we were in JEE Main 2026 - Maths Question.") == "Last time we were in J E E Main 2026, Maths Question."
    # Real subtraction still reads as minus.
    assert spoken_form("D = (k - 4)(k + 1)") == "D equals (k minus 4)(k plus 1)"
    assert spoken_form("x - 4 = 0") == "x minus 4 equals 0"
    assert spoken_form("10 - 3 = 7") == "10 minus 3 equals 7"
    # Acronyms said as words, roman numerals, hyphenated words.
    assert spoken_form("NEET aspirants in Class XII - a well-known trap") == "NEET aspirants in Class 12, a well-known trap"
    assert spoken_form("an MCQ from the CBSE board") == "an M C Q from the C B S E board"
    assert spoken_form("HR training with SBI feedback", "hi") == "H R training with S B I feedback"
