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


# ── errors raised inside a live call, whatever the transport ───────────────────

def _service(name):
    from pipecat.services.ai_service import AIService
    cls = type(name, (AIService,), {})
    return object.__new__(cls)  # no pipeline needed: the hook records before passing the frame on


def _push(processor, frame):
    from pipecat.processors.frame_processor import FrameProcessor
    try:
        asyncio.run(FrameProcessor.push_frame(processor, frame))
    except Exception:  # the bare object has no pipeline to push into; only the record matters
        pass


@pytest.mark.parametrize("cls, vendor, kind", [
    ("SarvamSTTService", "api.sarvam.ai", "in-call STT"),
    ("BodhiTTSService", "tts.navana.ai", "in-call TTS"),
    ("RumikTTSService", "silk-api.rumik.ai", "in-call TTS"),
    ("SmallestTTSService", "waves-api.smallest.ai", "in-call TTS"),
    ("DeepgramTTSService", "api.deepgram.com", "in-call TTS"),
    ("GoogleSTTService", "googleapis.com", "in-call STT"),
    ("AWSBedrockLLMService", "bedrock (AWS)", "in-call LLM"),
    ("OpenRouterLLMService", "openrouter.ai", "in-call LLM"),
])
def test_every_vendor_service_error_is_recorded(cls, vendor, kind, monkeypatch):
    from pipecat.frames.frames import ErrorFrame
    monkeypatch.setattr(vf, "_last_http", {})
    _push(_service(cls), ErrorFrame(error="received 1003 Credits exhausted; key=sk_live_secret"))
    last = vf.recent()[-1]
    assert (last["vendor"], last["operation"]) == (vendor, kind)
    assert "Credits exhausted" in last["reason"] and "sk_live_secret" not in last["reason"]


def test_an_error_frame_is_recorded_once_and_only_from_a_vendor_service(monkeypatch):
    from pipecat.frames.frames import ErrorFrame
    from pipecat.processors.frame_processor import FrameProcessor
    monkeypatch.setattr(vf, "_last_http", {})
    frame = ErrorFrame(error="socket closed")
    svc = _service("NavanaTTSService")
    _push(svc, frame)
    other = object.__new__(type("SomeProcessor", (FrameProcessor,), {}))
    _push(other, frame)                                   # the same frame passing upstream
    _push(other, ErrorFrame(error="our own processor failed"))  # not a vendor
    assert len(vf.recent()) == 1


def test_a_pipeline_error_right_after_the_http_failure_is_not_counted_twice(monkeypatch):
    from pipecat.frames.frames import ErrorFrame
    monkeypatch.setattr(vf, "_last_http", {})
    vf._record_url("POST", "https://openrouter.ai/api/v1/chat/completions", 429, None)
    _push(_service("OpenRouterLLMService"), ErrorFrame(error="429 Too Many Requests"))
    assert [k["operation"] for k in vf.recent()] == ["POST /api/v1"]


def test_navana_rumik_and_smallest_failures_outside_a_call(monkeypatch):
    from app import providers as pv
    monkeypatch.setattr(vf, "_last_http", {})
    monkeypatch.setenv("NAVANA_API_KEY", "nk_one,nk_two")
    pv.get_settings.cache_clear()
    pool = pv.NavanaKeyPool()
    pool.refused("nk_two", pool.BAD_KEY_SECS)
    pv.get_settings.cache_clear()
    last = vf.recent()[-1]
    assert (last["vendor"], last["operation"]) == ("tts.navana.ai", "key 2")
    assert "out of credit" in last["reason"] and "nk_two" not in repr(vf.recent())


def test_credentials_never_survive_in_a_reason():
    cleaned = vf.clean_reason("api-subscription-key: sk_abc Authorization: Bearer xyz ws://h?token=t0k&x=1 "
                              "and a long blob abcdefghijklmnopqrstuvwxyz0123456789")
    for secret in ("sk_abc", "xyz", "t0k", "abcdefghijklmnopqrstuvwxyz0123456789"):
        assert secret not in cleaned


def test_an_openai_compatible_llm_is_named_by_where_it_goes(monkeypatch):
    from pipecat.frames.frames import ErrorFrame
    monkeypatch.setattr(vf, "_last_http", {})
    svc = _service("OpenAILLMService")
    svc._client = type("C", (), {"base_url": "https://api.sarvam.ai/v1/"})()
    _push(svc, ErrorFrame(error="402 insufficient_quota_error"))
    assert vf.recent()[-1]["vendor"] == "api.sarvam.ai"
