"""
Reading one key out of institutes.setting_json.

The envelope admin_core_service writes nests the key under "setting" and wraps
the payload in {key, name, data}. A reader that looks at the top level instead
silently returns nothing for every setting an institute ever saved, so these
tests pin both shapes.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.institute_setting_reader import load_institute_setting_data  # noqa: E402

KEY = "MCP_SERVER_SETTING"
PAYLOAD = {"enabled": True, "allowed_roles": ["ADMIN"]}


class FakeResult:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class FakeSession:
    """Minimal stand-in for a SQLAlchemy Session: one SELECT, one row."""

    def __init__(self, row, raises=False):
        self._row = row
        self._raises = raises

    def execute(self, *_args, **_kwargs):
        if self._raises:
            raise RuntimeError("connection reset")
        return FakeResult(self._row)


def session_with(blob):
    raw = blob if isinstance(blob, str) or blob is None else json.dumps(blob)
    return FakeSession((raw,) if raw is not None else (None,))


def test_reads_the_envelope_admin_core_writes():
    db = session_with(
        {
            "institute_id": "inst-1",
            "setting": {KEY: {"key": KEY, "name": "MCP Server", "data": PAYLOAD}},
        }
    )
    assert load_institute_setting_data(db, "inst-1", KEY) == PAYLOAD


def test_reads_a_top_level_key_as_a_fallback():
    db = session_with({KEY: {"key": KEY, "data": PAYLOAD}})
    assert load_institute_setting_data(db, "inst-1", KEY) == PAYLOAD


def test_reads_an_unwrapped_payload():
    db = session_with({"setting": {KEY: PAYLOAD}})
    assert load_institute_setting_data(db, "inst-1", KEY) == PAYLOAD


def test_prefers_the_canonical_location_over_the_legacy_one():
    canonical = {"enabled": True}
    legacy = {"enabled": False}
    db = session_with({"setting": {KEY: {"data": canonical}}, KEY: {"data": legacy}})
    assert load_institute_setting_data(db, "inst-1", KEY) == canonical


def test_missing_key_returns_none():
    db = session_with({"setting": {"OTHER_SETTING": {"data": {"x": 1}}}})
    assert load_institute_setting_data(db, "inst-1", KEY) is None


def test_null_column_returns_none():
    assert load_institute_setting_data(session_with(None), "inst-1", KEY) is None


def test_missing_institute_returns_none():
    assert load_institute_setting_data(FakeSession(None), "inst-1", KEY) is None


def test_invalid_json_returns_none_rather_than_raising():
    assert load_institute_setting_data(session_with("{not json"), "inst-1", KEY) is None


def test_db_error_returns_none_rather_than_raising():
    """A settings read that fails must never grant a capability."""
    assert load_institute_setting_data(FakeSession(None, raises=True), "inst-1", KEY) is None


def test_blank_arguments_short_circuit():
    assert load_institute_setting_data(session_with({}), "", KEY) is None
    assert load_institute_setting_data(session_with({}), "inst-1", "") is None
