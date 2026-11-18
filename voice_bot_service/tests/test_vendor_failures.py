"""Failed vendor calls are kept for admin-core: outside hosts only, no secrets, unique ids."""
import asyncio

import aiohttp
import httpx
import pytest
from aiohttp import web

from app import vendor_failures as vf


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(vf, "_kept", vf.collections.deque(maxlen=vf.MAX_KEPT))
    vf.install()
    yield


def test_only_outside_hosts_count():
    assert vf._external("api.sarvam.ai")
    for own in ("backend-stage.vacademy.io", "admin-core-service", "localhost", "10.0.0.5", "127.0.0.1", "x.svc.cluster.local"):
        assert not vf._external(own), own


def test_record_keeps_no_query_or_body_and_ids_are_unique():
    vf._record_url("POST", "https://api.sarvam.ai/text-to-speech/v2/extra?key=sk_secret", 402, None)
    vf._record_url("GET", "https://api.sarvam.ai/x", None, TimeoutError("sk_secret in message"))
    a, b = vf.recent()
    assert a["vendor"] == "api.sarvam.ai" and a["operation"] == "POST /text-to-speech/v2" and a["httpStatus"] == 402
    assert b["reason"] == "TimeoutError" and b["httpStatus"] is None
    assert "sk_secret" not in repr(vf.recent())
    assert a["id"] != b["id"]


def test_the_list_is_bounded():
    for _ in range(vf.MAX_KEPT + 50):
        vf.record("api.sarvam.ai", "STT stream")
    assert len(vf.recent(limit=10_000)) == vf.MAX_KEPT


def test_httpx_failures_are_caught_and_successes_are_not():
    def handler(request):
        return httpx.Response(429 if request.url.path == "/busy" else 200)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        client.get("https://api.openai.example/busy")
        client.get("https://api.openai.example/fine")
    kept = vf.recent()
    assert [(k["vendor"], k["httpStatus"]) for k in kept] == [("api.openai.example", 429)]


def test_aiohttp_sessions_are_traced(monkeypatch):
    # The trace hook is added to every ClientSession; an own host would be skipped,
    # so the check treats 127.0.0.1 as outside for this test only.
    monkeypatch.setattr(vf, "_external", lambda host: True)

    async def run():
        app = web.Application()
        app.router.add_get("/nope", lambda r: web.Response(status=401))
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://127.0.0.1:{port}/nope") as r:
                await r.read()
        await runner.cleanup()

    asyncio.run(run())
    assert [k["httpStatus"] for k in vf.recent()] == [401]


def test_sarvam_refusals_are_recorded(monkeypatch):
    from app import providers as pv
    monkeypatch.setenv("SARVAM_API_KEY", "sk_a")
    pv.get_settings.cache_clear()
    pool = pv.SarvamKeyPool()
    pool.refused(0, "credits")
    pv.get_settings.cache_clear()
    last = vf.recent()[-1]
    assert last["vendor"] == "api.sarvam.ai" and last["reason"].startswith("Out of credits")
