"""ai_service loads the AI-plan and usage-limit indexes at startup.

A fresh pod used to serve its first requests with empty indexes, so a
plan-covered AI use was charged to the wallet until the background refresh
landed (seen on prod 2026-10-16, right after a deploy). The warm-up runs both
refreshes once; a failure only logs. No DB.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_billing_index_warmup.py -q
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app import app_factory  # noqa: E402
from ai_service.app.services.metering import limits, plans  # noqa: E402


def test_warm_up_loads_both_indexes(monkeypatch):
    calls = []
    monkeypatch.setattr(plans, "refresh_index", lambda session=None: calls.append("plans") or True)
    monkeypatch.setattr(limits, "refresh_policy_index", lambda session=None: calls.append("limits") or True)
    app_factory._warm_billing_indexes(logging.getLogger("t"))
    assert calls == ["plans", "limits"]


def test_a_failing_warm_up_never_raises(monkeypatch, caplog):
    def boom(session=None):
        raise RuntimeError("db down")
    monkeypatch.setattr(plans, "refresh_index", boom)
    monkeypatch.setattr(limits, "refresh_policy_index", boom)
    with caplog.at_level(logging.WARNING):
        app_factory._warm_billing_indexes(logging.getLogger("t"))
    assert "warm-up skipped" in caplog.text


def test_an_unloaded_plans_index_is_logged(monkeypatch, caplog):
    monkeypatch.setattr(plans, "refresh_index", lambda session=None: False)
    monkeypatch.setattr(limits, "refresh_policy_index", lambda session=None: True)
    with caplog.at_level(logging.WARNING):
        app_factory._warm_billing_indexes(logging.getLogger("t"))
    assert "did not load" in caplog.text
