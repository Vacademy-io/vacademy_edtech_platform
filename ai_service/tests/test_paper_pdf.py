"""The printed paper must match what the teacher reviewed.

`build_paper_html` is the pure half of the PDF export (the other half is
Chromium). These pin the layout rules a teacher notices first on a printout:
questions grouped under the blueprint's sections and numbered continuously
across them, marks in the margin and per-section totals, an answer key only
when asked for, and nothing executable carried in from generated HTML.
"""
from app.services.kb import paper_pdf
from app.services.kb.paper import Blueprint


def _blueprint():
    return Blueprint.from_dict({
        "title": "Class 10 Science — Acids and Bases — Unit Test",
        "duration_minutes": 90,
        "instructions": ["All questions are compulsory.", "Each question carries the marks shown."],
        "rows": [
            {"id": "row-1", "section": "Section A", "topic": "pH", "question_type": "MCQS",
             "count": 2, "marks_each": 1, "instruction": "Choose the correct option."},
            {"id": "row-2", "section": "Section B", "topic": "pH", "question_type": "LONG_ANSWER",
             "count": 1, "marks_each": 3, "instruction": "Answer in about 60 words."},
        ],
    })


def _mcq(number, row="row-1", section="Section A", marks=1.0):
    return {
        "question_number": number, "question_type": "MCQS",
        "question": {"type": "HTML", "content": f"<p>MCQ {number}: what is $pH = -\\log[H^+]$?</p>"},
        "options": [
            {"preview_id": "1", "content": "It increases"},
            {"preview_id": "2", "content": "It decreases"},
            {"preview_id": "3", "content": "Unchanged"},
            {"preview_id": "4", "content": "Zero"},
        ],
        "correct_options": ["2"], "ans": "It decreases", "exp": "Dilution lowers concentration.",
        "marking_steps": ["Identify dilution.", "Answer: It decreases."],
        "kb_meta": {"row_id": row, "section": section, "marks": marks, "figures": []},
    }


def _long(number, row="row-2", section="Section B", marks=3.0):
    return {
        "question_number": number, "question_type": "LONG_ANSWER",
        "question": {"type": "HTML", "content": "<p>Explain a universal indicator.<script>alert(1)</script></p>"},
        "options": [], "correct_options": [],
        "ans": "It shows different colours at different pH.",
        "exp": "Colour change<br>Links colour to pH",
        "kb_meta": {"row_id": row, "section": section, "marks": marks,
                    "figures": [{"image_url": "https://cdn.example.com/fig1.png", "page_number": 8}]},
    }


def test_sections_in_blueprint_order_with_continuous_numbering():
    # Raw numbering restarts per section (1, 2 / 1); the sheet must not.
    html = paper_pdf.build_paper_html(_blueprint(), [_mcq(1), _mcq(2), _long(1)],
                                      institute_name="Vacademy")
    assert html.index("Section A") < html.index("Section B")
    assert '<div class="num">1.</div>' in html
    assert '<div class="num">2.</div>' in html
    assert '<div class="num">3.</div>' in html
    assert html.count('<div class="num">1.</div>') == 1
    # Header strip: duration in words, marks summed from the questions, not the plan.
    assert "Time Allowed: 1 hour 30 minutes" in html
    assert "Maximum Marks: 5" in html
    assert "VACADEMY" in html.upper() and "Vacademy" in html
    # Per-section line and per-row instruction.
    assert "2 questions × 1 mark = 2 marks" in html
    assert "1 question × 3 marks = 3 marks" in html
    assert "Choose the correct option." in html
    assert "[3]" in html  # marks in the margin


def test_options_are_lettered_and_math_triggers_katex():
    html = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)])
    assert "(a)" in html and "(d)" in html
    assert "katex.min.js" in html  # $…$ present → typesetting loaded


def test_no_math_means_no_cdn_and_ready_flag_is_set():
    q = _long(1)
    html = paper_pdf.build_paper_html(_blueprint(), [q])
    assert "katex.min.js" not in html
    assert "window.__paperReady = true" in html


def test_answer_key_only_when_asked_and_carries_marking_steps():
    without = paper_pdf.build_paper_html(_blueprint(), [_mcq(1), _long(1)])
    assert "Answer Key" not in without
    with_key = paper_pdf.build_paper_html(_blueprint(), [_mcq(1), _long(1)], include_answer_key=True)
    assert "Answer Key &amp; Marking Scheme" in with_key
    assert "(b) It decreases" in with_key           # option letter, not the preview id
    assert "Identify dilution." in with_key         # marking steps
    assert "Colour change" in with_key              # exp split on <br> when no steps
    assert with_key.index("Answer Key") > with_key.index('<div class="num">2.</div>')


def test_generated_html_is_stripped_of_scripts_and_figures_are_attached():
    html = paper_pdf.build_paper_html(_blueprint(), [_long(1)])
    assert "<script>alert(1)</script>" not in html
    assert 'src="https://cdn.example.com/fig1.png"' in html


def test_orphan_question_is_kept_not_dropped():
    # The teacher removed row-2 after generating; its question still prints.
    bp = _blueprint()
    bp.rows = bp.rows[:1]
    html = paper_pdf.build_paper_html(bp, [_mcq(1), _long(1)])
    assert "Explain a universal indicator." in html
    assert "Section B" in html


def test_show_marks_false_hides_margin_and_totals():
    html = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], show_marks=False)
    assert "[1]" not in html
    assert "× 1 mark" not in html


def test_filename_is_a_safe_slug():
    assert paper_pdf.paper_filename("Class 10: Science / Unit Test", with_key=True) == \
        "Class-10-Science-Unit-Test-with-answer-key.pdf"
    assert paper_pdf.paper_filename("", with_key=False) == "question-paper.pdf"


def test_letterhead_has_logo_and_contact_and_footer_names_institute():
    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)],
        institute_name="Oriental Group Of Institution",
        logo_url="https://cdn.example.com/logo.png",
        contact_line="www.oriental.edu · info@oriental.edu",
        logo_placement="header",
    )
    assert 'class="logo" src="https://cdn.example.com/logo.png"' in html
    assert "www.oriental.edu · info@oriental.edu" in html
    assert 'class="brand"' in html            # logo + text side by side
    assert 'class="rule"' in html
    # No logo → the name is centred on its own; no brand block without either.
    assert 'class="brand centered"' in paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], institute_name="X")
    assert 'class="brand' not in paper_pdf.build_paper_html(_blueprint(), [_mcq(1)])


def test_publish_variant_and_subtitle():
    from app.services.kb import paper_publish

    assert paper_publish.variant_for(True) == "with_answer_key"
    assert paper_publish.variant_for(False) == "question_paper"
    assert paper_publish.paper_subtitle({"curriculum": {"board": "NCERT", "class": "10", "subject": "Science"}}) \
        == "Class 10 · Science · NCERT"
    assert paper_publish.paper_subtitle({"curriculum": None}) is None


def test_logo_is_a_watermark_by_default_and_name_line_is_off():
    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)],
        institute_name="Oriental Group Of Institution",
        logo_url="https://cdn.example.com/logo.png",
    )
    assert 'class="watermark" style="background-image:url(https://cdn.example.com/logo.png)"' in html
    assert 'class="logo"' not in html                    # not in the header
    assert "Roll No.:" not in html                        # candidate line off
    assert html.index("ORIENTAL GROUP OF INSTITUTION".title()) < html.index("Time Allowed")
    # The letterhead and the name line come back on request.
    header = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], institute_name="X", logo_url="https://cdn.example.com/logo.png",
        logo_placement="header", candidate_line=True,
    )
    assert 'class="logo" src="https://cdn.example.com/logo.png"' in header
    assert 'class="watermark"' not in header
    assert "Roll No.:" in header
    assert 'class="watermark"' not in paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], logo_url="https://x/l.png", logo_placement="none"
    )


def test_compact_theme_two_columns_band_and_columned_key():
    from app.services.kb import paper_themes

    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1), _long(1)], theme="compact",
        institute_name="Elevate", subtitle="Business Laws", exam_date="06-08-2026",
        include_answer_key=True,
    )
    assert 'class="theme-compact"' in html and 'class="c-body"' in html
    assert "Instructions for students" in html and "<b>Subject:</b> Business Laws" in html
    assert "<b>Date:</b> 06-08-2026" in html and "<b>Maximum Marks:</b> 4" in html
    assert 'class="c-key"' in html and "(b) It decreases" in html      # key in its own columned block
    assert 'class="ans"' not in html                                   # never inline in this theme
    assert "column-rule" in html                                       # divider between the two columns
    assert 'class="c-head"' in html and 'class="logo"' not in html       # no logo → plain letterhead
    settings = paper_themes.page_settings("compact", institute_name="Elevate", title="t", subtitle="Business Laws")
    assert settings["format"] == "Letter" and "Elevate | Business Laws" in settings["footer_template"]
    assert "pageNumber" in settings["footer_template"]


def test_compact_theme_letterhead_logo_and_watermark():
    logo = "https://cdn.example.com/logo.png"
    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], theme="compact", institute_name="Elevate", logo_url=logo,
    )
    # Default placement: small mark top-left AND the faint watermark behind every page.
    assert 'class="c-head with-logo"' in html and f'<img class="logo" src="{logo}"' in html
    assert 'class="watermark"' in html
    # The logo carries the name, so the header does not repeat it.
    assert 'class="institute"' not in html
    header_only = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], theme="compact", institute_name="Elevate", logo_url=logo,
        logo_placement="header",
    )
    assert 'class="logo"' in header_only and 'class="watermark"' not in header_only
    none = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], theme="compact", institute_name="Elevate", logo_url=logo,
        logo_placement="none",
    )
    assert 'class="logo"' not in none and 'class="watermark"' not in none
    assert '<div class="institute">Elevate</div>' in none            # no logo → name in print


def test_coaching_theme_boxed_sections_inline_key_and_meta():
    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1), _long(1)], theme="coaching",
        institute_name="Shri Saidas Classes", logo_url="https://cdn.example.com/logo.png",
        grade_line="Class - 9th", exam_date="26-08-2026", include_answer_key=True,
    )
    assert 'class="theme-coaching"' in html and 'class="k-body"' in html
    assert "CLASS - 9TH" in html and "(Answer Key)" in html and "Date : <span>26-08-2026" in html
    assert 'class="box">SECTION A (MCQ\'s) (1M)' in html.replace("&#x27;", "'")
    assert 'class="box">SECTION B (Subjective) (3M)' in html
    assert '<div class="ans">Ans. (b) It decreases' in html            # inline under the MCQ
    assert "Ans. It shows different colours at different pH." in html # inline for the subjective one
    assert "Colour change" in html                                     # steps follow the answer
    assert 'class="logo" src="https://cdn.example.com/logo.png"' in html and 'class="watermark"' in html
    assert "Time : <span>1 hr 30 min" in html
    assert "Answer Key &amp; Marking Scheme" not in html               # no separate key pages


def test_unknown_theme_falls_back_to_classic():
    html = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], theme="nope")
    assert 'class="theme-' not in html and 'class="section-head"' in html


def test_compact_theme_brand_colour_only_on_the_footer_band():
    from app.services.kb import paper_themes

    # Preset codes, raw hex (with or without '#'), and junk → default blue.
    assert paper_themes.resolve_accent("primary") == "#ED7424"
    assert paper_themes.resolve_accent("Blue") == "#1E88E5"
    assert paper_themes.resolve_accent("#9b2242") == "#9B2242"
    assert paper_themes.resolve_accent("9B2242") == "#9B2242"
    assert paper_themes.resolve_accent(None) == paper_themes.DEFAULT_ACCENT
    assert paper_themes.resolve_accent("not-a-colour") == paper_themes.DEFAULT_ACCENT
    # Light accents get dark text on the band.
    assert paper_themes.accent_text_color("#FFB300") == "#111111"
    assert paper_themes.accent_text_color("#1A237E") == "#FFFFFF"

    settings = paper_themes.page_settings(
        "compact", institute_name="Oriental", title="t", subtitle=None, accent="#ED7424",
    )
    assert "background:#ED7424;color:#FFFFFF" in settings["footer_template"]
    # The sheet itself never picks up the brand colour: no tinted bands,
    # headings, rules and the column divider stay black — only the logo (and
    # its watermark, un-greyed on this layout) is in colour.
    html = paper_pdf.build_paper_html(
        _blueprint(), [_mcq(1)], theme="compact", institute_name="Oriental",
        logo_url="https://cdn.example.com/logo.png",
    )
    assert "#ED7424" not in html and "color-mix" not in html
    assert "column-rule: 0.6pt solid #000" in html and 'class="logo"' in html
    assert ".watermark { filter: none; opacity: 0.07; }" in html


def test_exam_date_is_printed_on_every_layout_and_left_blank_otherwise():
    # Neeraj 2026-09-20: the date is asked for with the class/title and must show
    # on the sheet — the printed "Date: ______" is for the teacher to set, not
    # the student to fill.
    for theme in ("classic", "compact", "coaching"):
        with_date = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], theme=theme, exam_date="25 Sep 2026")
        assert "25 Sep 2026" in with_date, theme
        without = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], theme=theme)
        assert "25 Sep 2026" not in without
    # classic: the candidate line carries it when present
    classic = paper_pdf.build_paper_html(_blueprint(), [_mcq(1)], theme="classic", exam_date="25 Sep 2026",
                                         candidate_line=True)
    assert "Date: 25 Sep 2026" in classic and "Roll No.:" in classic
