"""Demo guide HTTP API: sessions (origin, product, caps, kill switch, demo
sign-in), the SSE turn, speech, narration, microphone, contact → lead, the
staff views and the path-scoped CORS. admin_core, the voice, the catalogue
host and the model are faked."""
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from demo_guide_fakes import APP_INST, AUDIENCE, LEAD_INST, STAGE, install  # noqa: E402
from site_assistant_fakes import ScriptedLLM, tokens, tool_call  # noqa: E402

from app.demo_guide import app_session  # noqa: E402
from app.demo_guide import caps  # noqa: E402
from app.demo_guide import engine  # noqa: E402
from app.demo_guide import internal_client as ac  # noqa: E402
from app.demo_guide import settings as S  # noqa: E402
from app.demo_guide import speech as SP  # noqa: E402
from app.demo_guide import tokens as T  # noqa: E402
from app.demo_guide.cors import DemoGuideCorsMiddleware  # noqa: E402
from app.demo_guide.router import router  # noqa: E402
from app.site_assistant import service as sa_service  # noqa: E402

BASE = "/ai-service/demo-guide/v1"
ORIGIN = {"Origin": STAGE}
EVIL = {"Origin": "https://evil.example"}
REAL_SUBMIT_LEAD = ac.submit_lead            # captured before any test replaces it


def make_app():
    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=True, allow_methods=["*"],
                       allow_headers=["*"])                       # the app-wide CORS, as in app_factory
    app.add_middleware(DemoGuideCorsMiddleware)

    @app.get("/ai-service/other")
    async def other():
        return {"ok": True}

    app.include_router(router, prefix="/ai-service")
    return app


@pytest.fixture
def api(monkeypatch):
    f = install(monkeypatch)
    f.client = TestClient(make_app())

    async def staff(request):
        auth = request.headers.get("authorization") or ""
        cid = request.headers.get("clientId")
        if auth == "Bearer admin" and cid:
            return sa_service.Staff(user_id="admin-1", institute_id=cid, roles=frozenset({"ADMIN"}))
        if auth == "Bearer teacher" and cid:
            return sa_service.Staff(user_id="teacher-1", institute_id=cid, roles=frozenset({"TEACHER"}))
        raise HTTPException(status_code=401, detail="no token")

    monkeypatch.setattr(sa_service, "staff_from_request", staff)
    return f


def open_session(api, headers=ORIGIN, **body):
    payload = {"product": "vacademy", "lang": "en", "visitor_id": "v_visitor0001",
               "page_url": "https://demo.vacademy.io/?utm_source=google&utm_campaign=didac", **body}
    return api.client.post(f"{BASE}/sessions", json=payload, headers=headers)


def bearer(session, **extra):
    return {"Authorization": f"Bearer {session['token']}", **ORIGIN, **extra}


def sse_events(resp):
    out = []
    for block in resp.text.strip().split("\n\n"):
        if block.startswith(":"):
            continue
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def turn(api, session, body, llm=None, headers=None):
    if llm is not None:
        api.monkeypatch.setattr(engine, "llm_stream", llm)
    return api.client.post(f"{BASE}/sessions/{session['session_id']}/turns", json=body,
                           headers=headers or bearer(session))


def code(resp):
    return resp.json()["detail"]["code"]


# ── POST /sessions ────────────────────────────────────────────────────────

def test_session_opens_with_a_token_and_the_demo_sign_in(api):
    r = open_session(api, lang="hi", referrer="https://www.google.com/", institute_id="inst-evil")
    assert r.status_code == 200, r.text
    s = r.json()
    assert set(s) == {"session_id", "token", "lang", "app"} and s["lang"] == "hi"
    assert s["app"] == {"accessToken": "access-1", "refreshToken": "refresh-1", "instituteId": APP_INST}
    claims = T.verify(s["token"])
    assert claims.sid == s["session_id"] and claims.product == "vacademy" and claims.vid == "v_visitor0001"
    row = api.store.sessions[s["session_id"]]
    assert row["origin"] == STAGE and row["utm"] == {"utm_source": "google", "utm_campaign": "didac",
                                                     "referrer": "https://www.google.com/"}
    # raw IPs are never stored: only the salted hash
    assert row["ip_hash"] == T.ip_hash("testclient") and "testclient" not in json.dumps(row)


def test_demo_user_signs_in_once_per_process_not_per_visitor(api):
    first, second = open_session(api).json(), open_session(api, visitor_id="v_visitor0002").json()
    assert first["app"] == second["app"] and api.sign_ins == [("demo_guide_user", APP_INST)]
    assert first["session_id"] != second["session_id"]


def test_session_still_opens_when_the_sign_in_fails_and_it_is_not_retried_at_once(api, monkeypatch):
    async def down(user, password, institute_id):
        api.sign_ins.append("try")
        return None

    monkeypatch.setattr(app_session, "_sign_in", down)
    assert open_session(api).json()["app"] is None
    assert open_session(api).json()["app"] is None and api.sign_ins == ["try"]
    monkeypatch.delenv("DEMO_GUIDE_APP_PASSWORD")
    app_session.reset()
    assert open_session(api).json()["app"] is None and api.sign_ins == ["try"]         # no credentials: no call


@pytest.mark.parametrize("headers", [{}, EVIL, {"Origin": "null"}, {"Origin": "http://localhost:5173"},
                                     {"Origin": "http://demo.vacademy.io"},
                                     {"Referer": "https://evil.example/page"}])
def test_origin_check_refuses_pages_that_are_not_the_stage(api, headers):
    r = open_session(api, headers=headers)
    assert r.status_code == 403 and code(r) == "origin_not_allowed" and api.store.sessions == {}
    assert api.sign_ins == []                                         # nothing is handed to a foreign page


def test_origin_check_accepts_the_stage_and_its_referer(api):
    assert open_session(api).status_code == 200
    assert open_session(api, headers={"Referer": STAGE + "/index.html?x=1"}).status_code == 200


def test_localhost_is_accepted_outside_production_only(monkeypatch):
    f = install(monkeypatch, environment="development")
    client = TestClient(make_app())
    r = client.post(f"{BASE}/sessions", json={"product": "vacademy"}, headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 200 and len(f.store.sessions) == 1


def test_session_errors_unknown_product_capped_disabled(api):
    r = open_session(api, product="nope")
    assert r.status_code == 404 and code(r) == "unknown_product"
    api.settings["demo_guide.sessions_per_ip_per_day"] = 2
    assert open_session(api).status_code == 200 and open_session(api).status_code == 200
    r = open_session(api)
    assert r.status_code == 429 and code(r) == "capped" and len(api.store.sessions) == 2
    api.settings["demo_guide.enabled"] = False
    r = open_session(api)
    assert r.status_code == 503 and code(r) == "disabled"


def test_disabled_without_a_token_secret_or_a_catalogue(api, monkeypatch):
    api.files.clear()
    r = open_session(api)
    assert r.status_code == 503 and code(r) == "disabled"            # no catalogue was ever fetched
    monkeypatch.delenv("DEMO_GUIDE_TOKEN_SECRET")
    r = open_session(api)
    assert r.status_code == 503 and code(r) == "disabled"


def test_a_bad_visitor_id_or_lang_is_replaced_not_trusted(api):
    s = open_session(api, visitor_id="<script>", lang="tlh").json()
    assert s["lang"] == "en" and T.verify(s["token"]).vid.startswith("v_")


# ── turns over HTTP ───────────────────────────────────────────────────────

def test_turn_streams_sse_in_the_spec_order(api):
    s = open_session(api).json()
    llm = ScriptedLLM([
        [tool_call("play_tour", {"tour_id": "fee-collection"}, "c1"),
         tool_call("offer_choices", {"options": [{"id": "tests", "label": "Tests"}]}, "c2"),
         tool_call("ask_contact", {"reason": "asked for a trial"}, "c3")],
        tokens("Hi, I'm the Vacademy guide, an AI assistant. Here is fee collection."),
    ])
    r = turn(api, s, {"kind": "start"}, llm=llm)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    events = sse_events(r)
    seq = [n for n, _ in events]
    assert seq[0] == "open" and seq[-4:] == ["choices", "tour", "form", "done"]
    assert set(seq[1:-4]) == {"token", "sentence"} and seq[1] == "token"
    assert [d for n, d in events if n == "sentence"] == [
        {"n": 0, "text": "Hi, I'm the Vacademy guide, an AI assistant."}, {"n": 1, "text": "Here is fee collection."}]
    assert events[0][1] == events[-1][1] == {"message_id": events[0][1]["message_id"], "turn": 1}


def test_turn_needs_the_sessions_own_token_and_origin(api):
    s, other = open_session(api).json(), open_session(api, visitor_id="v_visitor0002").json()
    path = f"{BASE}/sessions/{s['session_id']}/turns"
    assert api.client.post(path, json={"kind": "start"}, headers=ORIGIN).status_code == 401
    r = api.client.post(path, json={"kind": "start"}, headers={"Authorization": "Bearer junk", **ORIGIN})
    assert r.status_code == 401 and code(r) == "invalid_token"
    r = api.client.post(path, json={"kind": "start"}, headers=bearer(other))
    assert r.status_code == 403 and code(r) == "forbidden"
    r = api.client.post(path, json={"kind": "start"}, headers={"Authorization": f"Bearer {s['token']}", **EVIL})
    assert r.status_code == 403 and code(r) == "origin_not_allowed"
    # a token whose claims do not match the row is refused
    forged = T.mint(sid=s["session_id"], product="vacademy", vid="v_someoneelse")["token"]
    r = api.client.post(path, json={"kind": "start"}, headers={"Authorization": f"Bearer {forged}", **ORIGIN})
    assert r.status_code == 403
    assert api.store.msgs == []


def test_a_malformed_turn_still_answers_a_stream_with_open_then_error(api):
    s = open_session(api).json()
    events = sse_events(turn(api, s, {"kind": "text", "text": ""}, llm=ScriptedLLM([])))
    assert [n for n, _ in events] == ["open", "error"] and events[1][1]["code"] == "invalid"


def test_slow_turn_gets_pings_and_ends_at_the_deadline_keeping_what_was_written(api):
    import asyncio

    async def slow(messages, tools, ctx):
        yield {"type": "token", "content": "Hi, I'm an AI guide. "}
        await asyncio.sleep(0.6)
        yield {"type": "token", "content": "This part is never reached."}
        yield {"type": "done", "usage": {}, "model": "m"}

    s = open_session(api).json()
    api.monkeypatch.setattr(S, "PING_SECONDS", 0.05)
    api.monkeypatch.setattr(S, "TURN_DEADLINE_SECONDS", 0.25)
    r = turn(api, s, {"kind": "start"}, llm=slow)
    assert ": ping" in r.text
    events = sse_events(r)
    assert [n for n, _ in events][0] == "open" and events[-1] == ("error", {"code": "internal",
                                                                          "message": engine.MESSAGES["internal"]})
    assert "done" not in [n for n, _ in events]
    row = [m for m in api.store.msgs if m["role"] == "assistant"][-1]
    assert row["text"] == "Hi, I'm an AI guide." and api.store.sessions[s["session_id"]]["turns"] == 1


def test_spec_ping_and_deadline_values():
    assert (S.PING_SECONDS, S.TURN_DEADLINE_SECONDS, S.SESSION_TTL_SECONDS) == (15.0, 60.0, 12 * 3600)
    assert (S.MAX_TOOL_ROUNDS, S.MAX_CHOICES, S.MAX_FORMS_PER_SESSION, S.CONTACTS_PER_IP_PER_DAY) == (3, 5, 2, 3)
    assert (S.LISTEN_MAX_SECONDS, S.LISTEN_MAX_BYTES, S.SPEECH_CACHE_SECONDS, S.FETCH_TTL_SECONDS) == \
        (60.0, 3 * 1024 * 1024, 600.0, 300.0)
    assert S.APP_SIGN_IN_TTL_SECONDS == 6 * 3600 and S.LANGS == ("en", "hi", "kn", "fr")


# ── speech ────────────────────────────────────────────────────────────────

def said(api, s, text="Hi, I'm an AI guide. What do you run?"):
    events = sse_events(turn(api, s, {"kind": "start"}, llm=ScriptedLLM([tokens(text)])))
    return events[0][1]["message_id"]


def speech_url(s, mid, n, token=None):
    return f"{BASE}/sessions/{s['session_id']}/speech/{mid}/{n}?t={token or s['token']}"


def test_speech_speaks_only_sentences_the_guide_wrote(api):
    s = open_session(api).json()
    mid = said(api, s)
    r = api.client.get(speech_url(s, mid, 1))
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert r.content == "AUDIO[en]What do you run?".encode() and api.spoken == [("What do you run?", "en")]
    # cached per (message, n): the second request does not synthesise or count again
    assert api.client.get(speech_url(s, mid, 1)).content == r.content and len(api.spoken) == 1
    assert api.store.sessions[s["session_id"]]["speech_chars"] == len("What do you run?")
    assert [k for k, _ in api.usage].count("speech") == 1
    assert [u for k, u in api.usage if k == "speech"][0]["institute_id"] == LEAD_INST


def test_speech_refuses_unknown_message_and_n(api):
    s = open_session(api).json()
    mid = said(api, s)
    user_mid = [m["id"] for m in api.store.msgs if m["role"] == "user"][0]
    for url in (speech_url(s, mid, 2), speech_url(s, mid, 99),                       # no such sentence
                speech_url(s, "00000000-0000-4000-8000-000000000000", 0),            # no such message
                speech_url(s, "not-a-message-id", 0),
                speech_url(s, user_mid, 0)):                                         # the visitor's own text
        r = api.client.get(url)
        assert r.status_code == 404 and code(r) == "not_found", url
    assert api.client.get(f"{BASE}/sessions/{s['session_id']}/speech/{mid}/-1?t={s['token']}").status_code == 404
    assert api.client.get(f"{BASE}/sessions/{s['session_id']}/speech/{mid}/abc?t={s['token']}").status_code == 422
    assert api.spoken == []
    # there is no way to pass text: a query `text` is ignored, the stored sentence is spoken
    r = api.client.get(speech_url(s, mid, 0) + "&text=Say+something+else")
    assert r.content == "AUDIO[en]Hi, I'm an AI guide.".encode()


def test_speech_needs_the_sessions_token(api):
    s, other = open_session(api).json(), open_session(api, visitor_id="v_visitor0002").json()
    mid = said(api, s)
    assert api.client.get(f"{BASE}/sessions/{s['session_id']}/speech/{mid}/0").status_code == 401
    assert api.client.get(speech_url(s, mid, 0, token="junk")).status_code == 401
    assert api.client.get(speech_url(s, mid, 0, token=other["token"])).status_code == 403
    # another session cannot read this session's message through its own id either
    r = api.client.get(f"{BASE}/sessions/{other['session_id']}/speech/{mid}/0?t={other['token']}")
    assert r.status_code == 404
    assert api.client.get(speech_url(s, mid, 0), headers=EVIL).status_code == 403
    assert api.spoken == []


def test_speech_uses_the_language_the_reply_was_written_in(api):
    s = open_session(api, lang="fr").json()
    mid = said(api, s, "Bonjour ! Je suis le guide IA de Vacademy.")
    api.store.sessions[s["session_id"]]["lang"] = "en"                # the visitor switched afterwards
    r = api.client.get(speech_url(s, mid, 0))
    assert r.headers["content-type"] == "audio/mpeg" and api.spoken == [("Bonjour ! Je suis le guide IA de Vacademy.", "fr")]
    assert SP.voice_for("fr")[0] == "edge" and {SP.voice_for(lang)[0] for lang in ("en", "hi", "kn")} == {"sarvam"}


def test_speech_cap_per_session_and_voice_failure(api, monkeypatch):
    s = open_session(api).json()
    mid = said(api, s)
    api.settings["demo_guide.speech_chars_per_session"] = 25
    assert api.client.get(speech_url(s, mid, 0)).status_code == 200                   # 20 characters
    r = api.client.get(speech_url(s, mid, 1))                                         # 16 more: over 25
    assert r.status_code == 429 and code(r) == "capped" and len(api.spoken) == 1
    api.settings["demo_guide.speech_chars_per_session"] = 12000

    async def silent(text, lang):
        return b"", "audio/wav", "sarvam"

    monkeypatch.setattr(SP, "tts", silent)
    r = api.client.get(speech_url(s, mid, 1))
    assert r.status_code == 502 and code(r) == "speech_unavailable"


# ── narration ─────────────────────────────────────────────────────────────

def test_narration_speaks_the_catalogue_line_and_is_publicly_cacheable(api):
    r = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0?lang=hi")       # no Origin, no token
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=86400"
    assert r.content == "AUDIO[hi]हर बकाया फ़ीस यहाँ दिखती है।".encode()
    etag = r.headers["etag"]
    assert etag == '"' + SP.etag_for("हर बकाया फ़ीस यहाँ दिखती है।", "hi") + '"'
    # cached by (text, lang): asked again, nothing is synthesised
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/0?lang=hi").content == r.content
    assert len(api.spoken) == 1
    r304 = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0?lang=hi", headers={"If-None-Match": etag})
    assert r304.status_code == 304 and r304.content == b"" and r304.headers["etag"] == etag
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/0?lang=hi&text=evil").content == r.content


def test_narration_falls_back_to_the_english_line_in_the_english_voice(api):
    r = api.client.get(f"{BASE}/narration/vacademy/fee-collection/1?lang=kn")       # this step has no Kannada
    assert r.status_code == 200 and r.content == b"AUDIO[en]One click sends a reminder."
    assert api.spoken == [("One click sends a reminder.", "en")]
    assert r.headers["etag"] == '"' + SP.etag_for("One click sends a reminder.", "en") + '"'
    english = api.client.get(f"{BASE}/narration/vacademy/fee-collection/1")         # no lang = en: the same audio
    assert english.content == r.content and english.headers["etag"] == r.headers["etag"] and len(api.spoken) == 1
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/1?lang=xx").content == r.content
    fr = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0?lang=fr")      # no French either
    assert fr.content == b"AUDIO[en]Every due fee is listed here." and fr.headers["content-type"] == "audio/wav"


@pytest.mark.parametrize("path", ["vacademy/no-such-tour/0", "vacademy/fee-collection/7", "vacademy/fee-collection/2",
                                  "vacademy/fee-collection/-1"])
def test_narration_unknown_tour_or_step_is_404(api, path):
    r = api.client.get(f"{BASE}/narration/{path}")
    assert r.status_code == 404 and code(r) == "not_found" and api.spoken == []


def test_narration_unknown_product_bad_step_disabled_and_ip_cap(api, monkeypatch):
    r = api.client.get(f"{BASE}/narration/nope/fee-collection/0")
    assert r.status_code == 404 and code(r) == "unknown_product"
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/first").status_code == 422
    monkeypatch.setattr(S, "NARRATIONS_PER_IP_PER_DAY", 2)
    caps.reset_narration()
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/0").status_code == 200
    assert api.client.get(f"{BASE}/narration/vacademy/fee-collection/0").status_code == 200
    r = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0")
    assert r.status_code == 429 and code(r) == "capped"
    api.settings["demo_guide.enabled"] = False
    r = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0")
    assert r.status_code == 503 and code(r) == "disabled"


def test_narration_cap_default_is_600_a_day_per_ip():
    caps.reset_narration()
    assert S.NARRATIONS_PER_IP_PER_DAY == 600
    assert all(caps.take_narration("ip-a") for _ in range(600)) and not caps.take_narration("ip-a")
    assert caps.take_narration("ip-b")
    caps.reset_narration()


# ── microphone ────────────────────────────────────────────────────────────

class FakeSTT:
    def __init__(self, monkeypatch, transcript="we run a school", seconds=4.2):
        from app.services import speech_to_text as stt
        self.calls = []

        async def transcribe_audio(audio, mime, *, language="auto", max_seconds=None, min_speech_wav_bytes=0,
                                   require_decoded=False, stt=None):
            self.calls.append({"bytes": len(audio), "mime": mime, "language": language, "max_seconds": max_seconds,
                               "require_decoded": require_decoded})
            if audio.startswith(b"LONG"):
                raise stt_mod.SpeechTooLongError(75.0, max_seconds)
            if audio.startswith(b"JUNK"):
                raise stt_mod.UndecodableAudioError("not decoded")
            return stt_mod.SpeechToTextResult(transcript, "en-IN", seconds, len(audio), "transcoded", True)

        stt_mod = stt
        monkeypatch.setattr(stt, "transcribe_audio", transcribe_audio)


def post_audio(api, s, data=b"RIFFaudio", mime="audio/webm", headers=None):
    return api.client.post(f"{BASE}/sessions/{s['session_id']}/listen", files={"audio": ("clip.webm", data, mime)},
                           headers=headers or bearer(s))


def test_listen_transcribes_in_the_session_language(api, monkeypatch):
    fake = FakeSTT(monkeypatch)
    s = open_session(api, lang="kn").json()
    r = post_audio(api, s)
    assert r.status_code == 200 and r.json() == {"text": "we run a school", "lang": "kn"}
    assert fake.calls == [{"bytes": 9, "mime": "audio/webm", "language": "kn-IN", "max_seconds": 60.0,
                           "require_decoded": True}]
    assert api.store.sessions[s["session_id"]]["listen_seconds"] == 5
    assert [u for k, u in api.usage if k == "listen"][0]["institute_id"] == LEAD_INST


def test_listen_refuses_french(api, monkeypatch):
    fake = FakeSTT(monkeypatch)
    s = open_session(api, lang="fr").json()
    r = post_audio(api, s)
    assert r.status_code == 422 and code(r) == "language_not_supported" and fake.calls == []
    assert api.store.sessions[s["session_id"]]["listen_seconds"] == 0


def test_listen_limits_size_length_type_and_seconds_per_session(api, monkeypatch):
    fake = FakeSTT(monkeypatch)
    s = open_session(api).json()
    r = post_audio(api, s, data=b"x" * (3 * 1024 * 1024 + 1))
    assert r.status_code == 413 and code(r) == "too_large"
    r = post_audio(api, s, data=b"LONG clip")
    assert r.status_code == 413 and code(r) == "too_long"
    r = post_audio(api, s, data=b"JUNK")
    assert r.status_code == 422 and code(r) == "invalid"
    assert post_audio(api, s, mime="application/pdf").status_code == 415
    assert post_audio(api, s, data=b"").status_code == 400
    r = api.client.post(f"{BASE}/sessions/{s['session_id']}/listen", headers=bearer(s))               # no form at all
    assert r.status_code == 400 and code(r) == "invalid"
    r = api.client.post(f"{BASE}/sessions/{s['session_id']}/listen", data={"audio": "text"}, headers=bearer(s))
    assert r.status_code == 400 and code(r) == "invalid"
    # a declared size over the limit is refused before the body is read
    r = api.client.post(f"{BASE}/sessions/{s['session_id']}/listen", content=b"x",
                        headers={**bearer(s), "Content-Type": "multipart/form-data; boundary=x",
                                 "Content-Length": str(50 * 1024 * 1024)})
    assert r.status_code == 413 and code(r) == "too_large"
    assert post_audio(api, s, headers={"Authorization": "Bearer junk", **ORIGIN}).status_code == 401
    assert post_audio(api, s, headers={"Authorization": f"Bearer {s['token']}", **EVIL}).status_code == 403
    # the session's remaining seconds bound the clip, then the microphone is capped
    api.store.sessions[s["session_id"]]["listen_seconds"] = 590
    fake.calls.clear()
    assert post_audio(api, s).status_code == 200 and fake.calls[0]["max_seconds"] == 10.0
    api.store.sessions[s["session_id"]]["listen_seconds"] = 600
    r = post_audio(api, s)
    assert r.status_code == 429 and code(r) == "capped"


# ── contact ───────────────────────────────────────────────────────────────

GOOD_CONTACT = {"name": "  Asha   Rao ", "phone": "+91 98765 43210", "email": "Asha@Example.com",
                "organisation": "Asha Classes", "consent": True}


def post_contact(api, s, body, headers=None):
    return api.client.post(f"{BASE}/sessions/{s['session_id']}/contact", json=body, headers=headers or bearer(s))


@pytest.mark.parametrize("patch", [
    {"consent": False}, {"consent": "yes"}, {"consent": None}, {"name": ""}, {"name": " A "}, {"name": 12},
    {"phone": None, "email": None}, {"phone": "", "email": "  "}, {"phone": "12345"}, {"phone": "9" * 16},
    {"email": "not-an-email"}, {"email": "a@b"}, {"phone": "call me maybe"},
])
def test_contact_validation(api, patch):
    s = open_session(api).json()
    r = post_contact(api, s, {**GOOD_CONTACT, **patch})
    assert r.status_code == 400 and code(r) == "invalid", r.text
    assert api.leads == [] and api.store.sessions[s["session_id"]]["lead_id"] is None


def test_contact_accepts_a_phone_or_an_email_alone(api):
    s = open_session(api).json()
    assert post_contact(api, s, {"name": "Asha", "phone": "98765 43210", "consent": True}).json() == {"ok": True}
    s2 = open_session(api, visitor_id="v_visitor0002").json()
    assert post_contact(api, s2, {"name": "Ravi", "email": "ravi@example.com", "consent": True}).json() == {"ok": True}
    assert [(lead["phone"], lead["email"]) for lead in api.leads] == [("9876543210", None), (None, "ravi@example.com")]


def test_contact_creates_the_lead_in_the_products_list_with_a_summary(api):
    s = open_session(api).json()
    turn(api, s, {"kind": "text", "text": "We are a coaching academy. What does it cost for 500 learners?"},
         llm=ScriptedLLM([[tool_call("note_visitor", {"fields": {"audience": "academy", "learner_count": "500",
                                                                 "timeline": "next month"}}, "c1"),
                           tool_call("play_tour", {"tour_id": "fee-collection"}, "c2"),
                           tool_call("ask_contact", {"reason": "pricing for 500 learners"}, "c3")],
                          tokens("Let me show you fee collection.")]))
    turn(api, s, {"kind": "tour_end", "tour_id": "fee-collection", "finished": True},
         llm=ScriptedLLM([tokens("What would you like to see next?")]))
    r = post_contact(api, s, {**GOOD_CONTACT, "institute_id": "inst-evil", "audience_id": "aud-evil",
                              "source_type": "SOMETHING"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    (lead,) = api.leads
    assert lead["institute_id"] == LEAD_INST and lead["campaign_id"] == AUDIENCE and lead["kind"] == "SALES"
    assert lead["full_name"] == "Asha Rao" and lead["phone"] == "+919876543210" and lead["email"] == "asha@example.com"
    assert lead["custom_fields"] == {"conversation_id": s["session_id"], "demo_product": "vacademy",
                                     "organisation": "Asha Classes"}
    assert lead["utm"] == {"utm_source": "google", "utm_campaign": "didac"}
    assert lead["page_url"].startswith("https://demo.vacademy.io/") and lead["reason"] == "pricing for 500 learners"
    summary = lead["summary"]
    for needle in ("Audience: academy", "Organisation: Asha Classes", "What does it cost for 500 learners?",
                   "Tours watched: Fee collection", "learner count: 500", "timeline: next month",
                   "Page: https://demo.vacademy.io/", "utm_source=google"):
        assert needle in summary, needle
    assert len(summary) <= 2000 and "98765" not in summary and "asha@example.com" not in summary
    assert api.store.sessions[s["session_id"]]["lead_id"] == "lead-1"
    # sending the form again does not create a second lead
    assert post_contact(api, s, GOOD_CONTACT).json() == {"ok": True} and len(api.leads) == 1
    assert ac.LEADS_PATH == "/admin-core-service/internal/demo-guide/v1/leads"


def test_contact_goes_to_the_internal_hmac_route(api, monkeypatch):
    seen = {}

    async def request(method, path, *, params=None, body=None, internal=True, timeout=15.0):
        seen.update(method=method, path=path, internal=internal, body=body)
        return 201, {"status": "received", "lead_ref": "resp-9"}

    monkeypatch.setattr(ac, "submit_lead", REAL_SUBMIT_LEAD)          # the real client, over a recorded request
    monkeypatch.setattr(ac, "_request", request)
    s = open_session(api).json()
    assert post_contact(api, s, GOOD_CONTACT).json() == {"ok": True}
    assert seen["method"] == "POST" and seen["path"] == "/admin-core-service/internal/demo-guide/v1/leads"
    assert seen["internal"] is True and seen["body"]["institute_id"] == LEAD_INST
    assert api.store.sessions[s["session_id"]]["lead_id"] == "resp-9"

    async def refused(method, path, **kw):
        return 400, {"error": {"code": "invalid_request"}}

    monkeypatch.setattr(ac, "_request", refused)
    s2 = open_session(api, visitor_id="v_visitor0002").json()
    assert post_contact(api, s2, GOOD_CONTACT).status_code == 502


def test_contact_three_per_ip_per_day_and_admin_core_down(api, monkeypatch):
    for i in range(3):
        s = open_session(api, visitor_id=f"v_visitor000{i}").json()
        assert post_contact(api, s, GOOD_CONTACT).status_code == 200
    s = open_session(api, visitor_id="v_visitor0009").json()
    r = post_contact(api, s, GOOD_CONTACT)
    assert r.status_code == 429 and code(r) == "capped" and len(api.leads) == 3

    for row in api.store.sessions.values():
        row["lead_id"] = None

    async def down(body):
        raise ac.AdminCoreUnavailable("leads: HTTP 503")

    monkeypatch.setattr(ac, "submit_lead", down)
    r = post_contact(api, s, GOOD_CONTACT)
    assert r.status_code == 502 and api.store.sessions[s["session_id"]]["lead_id"] is None


def test_contact_needs_token_origin_and_the_switch(api):
    s = open_session(api).json()
    assert post_contact(api, s, GOOD_CONTACT, headers=ORIGIN).status_code == 401
    assert post_contact(api, s, GOOD_CONTACT, headers={"Authorization": f"Bearer {s['token']}", **EVIL}).status_code == 403
    api.settings["demo_guide.enabled"] = False
    assert post_contact(api, s, GOOD_CONTACT).status_code == 503
    assert api.leads == []


# ── staff ─────────────────────────────────────────────────────────────────

def test_staff_list_and_transcript_for_the_lead_institutes_admin_only(api):
    s = open_session(api).json()
    turn(api, s, {"kind": "start"}, llm=ScriptedLLM([[tool_call("play_tour", {"tour_id": "tests"})],
                                                     tokens("Hi, I'm an AI guide. Here are tests.")]))
    post_contact(api, s, GOOD_CONTACT)
    open_session(api, visitor_id="v_visitor0002")                    # opened, never used: not listed
    admin = {"Authorization": "Bearer admin", "clientId": LEAD_INST}
    r = api.client.get(f"{BASE}/admin/sessions", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1 and body["page"] == 0 and body["size"] == 20
    (item,) = body["items"]
    assert item["id"] == s["session_id"] and item["turns"] == 1 and item["lead"] is True
    assert item["tours"] == [{"id": "tests", "finished": None}] and "ip_hash" not in item and "visitor_id" not in item
    assert api.client.get(f"{BASE}/admin/sessions?lead=false", headers=admin).json()["total"] == 0

    r = api.client.get(f"{BASE}/admin/sessions/{s['session_id']}", headers=admin)
    assert r.status_code == 200
    t = r.json()["transcript"]
    assert [(m["role"], m["kind"]) for m in t] == [("user", "start"), ("assistant", "reply")]
    assert t[1]["text"] == "Hi, I'm an AI guide. Here are tests." and t[1]["actions"]["tour"] == "tests"
    assert api.client.get(f"{BASE}/admin/sessions/nope", headers=admin).status_code == 404

    for headers in ({}, {"Authorization": "Bearer teacher", "clientId": LEAD_INST},       # not an admin
                    {"Authorization": "Bearer admin", "clientId": "inst-other"},          # another institute's admin
                    {"Authorization": "Bearer admin", "clientId": APP_INST}):             # the demo institute itself
        assert api.client.get(f"{BASE}/admin/sessions", headers=headers).status_code in (401, 403), headers
        assert api.client.get(f"{BASE}/admin/sessions/{s['session_id']}", headers=headers).status_code in (401, 403)


# ── CORS: only the stage origins, only on these routes ────────────────────

def test_cors_headers_only_for_stage_origins_on_demo_guide_routes(api):
    ok = open_session(api)
    assert ok.headers["access-control-allow-origin"] == STAGE
    bad = open_session(api, headers=EVIL)
    assert bad.status_code == 403 and "access-control-allow-origin" not in bad.headers
    # the public narration audio is readable cross-origin only by the stage
    n = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0", headers=EVIL)
    assert n.status_code == 200 and "access-control-allow-origin" not in n.headers
    n = api.client.get(f"{BASE}/narration/vacademy/fee-collection/0", headers=ORIGIN)
    assert n.headers["access-control-allow-origin"] == STAGE

    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
    r = api.client.options(f"{BASE}/sessions", headers={**ORIGIN, **preflight})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == STAGE
    r = api.client.options(f"{BASE}/sessions", headers={**EVIL, **preflight})
    assert r.status_code == 403 and "access-control-allow-origin" not in r.headers


def test_other_routes_keep_the_app_wide_cors(api):
    r = api.client.get("/ai-service/other", headers=EVIL)
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "https://evil.example"
    r = api.client.options("/ai-service/other", headers={**EVIL, "Access-Control-Request-Method": "GET"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "https://evil.example"


def test_real_app_mounts_the_router_and_the_cors_middleware():
    import inspect

    from app import app_factory
    src = inspect.getsource(app_factory)
    assert "app.include_router(demo_guide_router, prefix=settings.api_base_path)" in src
    assert "app.add_middleware(DemoGuideCorsMiddleware)" in src
    assert src.index("allow_origin_regex") < src.index("add_middleware(DemoGuideCorsMiddleware)")   # outside CORS
    paths = {r.path for r in router.routes}
    assert paths == {"/demo-guide/v1/sessions", "/demo-guide/v1/sessions/{session_id}/turns",
                     "/demo-guide/v1/sessions/{session_id}/speech/{message_id}/{n}",
                     "/demo-guide/v1/narration/{product}/{tour_id}/{step}",
                     "/demo-guide/v1/sessions/{session_id}/listen", "/demo-guide/v1/sessions/{session_id}/contact",
                     "/demo-guide/v1/admin/sessions", "/demo-guide/v1/admin/sessions/{session_id}"}
