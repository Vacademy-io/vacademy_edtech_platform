"""The Scan Station's spawned workers import only what their job needs.

A spawned worker imports app.services.copy_check on the way to scan/ or
scan_build/. That package used to import the whole grading orchestrator at
import time, which cost every analyse/build worker ~50 MB of RSS. It is lazy
now; these checks run a fresh interpreter so nothing loaded by other tests
hides a regression.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

AI_SERVICE = Path(__file__).resolve().parents[1]
HEAVY = ("copy_check.orchestrator", "copy_check.grader", "copy_check.callbacks", "chat_llm_client")


def _fresh(code: str, cwd: Path = AI_SERVICE) -> str:
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join([str(AI_SERVICE), str(AI_SERVICE.parent), env.get("PYTHONPATH", "")])
    out = subprocess.run([sys.executable, "-c", code], cwd=cwd, env=env, capture_output=True, text=True,
                         timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    return out.stdout.strip().splitlines()[-1]


@pytest.mark.parametrize("pkg", ["app", "ai_service.app"])
@pytest.mark.parametrize("worker_module", ["copy_check.scan.pages", "copy_check.scan.showthrough",
                                           "copy_check.scan_build.builder"])
def test_worker_entry_modules_do_not_load_the_orchestrator(pkg, worker_module):
    loaded = _fresh(
        "import importlib, sys\n"
        f"importlib.import_module('{pkg}.services.{worker_module}')\n"
        f"print(sorted(m for m in sys.modules if m.endswith({HEAVY!r})))\n"
    )
    assert loaded == "[]"


@pytest.mark.parametrize("pkg", ["app", "ai_service.app"])
def test_package_attributes_still_resolve(pkg):
    out = _fresh(
        "import importlib\n"
        f"cc = importlib.import_module('{pkg}.services.copy_check')\n"
        f"from {pkg}.services.copy_check import grade_copy\n"
        f"from {pkg}.services.copy_check.orchestrator import grade_copy as real\n"
        "assert grade_copy is real and cc.grade_copy is real\n"
        "assert cc.callbacks.__name__.endswith('copy_check.callbacks')\n"
        "assert cc.scan.__name__.endswith('copy_check.scan')\n"
        "assert 'grade_copy' in dir(cc) and 'orchestrator' in dir(cc)\n"
        "assert not hasattr(cc, 'no_such_thing')\n"
        "print('ok')\n"
    )
    assert out == "ok"
