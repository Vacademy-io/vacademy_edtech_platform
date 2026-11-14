"""Shadow auth counters for /chat-agent: which calls and which clients would be
refused once chatbot.text.require_auth is on (app/core/chat_auth.py)."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import chat_auth  # noqa: E402


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(chat_auth, "require_auth_enabled", lambda: False)
    monkeypatch.setattr(chat_auth, "_counts", chat_auth.Counter())
    monkeypatch.setattr(chat_auth, "_by_route", chat_auth.Counter())
    app = FastAPI()

    @app.get("/chat-agent/session/{session_id}/stream")
    def stream(session_id: str, caller: chat_auth.ChatCaller = Depends(chat_auth.get_chat_caller)):
        return {"authenticated": caller.authenticated}

    return TestClient(app)


def test_a_tokenless_call_is_served_and_counted_by_route_template_and_client(monkeypatch):
    client = _client(monkeypatch)
    ua_native = "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Capacitor"
    assert client.get("/chat-agent/session/abc/stream", headers={"User-Agent": ua_native}).json() == {
        "authenticated": False}
    client.get("/chat-agent/session/xyz/stream", headers={"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130"})
    client.get("/chat-agent/session/xyz/stream", headers={"Authorization": "Bearer not-a-jwt"})
    assert chat_auth.shadow_counts() == {"no_token": 2, "invalid_token": 1}
    assert chat_auth.shadow_counts_by_route() == {
        "no_token GET /chat-agent/session/{session_id}/stream native": 1,
        "no_token GET /chat-agent/session/{session_id}/stream browser": 1,
        "invalid_token GET /chat-agent/session/{session_id}/stream other": 1,
    }


def test_client_kind():
    assert chat_auth._client_kind("okhttp/4.9.2") == "native"
    assert chat_auth._client_kind("Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148") == "native"
    assert chat_auth._client_kind("Mozilla/5.0 (iPhone) AppleWebKit Mobile Safari/604.1") == "browser"
    assert chat_auth._client_kind("Mozilla/5.0 (Linux; Android 13) Chrome", "https://localhost") == "native"
    assert chat_auth._client_kind("Mozilla/5.0", "capacitor://localhost") == "native"
    assert chat_auth._client_kind("") == "none"
    assert chat_auth._client_kind("python-requests/2.31") == "other"
