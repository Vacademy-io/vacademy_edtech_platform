"""Production import smoke test for the course_knowledge package.

Production runs ``uvicorn ai_service.main:app`` with only the repo root on
PYTHONPATH, so the top-level name ``app`` is NOT importable there. The rest of
the suite puts ai_service/ itself on sys.path, which hides a stray
``from app....`` import. This test imports the package the way production does,
in a clean subprocess.
"""

import os
import subprocess
import sys
from pathlib import Path

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]


def test_course_knowledge_imports_under_production_package_name(tmp_path):
    (tmp_path / "ai_service").symlink_to(AI_SERVICE_DIR, target_is_directory=True)
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["PYTHONPATH"] = str(tmp_path)
    code = (
        "import ai_service.app.services.course_knowledge.store\n"
        "import ai_service.app.services.course_knowledge.links\n"
        "import ai_service.app.routers.course_knowledge\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(tmp_path),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert proc.returncode == 0, proc.stderr[-4000:]
