"""/utils/scrape-url: needs a signed-in user, and fetches only public pages
(through safe_fetch, so redirects and DNS answers are re-checked)."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import get_current_user  # noqa: E402
from app.routers import utils as utils_router  # noqa: E402
from app.services import scraper_service as scraper_mod  # noqa: E402
from app.services.safe_http import FetchResult, SafeFetchError  # noqa: E402


def _app():
    app = FastAPI()
    app.include_router(utils_router.router)
    return app


def test_scrape_url_without_sign_in_is_refused():
    client = TestClient(_app())
    resp = client.post("/utils/scrape-url", json={"url": "https://example.com/"})
    assert resp.status_code == 401


def test_scrape_url_signed_in_returns_page_text(monkeypatch):
    async def fake_fetch(url, **kwargs):
        assert kwargs["allow_http"] is True
        html = b"<html><head><title>Hello</title></head><body><p>Page body</p></body></html>"
        return FetchResult(url=url, status_code=200,
                           headers=httpx.Headers({"content-type": "text/html; charset=utf-8"}), content=html)

    monkeypatch.setattr(scraper_mod, "safe_fetch", fake_fetch)
    app = _app()
    app.dependency_overrides[get_current_user] = lambda: object()
    resp = TestClient(app).post("/utils/scrape-url", json={"url": "https://example.com/"})
    assert resp.status_code == 200
    assert resp.json() == {"content": "Page body", "title": "Hello"}


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5:8080/",
    "http://100.64.0.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
])
def test_private_addresses_are_refused(url):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(scraper_mod.ScraperService().scrape_url(url))
    assert exc.value.status_code == 400


def test_refused_redirect_maps_to_400(monkeypatch):
    async def refuse(url, **kwargs):
        raise SafeFetchError("blocked_address", "redirect to a private address")

    monkeypatch.setattr(scraper_mod, "safe_fetch", refuse)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(scraper_mod.ScraperService().scrape_url("https://example.com/redirect"))
    assert exc.value.status_code == 400


def test_target_404_is_passed_on(monkeypatch):
    async def not_found(url, **kwargs):
        return FetchResult(url=url, status_code=404, headers=httpx.Headers({}), content=b"")

    monkeypatch.setattr(scraper_mod, "safe_fetch", not_found)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(scraper_mod.ScraperService().scrape_url("https://example.com/missing"))
    assert exc.value.status_code == 404


@pytest.mark.parametrize("url", ["http://127.0.0.1/a.pdf", "http://169.254.169.254/", "http://localhost/x"])
def test_kb_url_precheck_refuses_private_hosts(url):
    from app.services.kb.parsing import assert_public_http_url
    with pytest.raises(ValueError):
        assert_public_http_url(url)
