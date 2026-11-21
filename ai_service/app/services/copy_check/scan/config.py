"""Scan Station settings, read from the environment at call time.

Everything is OFF unless COPY_CHECK_SCAN_STATION is '1' or 'true': both scan
routes answer 404 then. The thresholds below come from the 2026-11-18 Brother
scan test and are recalibrated on real handwritten copies before any pilot
(plan task T6), so each one is an env var rather than a literal.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

FLAG_ENV = "COPY_CHECK_SCAN_STATION"

MAX_PAGES_PER_PASS = 100
MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_LOAD_BYTES = 400 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 30.0
# The whole analyse call must end inside assessment_service's 300 s timeout.
CALL_BUDGET_SECONDS = 240.0
ADMIT_WAIT_SECONDS = 2.0
# Header strips sent to the vision model per call (the probe may send more).
HEADER_CHUNK = 8
PROBE_CHUNK = 12


def enabled() -> bool:
    return (os.getenv(FLAG_ENV) or "").strip().lower() in ("1", "true")


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return max(1, int(float(os.getenv(name, str(default)))))
    except ValueError:
        return default


@dataclass(frozen=True)
class ScanSettings:
    blank_ink: float          # ink px per 10k below which a page may be BLANK
    unsure_ink: float         # below this (and not BLANK) a page is UNSURE
    blob_mm2: float           # one blob this large keeps a low-ink page out of BLANK
    order_min_margin: float   # (best - second) / best of the layout hypotheses
    label_sim_min: float      # a label front this unlike the others -> LABEL_UNUSUAL
    back_label_sim: float     # a back this like the label template -> BACK_HAS_LABEL
    workers: int              # spawned processes for pixel work
    max_calls: int            # analyse calls admitted at once on this pod
    header_concurrency: int   # header-read model calls in flight per analyse call


def settings() -> ScanSettings:
    return ScanSettings(
        blank_ink=_float("SCAN_BLANK_INK", 1.0),
        unsure_ink=_float("SCAN_UNSURE_INK", 3.0),
        blob_mm2=_float("SCAN_BLOB_MM2", 4.0),
        order_min_margin=_float("SCAN_ORDER_MIN_MARGIN", 0.15),
        label_sim_min=_float("SCAN_LABEL_SIM_MIN", 0.35),
        back_label_sim=_float("SCAN_BACK_LABEL_SIM", 0.6),
        workers=_int("SCAN_WORKERS", 2),
        max_calls=_int("SCAN_MAX_CALLS", 2),
        header_concurrency=_int("SCAN_HEADER_CONCURRENCY", 3),
    )
