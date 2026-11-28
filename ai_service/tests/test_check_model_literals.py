"""scripts/check_model_literals.py: the CI guard against new hard-coded model ids.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_check_model_literals.py -q
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRIPT = os.path.join(REPO_ROOT, "scripts", "check_model_literals.py")

_spec = importlib.util.spec_from_file_location("check_model_literals", SCRIPT)
cml = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cml)  # type: ignore[union-attr]


def _write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


@pytest.fixture
def repo(tmp_path):
    root = str(tmp_path)
    _write(root, "ai_service/app/services/a.py", 'MODEL = "z-ai/glm-5.3-flash"\nOTHER = \'google/gemini-2.5-flash\'\n')
    _write(root, "frontend-admin-dashboard/src/x.tsx", "const m = `anthropic/claude-sonnet-4.5`;\n")
    _write(root, "admin_core_service/src/main/java/A.java", 'String m = "gpt-5.4"; String n = "claude-opus-4-5";\n')
    return root


def _run(root, *extra):
    return cml.main(["--root", root, *extra])


def test_literal_detection():
    found = [lit for _, lit in cml.literals_in(
        'a = "google/gemini-2.5-flash"; b = "z-ai/glm-5.3-flash:batch"; c = "gemini-2.5-pro"\n'
        'u = "https://openrouter.ai/api/v1/chat"; p = "google/"; q = "the google/x model"\n'
        "d = 'bytedance-seed/seedream-4.5'; e = `recraft/recraft-v4.1`; f = 'gpt-'; g = 'claude-'\n"
        'h = "google/gemini-${tier}"; i = "my-gemini-key"; j = "anthropic/claude-sonnet-4.5"\n'
    )]
    assert found == ["google/gemini-2.5-flash", "z-ai/glm-5.3-flash:batch", "gemini-2.5-pro",
                     "bytedance-seed/seedream-4.5", "recraft/recraft-v4.1", "anthropic/claude-sonnet-4.5"]


def test_baseline_passes_and_new_literal_fails(repo, capsys):
    assert _run(repo, "--update") == 0
    assert _run(repo) == 0
    # a moved literal (new line numbers) is still known
    _write(repo, "ai_service/app/services/a.py",
           '\n\n# moved\nOTHER = \'google/gemini-2.5-flash\'\nMODEL = "z-ai/glm-5.3-flash"\n')
    assert _run(repo) == 0
    capsys.readouterr()
    # a brand-new literal fails and is listed with its line
    _write(repo, "ai_service/app/services/b.py", 'x = 1\nNEW = "openai/gpt-5.4"\n')
    assert _run(repo) == 1
    out = capsys.readouterr().out
    assert "ai_service/app/services/b.py:2  openai/gpt-5.4" in out
    # the same literal in a file that did not have it is new for that file
    _write(repo, "ai_service/app/services/b.py", 'NEW = "z-ai/glm-5.3-flash"\n')
    assert _run(repo) == 1


def test_excluded_paths_are_not_scanned(repo):
    assert _run(repo, "--update") == 0
    for rel in (
        "ai_service/tests/test_x.py",
        "ai_service/app/services/test_helper.py",
        "admin_core_service/src/main/java/db/migration/V1.java",
        "frontend-admin-dashboard/src/node_modules/pkg/index.js",
        "frontend-admin-dashboard/src/comp.test.tsx",
        "frontend-learner-dashboard-app/src/__tests__/a.ts",
        "voice_bot_service/app/bot.py",
        "ai_service/app/voice_bot_service/x.py",
        "admin_core_service/src/test/java/ATest.java",
    ):
        _write(repo, rel, 'M = "google/gemini-9-ultra"\n')
    assert _run(repo) == 0


def test_cli_exit_codes(repo):
    baseline = os.path.join(repo, "baseline.txt")
    ok = subprocess.run([sys.executable, SCRIPT, "--root", repo, "--baseline", baseline, "--update"],
                        capture_output=True, text=True)
    assert ok.returncode == 0
    _write(repo, "community_service/src/main/java/C.java", 'String m = "deepseek/deepseek-v4";\n')
    bad = subprocess.run([sys.executable, SCRIPT, "--root", repo, "--baseline", baseline],
                         capture_output=True, text=True)
    assert bad.returncode == 1 and "deepseek/deepseek-v4" in bad.stdout


def test_current_tree_matches_committed_baseline():
    """What CI runs. If this fails, a literal was added: read the model from the
    registry, or regenerate the baseline with --update and justify it."""
    assert cml.main(["--root", REPO_ROOT]) == 0
