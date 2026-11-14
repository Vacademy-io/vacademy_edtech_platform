"""Knowledge Base companions — the pure guardrails and progress rules."""
from app.services.kb_companion import ask, lesson, practice, progress, shell, speech

FIG = {"F1": {"id": "fig-1", "image_url": "https://bucket.s3.amazonaws.com/ai-knowledge-base/figures/a.png",
              "caption": "Figure 6.3 Cross-section of a leaf", "alt_text": None, "page_number": 112}}


# ── shell: sanitize ─────────────────────────────────────────────────────────

def test_kb_figure_tag_becomes_the_real_image_with_caption():
    html, used = shell.sanitize_fragment('<h2>Leaf</h2><img data-kb-fig="F1">', FIG)
    assert used == ["F1"]
    assert FIG["F1"]["image_url"] in html
    assert "Cross-section of a leaf" in html and "p. 112" in html


def test_invented_image_urls_are_removed():
    html, used = shell.sanitize_fragment(
        '<p>x</p><img src="https://example.com/made-up.png"><img data-kb-fig="F9">', FIG)
    assert "example.com" not in html
    assert "<img" not in html
    assert used == []


def test_same_figure_is_shown_once():
    html, used = shell.sanitize_fragment('<img data-kb-fig="F1"><img data-kb-fig="f1">', FIG)
    assert html.count("<img") == 1 and used == ["F1"]


def test_dangerous_tags_and_external_resources_are_stripped():
    raw = ('```html\n<!DOCTYPE html><html><head><style>.a{color:red}</style>'
           '<link rel="stylesheet" href="https://evil.test/x.css"></head><body>'
           '<script src="https://evil.test/x.js"></script><iframe src="https://evil.test"></iframe>'
           '<form action="https://evil.test"><input name="p"></form>'
           '<a href="javascript:alert(1)">x</a><div style="background:url(https://evil.test/t.png)">ok</div>'
           '<script>document.body.dataset.ok=1</script></body></html>\n```')
    html, _ = shell.sanitize_fragment(raw, FIG)
    assert "evil.test" not in html
    assert "<iframe" not in html and "<form" not in html and "<input" not in html
    assert "javascript:" not in html
    assert ".a{color:red}" in html          # the card's own head styles survive
    assert "dataset.ok" in html              # inline interaction survives (sandboxed)


def test_data_uri_images_survive():
    html, _ = shell.sanitize_fragment('<img src="data:image/svg+xml;base64,AAAA">', {})
    assert "data:image/svg+xml" in html


def test_shell_sets_csp_accent_and_only_loads_katex_for_math():
    doc = shell.wrap_card('<img src="https://bucket.s3.amazonaws.com/a.png"><p>plain</p>', accent="#10b981")
    assert "Content-Security-Policy" in doc
    assert "https://bucket.s3.amazonaws.com" in doc
    assert "--vk-accent:#10b981" in doc
    assert "katex" not in doc
    assert "katex" in shell.wrap_card("<div class='vk-formula'>$E=mc^2$</div>")


def test_shell_rejects_non_hex_accent():
    assert "--vk-accent:#4f46e5" in shell.wrap_card("<p>x</p>", accent="red;}</style><script>")


def test_fallback_card_never_empty():
    frag = shell.fallback_fragment("Stomata", "Stomata are pores. They let gases in and out.", FIG["F1"], 112)
    assert "Stomata" in frag and "<li>" in frag and FIG["F1"]["image_url"] in frag


# ── lesson plan validation + citations ─────────────────────────────────────

def _plan():
    return {"title": "Photosynthesis", "objective": "Explain it", "cards": [
        {"kind": "hook", "title": "Why leaves are green", "brief": "Hero", "say": "Hi", "figures": ["f1"], "pages": [112]},
        {"kind": "concept", "title": "Inputs", "brief": "Tiles", "say": "x", "figures": ["F7"], "pages": ["113"]},
        {"kind": "check", "title": "", "question": "Q?", "options": ["a", "b", "c", "d"], "answer_index": 2},
        {"kind": "check", "question": "Bad", "options": ["a", "a", "b", "c"], "answer_index": 0},
        {"kind": "check", "question": "Bad2", "options": ["a", "b", "c"], "answer_index": 0},
        {"kind": "video", "title": "unknown kind", "brief": "x"},
        {"kind": "concept", "title": "no brief"},
        {"kind": "flashcards", "title": "Recap", "brief": "Flip cards", "say": "Done"},
    ]}


def test_validate_plan_keeps_good_cards_and_drops_bad_ones():
    title, objective, cards = lesson.validate_plan(_plan(), ["F1"])
    assert title == "Photosynthesis" and objective == "Explain it"
    assert [c["kind"] for c in cards] == ["hook", "concept", "check", "recap"]
    assert [c["id"] for c in cards] == ["c1", "c2", "c3", "c4"]
    assert cards[0]["figures"] == ["F1"]        # case-normalised
    assert cards[1]["figures"] == []            # unknown label dropped
    assert cards[1]["pages"] == [113]
    assert cards[2]["title"] == "Quick check" and cards[2]["check"]["answer_index"] == 2


def _material():
    return lesson.Material(
        passages=[{"chunk_id": "a", "content_text": "x" * 300, "page_start": 112, "page_end": 113, "source_title": "NCERT Bio"},
                  {"chunk_id": "b", "content_text": "y" * 300, "page_start": 114, "page_end": 114, "source_title": "NCERT Bio"}],
        figures=FIG, fingerprint="fp", source_title="NCERT Bio", page_start=112, page_end=114, chars=600)


def test_citation_is_computed_from_matched_pages():
    m = _material()
    assert lesson.citation_for({"pages": [113]}, m) == "NCERT Bio, p. 113"
    assert lesson.citation_for({"pages": [112, 113]}, m) == "NCERT Bio, p. 112-113"
    assert lesson.citation_for({"pages": [999]}, m) == "NCERT Bio, p. 112-114"   # claimed page not in material


def test_passages_for_a_card_prefer_its_pages():
    m = _material()
    assert "y" * 50 in m.passages_text([114]) and "x" * 50 not in m.passages_text([114])
    assert "x" * 50 in m.passages_text([500])   # no overlap → everything


def test_fingerprint_is_order_independent():
    assert lesson.fingerprint_of(["b", "a"]) == lesson.fingerprint_of(["a", "b"])
    assert lesson.fingerprint_of(["a"]) != lesson.fingerprint_of(["a", "c"])


def test_served_cards_wrap_html_and_hide_briefs():
    cards = [{"id": "c1", "kind": "concept", "title": "T", "html": "<p>x</p>", "status": "ready", "brief": "secret"},
             {"id": "c2", "kind": "concept", "title": "P", "status": "pending"},
             {"id": "c3", "kind": "check", "title": "Q", "status": "ready", "check": {"question": "q"}}]
    out = lesson.serve_cards(cards, accent="#123456", language="en")
    assert out[0]["html_doc"].startswith("<!DOCTYPE html>") and "brief" not in out[0]
    assert "html_doc" not in out[1] and out[2]["check"] == {"question": "q"}


# ── practice ────────────────────────────────────────────────────────────────

def test_practice_validation():
    qs = practice.validate_questions({"questions": [
        {"question": "Q1", "options": ["a", "b", "c", "d"], "answer_index": 1, "difficulty": "HARD", "pages": ["3"]},
        {"question": "Q1", "options": ["a", "b", "c", "d"], "answer_index": 1},     # duplicate
        {"question": "Q2", "options": ["a", "b", "c", "d"], "answer_index": 4},     # bad index
        {"question": "Q3", "options": ["a", "b", "c", "d"], "answer_index": "0", "difficulty": "weird"},
    ]})
    assert [q["id"] for q in qs] == ["q1", "q2"]
    assert qs[0]["difficulty"] == "hard" and qs[0]["pages"] == [3]
    assert qs[1]["difficulty"] == "medium"


# ── progress ────────────────────────────────────────────────────────────────

TREE = [
    {"id": "t1", "title": "Nutrition", "subtopics": [{"id": "s1", "title": "Photosynthesis"}, {"id": "s2", "title": "Stomata"}]},
    {"id": "t2", "title": "Respiration", "subtopics": []},
    {"id": "t3", "title": "Transport", "subtopics": [{"id": "s3", "title": "Xylem"}, {"id": "s4", "title": "Phloem"}]},
]


def test_scope_selects_leaves():
    assert progress.leaf_ids(progress.scoped_map(TREE, [])) == ["s1", "s2", "t2", "s3", "s4"]
    assert progress.leaf_ids(progress.scoped_map(TREE, ["t1", "s4"])) == ["s1", "s2", "s4"]
    assert progress.leaf_ids(progress.scoped_map(TREE, ["t2"])) == ["t2"]


def test_check_scored_once_and_practice_replaced():
    row = progress.apply_update(None, {"card_index": 2, "cards_total": 7, "check": {"card_id": "c3", "correct": True}})
    row = {**row, "node_id": "s1"}
    again = progress.apply_update(row, {"card_index": 2, "cards_total": 7, "check": {"card_id": "c3", "correct": False}})
    assert again["checks_total"] == 1 and again["checks_correct"] == 1
    p1 = progress.apply_update(again, {"cards_total": 7, "practice": {"correct": 2, "total": 8}})
    p2 = progress.apply_update(p1, {"cards_total": 7, "practice": {"correct": 7, "total": 8}})
    assert (p2["practice_correct"], p2["practice_total"]) == (7, 8)


def test_position_moves_back_but_furthest_seen_does_not():
    r1 = progress.apply_update(None, {"card_index": 5, "cards_total": 7})
    r2 = progress.apply_update(r1, {"card_index": 1, "cards_total": 7})
    assert r2["card_index"] == 1 and r2["max_card_seen"] == 5


def test_completion_is_sticky_and_keeps_its_time():
    r1 = progress.apply_update(None, {"card_index": 6, "cards_total": 7, "completed": True})
    assert r1["status"] == "COMPLETED" and r1["completed_at"] is True
    stored = {**r1, "completed_at": "2026-09-28T10:00:00"}
    r2 = progress.apply_update(stored, {"card_index": 0, "cards_total": 7})
    assert r2["status"] == "COMPLETED" and r2["completed_at"] == "2026-09-28T10:00:00"


def test_mastery_rewards_answers_over_scrolling():
    read_only = progress.mastery_of(cards_total=7, max_card_seen=6, completed=True, checks_correct=0,
                                    checks_total=0, practice_correct=0, practice_total=0)
    aced = progress.mastery_of(cards_total=7, max_card_seen=6, completed=True, checks_correct=2,
                               checks_total=2, practice_correct=8, practice_total=8)
    failed = progress.mastery_of(cards_total=7, max_card_seen=6, completed=True, checks_correct=0,
                                 checks_total=2, practice_correct=1, practice_total=8)
    assert read_only == 50 and aced == 100 and failed < read_only


def test_resume_prefers_latest_unfinished_then_first_unopened():
    leaves = ["s1", "s2", "t2"]
    rows = [{"node_id": "s1", "status": "COMPLETED", "last_activity_at": "2026-09-28T09"},
            {"node_id": "s2", "status": "IN_PROGRESS", "card_index": 3, "last_activity_at": "2026-09-28T08"}]
    assert progress.resume_point(leaves, rows) == {"node_id": "s2", "card_index": 3, "reason": "continue"}
    rows[1]["status"] = "COMPLETED"
    assert progress.resume_point(leaves, rows) == {"node_id": "t2", "card_index": 0, "reason": "next"}
    rows.append({"node_id": "t2", "status": "COMPLETED", "last_activity_at": "x"})
    assert progress.resume_point(leaves, rows) is None


def test_summary_counts_untouched_topics_as_zero():
    s = progress.summary(["a", "b", "c", "d"], [{"node_id": "a", "status": "COMPLETED", "mastery": 80},
                                                 {"node_id": "zz", "status": "COMPLETED", "mastery": 100}])
    assert s == {"leaves_total": 4, "started": 1, "completed": 1, "mastery": 20}


def test_learner_memo_is_exact():
    scoped = progress.scoped_map(TREE, [])
    rows = [{"node_id": "s1", "status": "COMPLETED", "mastery": 90, "checks_total": 2, "practice_total": 0},
            {"node_id": "s2", "status": "IN_PROGRESS", "mastery": 20, "checks_total": 2, "practice_total": 0}]
    memo = progress.learner_memo(scoped, rows, "s2")
    assert "Currently learning: Stomata" in memo and "Finished: Photosynthesis" in memo and "Found hard" in memo


# ── ask guardrails ──────────────────────────────────────────────────────────

def test_distress_detection():
    assert ask.is_distress("sometimes I want to die")
    assert ask.is_distress("मैं आत्महत्या के बारे में सोचता हूँ")
    assert not ask.is_distress("why do cells die during apoptosis?")


def test_answers_are_scrubbed_of_images_and_links():
    t = ask.scrub_answer("See ![x](https://evil.test/a.png) and [this](https://evil.test) <img src=x> **ok**")
    assert "evil.test" not in t and "<img" not in t and "this" in t and "**ok**" in t


def test_shape_answer_maps_citations_and_only_known_figures():
    from app.services.kb.retrieval import Citation
    cits = [Citation("s", "Bio", 10, 11, 0.8), Citation("s", "Bio", 12, 12, 0.7)]
    figs = {"F1": FIG["F1"]}
    out = ask.shape_answer({"answer": "A [2]", "used_excerpts": [2, 9], "figures": ["F1", "F5"],
                            "in_scope": True, "follow_ups": ["a", "b", "c", "d"]}, cits, figs)
    assert out["citations"] == [{"n": 2, "label": "Bio, p. 12", "page_start": 12, "page_end": 12}]
    assert len(out["figures"]) == 1 and out["figures"][0]["image_url"] == FIG["F1"]["image_url"]
    assert len(out["follow_ups"]) == 3
    off = ask.shape_answer({"answer": "Not in your book", "in_scope": False, "figures": ["F1"]}, cits, figs)
    assert off["citations"] == [] and off["figures"] == []


def test_not_found_reply_suggests_covered_topics():
    assert "Photosynthesis" in ask.not_found_reply("en", ["Photosynthesis", "Stomata"])
    assert "Photosynthesis" in ask.not_found_reply("hi", ["Photosynthesis"])


# ── speech ──────────────────────────────────────────────────────────────────

def test_speakable_drops_markdown_and_citations():
    t = speech.speakable("**Chlorophyll** absorbs light [1][2].\n| A | B |\n|---|---|\n| x | y |")
    assert "[1]" not in t and "*" not in t and "---" not in t and "Chlorophyll absorbs light" in t


# ── Kannada ─────────────────────────────────────────────────────────────────

def test_kannada_is_a_teaching_language():
    assert "Kannada" in lesson.LANG_NAMES["kn"] and "brackets" in lesson.LANG_NAMES["kn"]
    assert speech.LANG_CODES["kn"] == "kn-IN"
    assert "Tele-MANAS" in ask.DISTRESS_REPLY["kn"]
    assert "ಪಠ್ಯ" in ask.not_found_reply("kn", ["ಆಮ್ಲಗಳು"]) and "ಆಮ್ಲಗಳು" in ask.not_found_reply("kn", ["ಆಮ್ಲಗಳು"])
    assert ask.is_distress("ನನಗೆ ಸಾಯಬೇಕು ಅನಿಸುತ್ತಿದೆ")


def test_kannada_voice_defaults_to_sarvam():
    provider, voice, lang = speech.voice_for({"language": "kn"})
    assert provider == "sarvam" and lang == "kn-IN"


def test_per_language_model_override(monkeypatch):
    from app.services.kb_companion import llm
    monkeypatch.setenv("KB_COMPANION_MODEL_KN", "google/gemini-2.5-flash")
    assert llm.primary_for("kn") == "google/gemini-2.5-flash"
    assert llm.primary_for("en") == llm.PRIMARY_MODEL
    assert llm.primary_for(None) == llm.PRIMARY_MODEL
