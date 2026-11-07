"""Suite-wide test hygiene."""
import sys

import pytest


@pytest.fixture(autouse=True)
def _reset_ai_video_drain_flag():
    """A test that runs the real app lifespan ends it — and shutdown drains the
    process's AI-video legs, which marks the process as draining for good (in
    production the process exits next). Clear it so later tests' resumers
    still scan."""
    yield
    mod = sys.modules.get("app.services.ai_video_run_lease")
    if mod is not None:
        mod._draining.clear()
