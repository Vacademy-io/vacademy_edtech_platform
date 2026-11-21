"""A run that ships a fraction of its shots must not report COMPLETED.

Real incident: a 28-shot film delivered 20. Eight shots generated fine, failed
at the timeline-placement step and were dropped; two more shipped as empty
fallback frames — a few hundred bytes carrying only a GSAP fade, which renders
as a white screen. The run reported COMPLETED with an empty error_message, so
the only way to find a film missing its certificate reveal and its closing shot
was to open the editor and look at the timeline.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.timeline_coverage import (  # noqa: E402
    _frame_is_substantive,
    _timeline_coverage,
)

PREAMBLE = "<!--vx-preamble--><style>" + ("/*x*/" * 300) + "</style>"

# The exact shape the pipeline shipped for a failed shot.
EMPTY_FALLBACK = PREAMBLE + (
    "<div id=\"shot-root\" style=\"position:absolute;inset:0;\">"
    "<div id='fb_b' style='opacity:0'></div>"
    "<script>(function(){if(typeof gsap==='undefined')return;"
    "gsap.to('#fb_b',{opacity:1,duration:0.4,delay:0.4});})();</script></div>"
)

REAL = PREAMBLE + (
    "<div id=\"shot-root\">" + "<p>Six expert parameters worth six hundred marks, "
    "averaged with eight self-assessed dimensions into a single score.</p>" * 6 + "</div>"
)


def test_the_empty_fallback_frame_is_not_substantive():
    assert _frame_is_substantive(EMPTY_FALLBACK) is False


def test_a_real_frame_is_substantive():
    assert _frame_is_substantive(REAL) is True


def test_a_frame_carrying_only_an_image_counts():
    """An IMAGE_CLIP is mostly a screenshot — little text, still a real shot."""
    html = PREAMBLE + '<div id="shot-root">' + ("<span></span>" * 200) + '<img src="s3://x.png"/></div>'
    assert _frame_is_substantive(html) is True


def test_missing_and_blank_are_both_reported(tmp_path):
    meta_shots = [{"shot_idx": i, "shot_type": "DEVICE_MOCKUP"} for i in range(5)]
    entries = [
        {"id": "shot-0", "html": REAL},
        {"id": "shot-1", "html": REAL},
        # shot-2 absent entirely — the placement-step failure
        {"id": "shot-3", "html": EMPTY_FALLBACK},  # present but blank
        {"id": "shot-4", "html": REAL},
    ]
    tl = tmp_path / "timeline"
    tl.mkdir()
    (tl / "time_based_frame.json").write_text(
        json.dumps({"meta": {"shots": meta_shots}, "entries": entries})
    )
    cov = _timeline_coverage(tmp_path)
    assert cov["planned"] == 5
    assert cov["present"] == 3
    # Both failure modes surface: the dropped shot AND the white-screen one.
    assert cov["missing"] == [2, 3]


def test_a_complete_run_reports_no_gap(tmp_path):
    meta_shots = [{"shot_idx": i, "shot_type": "TEXT_DIAGRAM"} for i in range(3)]
    entries = [{"id": f"shot-{i}", "html": REAL} for i in range(3)]
    tl = tmp_path / "timeline"
    tl.mkdir()
    (tl / "time_based_frame.json").write_text(
        json.dumps({"meta": {"shots": meta_shots}, "entries": entries})
    )
    cov = _timeline_coverage(tmp_path)
    assert cov["missing"] == []
    assert cov["present"] == cov["planned"] == 3


def _write(tmp_path, n_planned, entries):
    tl = tmp_path / "timeline"
    tl.mkdir()
    (tl / "time_based_frame.json").write_text(json.dumps({
        "meta": {"shots": [{"shot_idx": i, "shot_type": "TEXT_DIAGRAM"} for i in range(n_planned)]},
        "entries": entries,
    }))
    return _timeline_coverage(tmp_path)


def test_ids_are_the_pipelines_zero_based_shot_index(tmp_path):
    """A 2026-10-01 film shipped all 12 shots as `shot-0`..`shot-11`, and the
    gate said "Shipped 11 of 12 shots — missing/blank: [11]". It looked up
    `shot-{idx + 1}`: every complete film reported its last shot missing, and
    each shot was judged by its neighbour's frame."""
    cov = _write(tmp_path, 12, [{"id": f"shot-{i}", "html": REAL} for i in range(12)])
    assert cov["missing"] == [] and cov["present"] == 12


def test_a_blank_first_shot_is_caught(tmp_path):
    """Under the old lookup shot 0 was judged by `shot-1`, so a blank opener —
    the first thing anyone sees — could never be reported."""
    entries = [{"id": "shot-0", "html": EMPTY_FALLBACK}] + [
        {"id": f"shot-{i}", "html": REAL} for i in (1, 2)
    ]
    assert _write(tmp_path, 3, entries)["missing"] == [0]


def test_a_split_shot_counts_through_its_sub_entries(tmp_path):
    """A split shot has `shot-N-sub0`/`-sub1` and no plain `shot-N` entry."""
    entries = [
        {"id": "shot-0", "html": REAL},
        {"id": "shot-1-sub0", "html": REAL},
        {"id": "shot-1-sub1", "html": REAL},
        {"id": "shot-2", "html": REAL},
    ]
    assert _write(tmp_path, 3, entries)["missing"] == []


def test_a_split_shot_with_one_blank_half_is_reported(tmp_path):
    entries = [
        {"id": "shot-0", "html": REAL},
        {"id": "shot-1-sub0", "html": REAL},
        {"id": "shot-1-sub1", "html": EMPTY_FALLBACK},
    ]
    assert _write(tmp_path, 2, entries)["missing"] == [1]


def test_the_gate_reads_the_id_format_the_pipeline_writes():
    """The fixtures above are only right if the pipeline still names entries
    this way. If the naming changes, this fails instead of the gate quietly
    reporting the wrong shots again."""
    pipe = open(os.path.join(
        os.path.dirname(__file__), "..", "app", "ai-video-gen-main", "automation_pipeline.py"
    )).read()
    assert '_entry_id = f"shot-{shot_idx}" + (f"-sub{_sub_idx_val}"' in pipe


def test_an_unreadable_timeline_is_unknown_not_failed(tmp_path):
    """No timeline is not evidence of missing shots — it must not fail a run."""
    assert _timeline_coverage(tmp_path) is None
    tl = tmp_path / "timeline"
    tl.mkdir()
    (tl / "time_based_frame.json").write_text("{ not json")
    assert _timeline_coverage(tmp_path) is None


def test_the_gate_calls_a_method_that_exists():
    """The first version of this gate called repository.update_status(), which
    does not exist on AiVideoRepository. Wrapped in its own try/except, it would
    have raised, been swallowed, and reported nothing — the exact silent-failure
    shape the gate was written to eliminate.
    """
    import re
    base = os.path.join(os.path.dirname(__file__), "..", "app")
    svc = open(os.path.join(base, "services", "video_generation_service.py")).read()
    repo = open(os.path.join(base, "repositories", "ai_video_repository.py")).read()

    called = set(re.findall(r"self\.repository\.(\w+)\(", svc))
    defined = set(re.findall(r"    def (\w+)\(", repo))
    missing = sorted(called - defined)
    assert not missing, f"service calls repository methods that do not exist: {missing}"


def test_the_gate_does_not_invent_a_status_the_frontend_cannot_read():
    """A short film is still watchable. FAILED would be wrong, and PARTIAL is a
    value nothing downstream handles — the fix is visibility, not a new state."""
    svc = open(
        os.path.join(os.path.dirname(__file__), "..", "app", "services", "video_generation_service.py")
    ).read()
    gate = svc[svc.index("Coverage gate"): svc.index("Coverage gate") + 2000]
    assert "record_warning" in gate
    assert 'status="PARTIAL"' not in gate
    assert "mark_failed" not in gate


def test_the_binding_shot_error_cap_is_the_emit_not_the_aggregator():
    """Raising run_state_aggregator's cap did not lengthen a stored shot error.

    The emit clips first: `"error": str(e)[:200]` on the shot_error event, long
    before the aggregator's own limit applies. 200 characters cut the model's
    raw output mid-JSON, so a well-formed-but-rejected response and a genuinely
    truncated one looked identical — that ambiguity produced a wrong diagnosis
    on a real incident, twice.
    """
    import re
    base = os.path.join(os.path.dirname(__file__), "..", "app", "ai-video-gen-main")
    pipe = open(os.path.join(base, "automation_pipeline.py")).read()
    agg = open(os.path.join(base, "run_state_aggregator.py")).read()

    assert "_SHOT_ERROR_KEEP = 4000" in pipe
    assert not re.search(r'"error": str\(e\)\[:200\]', pipe), "the emit still clips at 200"
    # Both layers must be generous; the tighter one wins, so neither may regress.
    assert "_ERROR_KEEP = 4000" in agg
    assert "[:300]" not in agg
