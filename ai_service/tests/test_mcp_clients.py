"""
The institute's primary (auto-provisioned) OAuth client.

Every institute gets one client id without filling in a form. The settings
page shows it as "your client ID", so it must always exist and must never be
deletable — an admin who removed it would be left with nothing to paste.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.mcp.consent import (  # noqa: E402
    _client_response,
    _ensure_auto_client,
    delete_manual_client,
)
from app.mcp.constants import (  # noqa: E402
    AUTO_CLIENT_ID_PREFIX,
    AUTO_CLIENT_NAME,
    AUTO_CLIENT_REDIRECT_URIS,
    is_auto_client,
)


class _FakeRepo:
    def __init__(self, clients=None):
        self.clients = list(clients or [])
        self.saved = []

    def list_manual_clients(self, institute_id):
        return [dict(c) for c in self.clients]

    def save_client(self, **kwargs):
        self.saved.append(kwargs)
        self.clients.append({"client_id": kwargs["client_id"], "client_name": kwargs["client_name"],
                             "redirect_uris": kwargs["redirect_uris"], "created_at": None})

    def delete_manual_client(self, institute_id, client_id):
        before = len(self.clients)
        self.clients = [c for c in self.clients if c["client_id"] != client_id]
        return len(self.clients) < before


def _principal():
    return SimpleNamespace(user_id="u1", institute_id="inst-1", roles=["ADMIN"], is_root_user=False)


def _custom(client_id="vcm-abc"):
    return {"client_id": client_id, "client_name": "My app", "redirect_uris": ["https://x/cb"], "created_at": None}


def _primary(client_id=f"{AUTO_CLIENT_ID_PREFIX}abc"):
    return {"client_id": client_id, "client_name": AUTO_CLIENT_NAME,
            "redirect_uris": list(AUTO_CLIENT_REDIRECT_URIS), "created_at": None}


# ── identification ───────────────────────────────────────────────────────
def test_only_the_auto_prefix_marks_a_primary_client():
    assert is_auto_client(f"{AUTO_CLIENT_ID_PREFIX}deadbeef") is True
    assert is_auto_client("vcm-deadbeef") is False
    assert is_auto_client(None) is False


def test_client_response_flags_the_primary_client():
    assert _client_response(_primary()).is_primary is True
    assert _client_response(_custom()).is_primary is False


# ── provisioning ─────────────────────────────────────────────────────────
def test_primary_client_is_minted_when_missing():
    repo = _FakeRepo()
    _ensure_auto_client(repo, _principal(), db=None)
    assert len(repo.saved) == 1
    saved = repo.saved[0]
    assert saved["client_id"].startswith(AUTO_CLIENT_ID_PREFIX)
    assert saved["client_name"] == AUTO_CLIENT_NAME      # no DB → platform name
    assert saved["institute_id"] == "inst-1"
    assert saved["source"] == "manual"


def test_primary_client_is_named_after_the_institute():
    """White-label: the AI app shows "<client name> wants access"."""
    class _Db:
        def execute(self, stmt, params=None):
            return SimpleNamespace(first=lambda: ("Shiksha Nation",))
    repo = _FakeRepo()
    _ensure_auto_client(repo, _principal(), db=_Db())
    assert repo.saved[0]["client_name"] == "Shiksha Nation"


def test_primary_client_is_minted_even_when_custom_clients_exist():
    # A custom client alone must not count as "the institute already has one".
    repo = _FakeRepo([_custom()])
    _ensure_auto_client(repo, _principal(), db=None)
    assert len(repo.saved) == 1


def test_provisioning_is_idempotent():
    repo = _FakeRepo([_primary()])
    _ensure_auto_client(repo, _principal(), db=None)
    assert repo.saved == []


# ── deletion ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_primary_client_cannot_be_deleted(monkeypatch):
    repo = _FakeRepo([_primary()])
    monkeypatch.setattr("app.mcp.consent._repo", lambda db, settings: repo)

    with pytest.raises(HTTPException) as exc:
        await delete_manual_client(f"{AUTO_CLIENT_ID_PREFIX}abc", _principal(), db=None, settings=None)

    assert exc.value.status_code == 403
    assert exc.value.detail["reason"] == "primary_client"
    assert len(repo.clients) == 1


@pytest.mark.asyncio
async def test_custom_client_can_still_be_deleted(monkeypatch):
    repo = _FakeRepo([_primary(), _custom()])
    monkeypatch.setattr("app.mcp.consent._repo", lambda db, settings: repo)

    result = await delete_manual_client("vcm-abc", _principal(), db=None, settings=None)

    assert result == {"deleted": True}
    assert [c["client_id"] for c in repo.clients] == [f"{AUTO_CLIENT_ID_PREFIX}abc"]
