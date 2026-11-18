"""Scan Station analyse-load end to end (scan/analyse.py), with the downloads and
the vision model stubbed. Synthetic 200 DPI JPEG pages, no network.

The 2026-11-18 Brother layout: pass 1 = the backs in reverse order, pass 2 =
the fronts, both upright. Copies start at sheets 0, 2 and 5.
"""
from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import pytest

from app.schemas.copy_check_scan import AnalyseLoadResponse
from app.services.copy_check.scan import analyse, fetch, pages
from copy_check_scan_synth import front_page, jpeg_bytes, pile

N = 6
LABELS = {0: "Aarav Sharma", 2: "Priya Verma", 5: "Rohan Gupta"}
WRITTEN_BACKS = {0, 1, 4}


def _jpeg200(rgb) -> bytes:
    up = cv2.resize(rgb, (rgb.shape[1] * 2, rgb.shape[0] * 2), interpolation=cv2.INTER_LINEAR)
    return jpeg_bytes(up, dpi=200, quality=85)


@pytest.fixture(scope="module")
def load_files(tmp_path_factory):
    fronts, backs = pile(N, labels=set(LABELS), written_backs=WRITTEN_BACKS, seed=3)
    files = {
        1: [_jpeg200(b) for b in reversed(backs)],     # pass 1: backs, reversed
        2: [_jpeg200(f) for f in fronts],              # pass 2: fronts
    }
    # the exact strips analyse will send, so the stub model can recognise them
    tmp = tmp_path_factory.mktemp("strips")
    strip_owner: dict[bytes, tuple[int, int, str]] = {}
    for p, blobs in files.items():
        for i, data in enumerate(blobs):
            path = tmp / f"{p}_{i}.jpg"
            path.write_bytes(data)
            feat = pages.extract_file(str(path), "IMAGE", 100).pages[0]
            strip_owner[feat.strip_up] = (p, i, "up")
            strip_owner[feat.strip_down] = (p, i, "down")
    return files, strip_owner


class _Model:
    """Reads a strip as a printed field exactly when it is the upright top of a
    labelled front (pass 2); `illegible` sheets carry an unreadable value."""

    def __init__(self, strip_owner, illegible=(), fail=False):
        self.owner = strip_owner
        self.illegible = set(illegible)
        self.fail = fail
        self.calls: list[int] = []

    async def chat_completion(self, messages, temperature, max_tokens, institute_id, model):
        import base64

        parts = [p for p in messages[1]["content"] if p["type"] == "image_url"]
        self.calls.append(len(parts))
        if self.fail:
            raise RuntimeError("provider 502")
        out = []
        for k, part in enumerate(parts, start=1):
            strip = base64.b64decode(part["image_url"]["url"].split(",", 1)[1])
            p, i, way = self.owner.get(strip, (0, -1, "?"))
            if p == 2 and way == "up" and i in LABELS:
                legible = i not in self.illegible
                out.append({"i": k, "label_kind": "PRINTED_FIELD", "name_value": LABELS[i] if legible else "~~",
                            "name_legible": legible, "roll_value": str(10 + i), "confidence": 0.95})
            else:
                out.append({"i": k, "label_kind": "NONE", "name_value": None, "name_legible": False,
                            "roll_value": None, "confidence": 0.9})
        return {"content": json.dumps(out), "usage": {"prompt_tokens": 1000, "completion_tokens": 50}}


def _request(files):
    return {
        "institute_id": "inst-1", "session_id": "sess-1", "load_no": 3, "preferred_model": None,
        "passes": [{"pass_no": p, "files": [
            {"file_id": f"f{p}-{i}", "url": f"https://media.test/{p}/{i}?sig=x", "kind": "IMAGE",
             "name": "Scan.jpeg" if i == 0 else f"Scan {i}.jpeg"}
            for i in range(len(blobs))]} for p, blobs in sorted(files.items())],
    }


def _fetcher(files):
    async def fake_fetch(specs, tmp: Path):
        got = {}
        for idx, spec in enumerate(specs):
            p, i = (int(x) for x in spec.url.split("?")[0].rsplit("/", 2)[-2:])
            path = tmp / f"f{idx}{spec.suffix}"
            path.write_bytes(files[p][i])
            got[spec.key] = fetch.Fetched(path=str(path), size=len(files[p][i]))
        return got, False
    return fake_fetch


def _run(files, model):
    with ThreadPoolExecutor(2) as ex:
        out = asyncio.run(analyse.analyse_load(_request(files), llm=model, model="m-x",
                                               executor=ex, fetcher=_fetcher(files)))
    AnalyseLoadResponse.model_validate(out)       # the C1 shape, always
    return out


def _codes(out):
    return [(f["code"], f["sheet_no"]) for f in out["flags"]]


def test_brother_layout_end_to_end(load_files):
    files, owner = load_files
    model = _Model(owner)
    out = _run(files, model)
    assert out["analyser_version"] == "scan-1" and out["load_no"] == 3
    assert out["layout"] == {"fronts_pass": 2, "fronts_rotation": 0, "backs_order": "REVERSED",
                             "backs_rotation": 0, "order_margin": out["layout"]["order_margin"],
                             "shift": None, "blank_rule_suspect": False}
    assert out["layout"]["order_margin"] >= 0.15
    assert [p["ref"] for p in out["pages"]] == [f"p1.{i}" for i in range(N)] + [f"p2.{i}" for i in range(N)]
    page = out["pages"][0]
    assert (page["dpi"], page["dpi_source"], page["width_px"]) == (200, "JFIF", 1654)
    sheets = out["sheets"]
    assert [s["front"] for s in sheets] == [f"p2.{i}" for i in range(N)]
    assert [s["back"] for s in sheets] == [f"p1.{N - 1 - i}" for i in range(N)]
    assert all(s["pair_is_row_max"] for s in sheets)
    assert [s["label_present"] for s in sheets] == [i in LABELS for i in range(N)]
    assert [s["label_kind"] for s in sheets if s["label_present"]] == ["PRINTED_FIELD"] * 3
    assert sheets[2]["name_text"] == "Priya Verma" and sheets[2]["name_readable"]
    assert sheets[2]["roll_text"] == "12"
    assert [s["back_blank_class"] for s in sheets] == \
        ["WRITTEN" if i in WRITTEN_BACKS else "BLANK" for i in range(N)]
    assert all(s["front_blank_class"] == "WRITTEN" for s in sheets)
    assert not any(s["back_label_like"] for s in sheets)
    assert out["evidence"] == {"first_front_label": True, "last_front_label": True}
    assert out["status"] == "OK", out["flags"]
    # one probe call (3 pages x 2 passes x 2 ways up) + one call for the 3 unread fronts
    assert model.calls == [12, 3]
    assert out["usage"] == {"model": "m-x", "model_calls": 2, "prompt_tokens": 2000, "completion_tokens": 100}


def test_count_mismatch_blocks_after_only_the_probe(load_files):
    files, owner = load_files
    short = {1: files[1][:-1], 2: files[2]}
    model = _Model(owner)
    out = _run(short, model)
    assert out["status"] == "BLOCKED"
    assert ("COUNT_MISMATCH", None) in _codes(out)
    assert out["layout"] is None and out["sheets"] == []
    assert len(out["pages"]) == 2 * N - 1
    assert model.calls == [12]


def test_corrupt_jpeg_is_file_unreadable_and_the_load_still_answers(load_files):
    files, owner = load_files
    broken = {1: list(files[1]), 2: files[2]}
    broken[1][2] = broken[1][2][:2000]
    out = _run(broken, _Model(owner))
    assert out["status"] == "BLOCKED"
    assert [c for c, _s in _codes(out)].count("FILE_UNREADABLE") == 1
    bad = next(p for p in out["pages"] if p["ref"] == "p1.2")
    assert bad["error"] == "unreadable" and bad["blank_class"] == "WRITTEN"
    assert len(out["sheets"]) == N           # the other pages are still paired


def test_label_without_a_readable_value(load_files):
    files, owner = load_files
    out = _run(files, _Model(owner, illegible={2}))
    assert ("LABEL_NO_VALUE", 2) in _codes(out)
    assert out["sheets"][2]["label_present"] and not out["sheets"][2]["name_readable"]
    assert out["status"] == "REVIEW"


def test_a_sheet_turned_over_in_the_pile_blocks(load_files, tmp_path):
    files, owner = load_files
    # sheet 3's back (pass 1 position 2) is really a labelled front
    turned = _jpeg200(front_page(4242, label=True, name_seed=42))
    bad = {1: list(files[1]), 2: files[2]}
    bad[1][N - 1 - 3] = turned
    out = _run(bad, _Model(owner))
    assert ("BACK_HAS_LABEL", 3) in _codes(out)
    assert out["sheets"][3]["back_label_like"] is True
    assert out["status"] == "BLOCKED"


def test_model_outage_is_retryable(load_files, monkeypatch):
    from app.services.copy_check.scan import header_read

    monkeypatch.setattr(header_read, "RETRY_SLEEP_SECONDS", 0.0)
    files, owner = load_files
    with pytest.raises(header_read.ScanRetryable):
        _run(files, _Model(owner, fail=True))


_ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(
    _ROOT.name == "app" and (_ROOT / "__init__.py").exists(),
    reason="checkout mounted at a directory named 'app': a spawned child resolves 'app' to the "
           "checkout root itself (ai_service/__init__.py); mount it as .../ai_service to run this",
)
def test_spawned_pool_runs_the_page_worker(tmp_path):
    path = tmp_path / "x.jpg"
    path.write_bytes(_jpeg200(front_page(1, label=True)))
    try:
        res = analyse._get_pool().submit(pages.extract_file, str(path), "IMAGE", 100).result(timeout=120)
    finally:
        analyse._reset_pool()
    assert res.error is None and res.pages[0].dpi_source == "JFIF"


def _sleep(seconds):
    import time

    time.sleep(seconds)
    return seconds


def test_jobs_cancel_queued_work_and_report_running_work():
    import threading

    gate = threading.Event()
    pool = ThreadPoolExecutor(1)
    jobs = analyse.Jobs()

    async def go():
        jobs.submit(pool, gate.wait, 10)          # runs
        jobs.submit(pool, _sleep, 0)              # queued behind it
        await asyncio.sleep(0.05)
        running = jobs.outstanding()
        assert len(running) == 1 and jobs.futures[1].cancelled()
        gate.set()
        await asyncio.wait([asyncio.wrap_future(f) for f in running], timeout=5)
        assert jobs.outstanding() == []

    try:
        asyncio.run(go())
    finally:
        gate.set()
        pool.shutdown()


def test_stuck_jobs_kill_the_workers_and_free_the_slot(monkeypatch):
    """After ORPHAN_WAIT_SECONDS a job still running is stuck: the pool's
    workers are killed (nothing else stops a running job) and the slot freed."""
    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor

    pool = ProcessPoolExecutor(1, mp_context=multiprocessing.get_context("fork"))
    monkeypatch.setattr(analyse, "_pool", pool)
    analyse.slots.in_use = 1
    jobs = analyse.Jobs()

    async def go():
        fut = jobs.submit(pool, _sleep, 60)
        await asyncio.sleep(0.5)                  # the worker has picked it up
        procs = list(pool._processes.values())
        await analyse.release_after_jobs(jobs, wait_seconds=0.2)
        for proc in procs:
            proc.join(5)
            assert not proc.is_alive()
        with pytest.raises(Exception):
            await asyncio.wait_for(fut, 10)       # BrokenProcessPool, not a 60 s wait

    try:
        asyncio.run(go())
        assert analyse.slots.in_use == 0
        assert analyse._pool is None              # the next call builds a fresh pool
    finally:
        analyse.slots.in_use = 0
        pool.shutdown(wait=False, cancel_futures=True)
