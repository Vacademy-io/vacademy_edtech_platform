"""The /copy-check/identify handler imports its collaborators lazily, inside the
function — so a wrong module path is invisible to import-time checks and to the
identify_student unit tests, and only fails when a real copy arrives. That is
exactly what happened in prod from 2026-09-15 to 2026-09-20 (`..api_key_resolver`
instead of `..services.api_key_resolver` → 500 on every bulk upload). This calls
the route through the app with everything behind it stubbed, so the imports run.
"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import require_internal_service_token
from app.db import db_dependency
from app.routers import copy_check as router_module
from app.services.copy_check import identify as identify_module


def test_identify_route_resolves_its_lazy_imports(monkeypatch):
    async def fake_identify(pdf_url, llm, model, *, institute_id=None):
        assert pdf_url == "https://x/copy.pdf"
        assert llm is not None and model
        return {"student_name": "Priyanshu", "name_found": True, "confidence": 0.9,
                "page_count": 7, "pages_read": 1, "usage": {"tokens": 1}}

    monkeypatch.setattr(identify_module, "identify_student", fake_identify)
    # The resolver only needs a session object it never has to use here.
    monkeypatch.setattr("app.services.api_key_resolver.ApiKeyResolver.__init__", lambda self, db: None)

    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[require_internal_service_token] = lambda: None
    app.dependency_overrides[db_dependency] = lambda: object()

    with TestClient(app) as client:
        resp = client.post(
            router_module.router.prefix + "/identify",
            json={"pdf_url": "https://x/copy.pdf", "institute_id": "inst"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["student_name"] == "Priyanshu"
    assert "usage" not in body
