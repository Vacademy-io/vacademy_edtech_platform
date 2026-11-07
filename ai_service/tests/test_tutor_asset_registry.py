"""Asset registry: visibility, runtime validation and the one-time fee."""
import pytest

from app.services.tutor import asset_registry as reg


class _DB:
    """Minimal stand-in: `rows` answers every SELECT; records executed SQL."""
    def __init__(self, rows=None):
        self.rows = rows or []
        self.sql = []
        self.committed = 0

    def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))
        rows = self.rows
        class R:
            def first(_): return rows[0] if rows else None
            def fetchall(_): return list(rows)
            rowcount = len(rows)
        return R()

    def commit(self): self.committed += 1


def test_avatar_allowed_needs_a_ready_visible_row():
    assert reg.avatar_allowed(_DB([(1,)]), institute_id="A", provider="spatius", avatar_id="x")
    db = _DB([])
    assert not reg.avatar_allowed(db, institute_id="A", provider="spatius", avatar_id="x")
    sql, params = db.sql[0]
    assert "institute_id IS NULL OR institute_id = :inst" in sql and params["inst"] == "A"


def test_voice_blocked_only_for_other_institutes():
    assert not reg.voice_blocked(_DB([]), institute_id="A", provider="smallest", voice_id="v")   # unregistered stock
    assert not reg.voice_blocked(_DB([(None, "ready")]), institute_id="A", provider="smallest", voice_id="v")  # stock row
    assert not reg.voice_blocked(_DB([("A", "ready")]), institute_id="A", provider="smallest", voice_id="v")   # own
    assert reg.voice_blocked(_DB([("B", "ready")]), institute_id="A", provider="smallest", voice_id="v")       # someone else's
    assert reg.voice_blocked(_DB([("A", "disabled")]), institute_id="A", provider="smallest", voice_id="v")    # own but disabled


def test_settings_drop_foreign_assets(monkeypatch):
    from app.services.tutor.runtime import settings as st
    monkeypatch.setattr(reg, "avatar_allowed", lambda db, **k: False)
    monkeypatch.setattr(reg, "voice_blocked", lambda db, **k: k["voice_id"] == "stolen")
    s = st.TutorSettings(avatar_provider="spatius", avatar_id="e066", tts_provider="smallest", tts_voice="stolen")
    st._enforce_registry(_DB(), s, "A")
    assert s.avatar_provider == "none" and s.avatar_id is None and s.tts_voice is None
    monkeypatch.setattr(reg, "avatar_allowed", lambda db, **k: True)
    s = st.TutorSettings(avatar_provider="spatius", avatar_id="e066", tts_provider="smallest", tts_voice="mine")
    st._enforce_registry(_DB(), s, "A")
    assert s.avatar_id == "e066" and s.tts_voice == "mine"


def test_one_time_charge_is_per_asset_and_institute_only(monkeypatch):
    from decimal import Decimal
    calls = []
    import app.services.ai_billing as billing
    monkeypatch.setattr(billing, "charge_tool", lambda db, **k: calls.append(k) or Decimal("200"))
    stock = {"id": "s1", "kind": "voice", "institute_id": None, "credits_charged": 0}
    assert reg.charge_one_time(_DB(), asset=stock, tool_key=reg.VOICE_CLONE_TOOL, model="m", user_id="u") == 0
    paid = {"id": "s2", "kind": "voice", "institute_id": "A", "credits_charged": 200}
    assert reg.charge_one_time(_DB(), asset=paid, tool_key=reg.VOICE_CLONE_TOOL, model="m", user_id="u") == 0
    fresh = {"id": "s3", "kind": "avatar", "institute_id": "A", "credits_charged": 0, "requested_by": "r"}
    db = _DB()
    assert reg.charge_one_time(db, asset=fresh, tool_key=reg.AVATAR_CREATE_TOOL, model="spatius-avatar", user_id=None) == Decimal("200")
    assert calls[-1]["idempotency_key"] == "tutor_asset:s3" and calls[-1]["user_id"] == "r" and calls[-1]["institute_id"] == "A"
    assert db.committed == 1


def test_pricing_defaults_present():
    from app.services.tool_cost_estimator import DEFAULT_TOOL_PRICING
    assert DEFAULT_TOOL_PRICING["tutor_voice_clone"]["flat_base_credits"] == 200
    assert DEFAULT_TOOL_PRICING["tutor_avatar_create"]["flat_base_credits"] == 1000
