"""Guards for the layout failures that clipped rendered shots.

1. `.stage-drift` is documented to the model as a MOTION helper, so it also
   lands on containers that already have a layout. It used to carry
   `flex-direction: column`, which those containers almost never override —
   an intended flex ROW became a stack twice the frame height and its last
   line was cut off ("HUMAN PARTICIPAT/ION").
2. Nothing may render outside the frame, and no word may be split across
   lines. Both repairs live in the dispatcher's post-script sweeps.
"""
import sys
from pathlib import Path

_AI = Path(__file__).resolve().parents[1] / "app" / "ai-video-gen-main"
sys.path.insert(0, str(_AI))

_PIPELINE = (_AI / "automation_pipeline.py").read_text()
_DISPATCHER = (_AI / "dispatcher_install_js.py").read_text()


def test_stage_drift_column_is_scoped_to_sole_class_use():
    start = _PIPELINE.index(".stage-drift {{")
    # the rule body only — the comment below it quotes the property by name
    rule = _PIPELINE[start:_PIPELINE.index("}}", start)]
    assert "flex-direction: column" not in rule, (
        "unscoped flex-direction on .stage-drift silently flips any container "
        "the model tags with it into a column"
    )
    assert '[class="stage-drift"] {{' in _PIPELINE, (
        "the sole-class rule is what preserves centering for the wrappers that "
        "use stage-drift on its own"
    )


def test_frame_fit_guard_measures_layout_not_transforms():
    body = _DISPATCHER[_DISPATCHER.index("var __fitFrameSweep"):]
    # the guard's own body only — later sweeps legitimately use rects
    sweep = body[:body.index("// MID-WORD BREAK GUARD.")] if "// MID-WORD BREAK GUARD." in body else body[:body.index("// CONTRAST AUTO-FIX.")]
    assert "scrollHeight" in sweep, "guard must use layout metrics"
    assert "getBoundingClientRect" not in sweep, (
        "rects include GSAP transforms, so an element parked off-frame by its "
        "entrance animation would read as overflow and shrink the whole shot"
    )
    assert "0.62" in sweep, "there must be a floor so text cannot shrink to unreadable"


def test_frame_fit_wrapper_reproduces_the_root_layout():
    assert "'display', 'flexDirection'" in _DISPATCHER, (
        "the wrapper becomes the children's parent; without copying the root's "
        "layout the content loses its centering and grows taller than before"
    )


def test_mid_word_guard_measures_the_widest_unbreakable_run():
    """Measurement is per-RUN, not per-word.

    A run has no break opportunity in it and may span element boundaries —
    `V&nbsp;<span>TRIGEMINAL</span>` is one 520px run in a 513px column even
    though neither part exceeds it alone. The per-element own-text version of
    this guard passed that case and the browser broke inside the word, which
    is the "words getting break" defect reported on two client videos.
    """
    assert "__widestRun" in _DISPATCHER
    sweep = _DISPATCHER[_DISPATCHER.index("var __fitWordsSweep"):]
    assert "__widestRun(el)" in sweep[:3000], "sweep must use the run measurement"
    assert "measureText" in _DISPATCHER, "width comes from canvas text metrics"
    assert "0.55" in sweep[:6000], "shrink floor required"


def test_nbsp_is_not_treated_as_a_break_opportunity():
    """JS \s INCLUDES \u00a0, and the preamble MANDATES `&nbsp;` before every
    accent span. Splitting on \s therefore treated the one position the browser
    cannot break at as a break opportunity."""
    # Scoped to the text measurement code: the CSS inset() parser elsewhere
    # splits on /\s+/ legitimately and has nothing to do with line breaking.
    measure = _DISPATCHER[
        _DISPATCHER.index("var __widestWord") : _DISPATCHER.index("var __fitWordsSweep")
    ]
    assert "/\\s+/" not in measure, "nbsp-blind split must not come back"
    assert measure.count("[^\\S\\u00a0]+") >= 2


def test_only_paragraph_level_blocks_are_measured():
    """A wrapper must not shrink type that already fits inside a narrower child."""
    assert "__isTextBlock" in _DISPATCHER
    sweep = _DISPATCHER[_DISPATCHER.index("var __fitWordsSweep"):]
    assert "__isTextBlock(el)" in sweep[:1500]


def test_br_and_wbr_break_the_run():
    """<br> is a FORCED line break; text either side is never one run.

    Walking through it joined "Pressure falls" and "as speed rises" into a
    single phantom token and shrank the headline to 60% for an overflow that
    did not exist — caught by rendering an exemplar, not by assertion.
    """
    run = _DISPATCHER[_DISPATCHER.index("var __widestRun"):]
    run = run[: run.index("var __isTextBlock")]
    assert "'BR'" in run and "'WBR'" in run
    assert "flush(); return;" in run


def test_avatar_stage_skip_is_not_a_missing_output():
    """A run with no avatar must not fail after HTML succeeded.

    The pipeline returns {"skipped": True, "reason": "host not avatar-enabled"}
    and leaves avatar_video_path None whenever no avatar was requested. The
    required-output validator read that as a silent stage failure, so a
    till-render run without an avatar lost the entire video at 58% — observed
    on a real run whose HTML and timeline had completed successfully.
    """
    src = (
        Path(__file__).resolve().parents[1]
        / "app" / "services" / "video_generation_service.py"
    ).read_text()
    assert 'if stage_pipeline_name == "avatar" and not generate_avatar:' in src
    assert 'A skip is not a missing output' in src


def test_headings_never_split_mid_word():
    """`* { word-break: break-word }` is a safety valve for prose in a narrow
    column. Applied to display type it produced "CONFIRM SUBMISSI / ON" in a
    shipped frame.

    A heading that does not fit should be SHRUNK — the fit sweep already does
    that — not hacked in half. keep-all breaks at spaces only.
    """
    import os
    src = open(
        os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py")
    ).read()
    i = src.index("word-break: keep-all")
    block = src[i - 700:i + 200]
    for sel in ("h1, h2, h3", '[class*="title" i]', '[class*="headline" i]'):
        assert sel in block, f"heading carve-out missing {sel}"
    assert "overflow-wrap: normal;" in block
    assert "hyphens: none;" in block
    # The global valve must still exist — this is a carve-out, not its removal.
    assert "word-break: break-word;" in src
    # Word spans INSIDE a heading get `*`'s break-word directly ("PAR / T").
    assert "h1 *, h2 *, h3 *, h4 *, h5 *, h6 * {{" in src


def test_heading_padding_is_not_a_percentage():
    """% padding counts as 0 when a shrink-to-fit box measures its heading, then
    takes 8% of the width back — every long word one letter too wide
    ("RESUME / S", ITRC lesson 2026-10-22). A length is measured with the text."""
    import os
    src = open(
        os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py")
    ).read()
    i = src.index("h1, h2, h3, .text-display {{")
    block = src[i:i + 120]
    assert "padding: 0 2vw;" in block and "padding: 0 4%" not in src
