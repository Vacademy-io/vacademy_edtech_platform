"""Scan Station replay of the 2026-11-18 live Brother scans (plan task T6).

Skipped unless SCAN_FIXTURES_DIR points at a folder holding the two pass
folders named in tests/fixtures/scan/expected_11_18.json (the images are
private and never committed; see tests/fixtures/scan/README.md).

Runs the real analyse-load in-process through tools/scan_replay.py, with the
vision model answered from the fixture's truth (labels on the upright fronts),
and asserts:
  - the proven truth: pass 1 = backs REVERSED, pass 2 = fronts, 6/6 pairs as
    row maxima, 3 labelled fronts, the 2 blank backs BLANK and every other page
    WRITTEN, no flag, and the planner port's 3 copies;
  - the calibration floors (the current thresholds keep this much room);
  - planted faults on the same real images: a sheet turned over in the pile
    (BACK_HAS_LABEL), a double-feed in both passes (PAIR_SHIFT_DETECTED), the
    fronts fed upside-down (rotation found, same pairs);
  - a local scan_build (uploads stubbed) writes the 3 PDFs.
No network, no model, no database.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "scan" / "expected_11_18.json"
SCANS = os.getenv("SCAN_FIXTURES_DIR")

pytestmark = pytest.mark.skipif(not SCANS, reason="SCAN_FIXTURES_DIR is not set (private scans, not in git)")


def _tool():
    spec = importlib.util.spec_from_file_location("scan_replay", ROOT / "tools" / "scan_replay.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def tool():
    return _tool()


@pytest.fixture(scope="module")
def exp():
    return json.loads(FIXTURE.read_text())


@pytest.fixture(scope="module")
def pass_files(tool, exp):
    files = {int(pn): tool.list_pass(Path(SCANS) / d) for pn, d in exp["pass_dirs"].items()}
    problems = tool.check_fixture_files(files, exp)
    assert not problems, "SCAN_FIXTURES_DIR does not hold the 11-18 scans: " + "; ".join(problems)
    return files


@pytest.fixture(scope="module")
def report(tool, exp, pass_files):
    return tool.run(pass_files, llm_mode="expected", exp=exp, workers=2)


def test_working_scales_match_the_fixture(exp):
    from app.services.copy_check.scan import pages

    ws = exp["working_scales"]
    assert (pages.INK_MAX_DPI, pages.WORK_DPI, pages.GRAY_DPI) == (ws["ink_max_dpi"], ws["work_dpi"], ws["gray_dpi"])


def test_reproduces_the_11_18_truth(tool, exp, report):
    assert tool.compare_expected(report, exp) == []
    r = report["result"]
    assert r["layout"]["fronts_pass"] == 2 and r["layout"]["backs_order"] == "REVERSED"
    assert all(s["pair_is_row_max"] for s in r["sheets"])
    assert [p["dpi_source"] for p in r["pages"]] == ["JFIF"] * 12
    # the probe (6 pages x 2 ways) and one read of the 3 fronts it did not see
    assert report["llm"]["calls"] == [12, 3] and report["llm"]["unknown_strips"] == 0


def test_thresholds_keep_their_room(exp, report):
    f = exp["floors"]
    bc = report["blank_calibration"]
    assert bc["misclassified"] == []
    assert bc["blank_ink_headroom_x"] >= f["blank_ink_headroom_x"]
    assert bc["blob_headroom_x"] >= f["blob_headroom_x"]
    assert bc["written_over_unsure_x"] >= f["written_over_unsure_x"]
    assert report["result"]["layout"]["order_margin"] >= f["order_margin"]
    assert report["layout_detail"]["min_row_margin"] >= f["min_band_margin"]
    ls = report["label_sims"]
    assert min(ls["label_fronts_leave_one_out"].values()) >= f["label_front_sim_min"]
    assert max(ls["backs_best_of_both_ways"].values()) <= f["back_sim_max"]


def test_turned_over_sheet_blocks(tool, exp, pass_files):
    files, origin = tool.plant_faults(pass_files, ["p2.0=p1.5"], [])
    r = tool.run(files, exp=exp, workers=2, origin=origin)["result"]
    flags = {(f["code"], f["sheet_no"]) for f in r["flags"]}
    assert ("BACK_HAS_LABEL", 0) in flags
    assert r["status"] == "BLOCKED"


def test_double_feed_in_both_passes_blocks(tool, exp, pass_files):
    # sheet 1's front and sheet 4's back never got scanned: counts still match
    files, origin = tool.plant_faults(pass_files, [], ["p2.1", "p1.1"])
    r = tool.run(files, exp=exp, workers=2, origin=origin)["result"]
    assert r["layout"]["shift"] == {"from_sheet": 1, "offset": 1}
    assert any(f["code"] == "PAIR_SHIFT_DETECTED" for f in r["flags"])
    assert r["status"] == "BLOCKED"


def test_fronts_fed_upside_down(tool, exp, pass_files, tmp_path):
    files, origin = tool.plant_faults(pass_files, [], [], turn=[2], work_dir=tmp_path)
    r = tool.run(files, exp=exp, workers=2, origin=origin)["result"]
    lay = r["layout"]
    assert (lay["fronts_pass"], lay["fronts_rotation"], lay["backs_order"], lay["backs_rotation"]) == (2, 180, "REVERSED", 0)
    assert [s["back"] for s in r["sheets"]] == [exp["pairs"][str(i)] for i in range(6)]
    assert all(s["pair_is_row_max"] for s in r["sheets"])
    assert r["status"] == "OK"


def test_local_build_writes_the_three_copies(tool, report, pass_files, tmp_path):
    import asyncio

    import fitz

    out = asyncio.run(tool.build_local(report["result"], report["plan"], pass_files, tmp_path))
    assert [(c["copy_key"], c["page_count"], c["error"]) for c in out] == [
        ("L1-S0", 4, None), ("L1-S2", 4, None), ("L1-S5", 2, None)]
    for name, pages in (("scan_l1_c1.pdf", 4), ("scan_l1_c2.pdf", 4), ("scan_l1_c3.pdf", 2)):
        with fitz.open(tmp_path / name) as doc:
            assert doc.page_count == pages
            assert all(p.rotation == 0 for p in doc)
