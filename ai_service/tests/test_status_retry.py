"""Offline test for the status-write retry hardening (deep-review fix).

_set_status must retry transient DB failures (so a blip doesn't strand a task in
PROGRESS until the startup sweep), succeed if a later attempt works, and remain
best-effort (never raise) if all attempts fail.

Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_status_retry.py
"""
from __future__ import annotations

import sys
import time as _real_time
from types import SimpleNamespace
from contextlib import contextmanager
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.models.ai_task import AiTaskStatus
from ai_service.app.services import ai_task_service as S


def _install_fakes(fail_times: int):
    """Patch db_session/AiTaskRepository/time.sleep; return a call-count dict."""
    calls = {"update": 0, "sleep": 0}

    @contextmanager
    def fake_session():
        yield object()

    class FakeRepo:
        def __init__(self, db):
            pass

        def update_status(self, task_id, status, **kw):
            calls["update"] += 1
            if calls["update"] <= fail_times:
                raise RuntimeError("transient DB error")
            return object()

    S.db_session = fake_session
    S.AiTaskRepository = FakeRepo
    # A stand-in for the module's `time`, never the global time module: assigning
    # time.sleep itself made every later test in the run sleep for 0 s.
    S.time = SimpleNamespace(**{n: getattr(_real_time, n) for n in dir(_real_time) if not n.startswith("__")})
    S.time.sleep = lambda *_a, **_k: calls.__setitem__("sleep", calls["sleep"] + 1)
    return calls


@pytest.fixture(autouse=True)
def _restore_module():
    """Undo _install_fakes after each test (pytest runs; main() needs no cleanup)."""
    saved = (S.db_session, S.AiTaskRepository, S.time)
    yield
    S.db_session, S.AiTaskRepository, S.time = saved


def test_succeeds_after_transient_failures() -> None:
    calls = _install_fakes(fail_times=2)  # fail twice, succeed on 3rd
    S._set_status("t1", AiTaskStatus.COMPLETED, result_json="{}")
    assert calls["update"] == 3, calls
    assert calls["sleep"] == 2, calls  # backoff between the 3 attempts
    print("  ✓ retries transient failures and succeeds on a later attempt")


def test_best_effort_when_all_attempts_fail() -> None:
    calls = _install_fakes(fail_times=99)  # always fail
    # Must NOT raise (best-effort; the startup sweep is the backstop).
    S._set_status("t2", AiTaskStatus.FAILED, status_message="boom")
    assert calls["update"] == S._STATUS_WRITE_ATTEMPTS, calls
    print(f"  ✓ exhausts {S._STATUS_WRITE_ATTEMPTS} attempts then swallows (no raise)")


def main() -> int:
    tests = [test_succeeds_after_transient_failures, test_best_effort_when_all_attempts_fail]
    failed = 0
    for t in tests:
        print(f"\n{t.__name__}:")
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"  ✗ FAILED: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ✗ ERROR: {type(e).__name__}: {e}")
    print("\n" + ("ALL PASSED" if not failed else f"{failed} FAILED"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
