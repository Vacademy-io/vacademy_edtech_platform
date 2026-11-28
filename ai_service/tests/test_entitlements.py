"""
Module entitlements (app/services/entitlements.py): a mirror of admin-core's
CapabilityResolver. These tests pin its rules (LEGACY vs MANAGED, core
modules, default_on, expiry, unknown keys, fail-open on a read error) and
check the Python catalogue copy against
admin_core_service/src/main/resources/capabilities/catalog.json, so a new
module or a changed default fails here first.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.services import entitlements as ent  # noqa: E402

CATALOG_JSON = (Path(__file__).resolve().parents[2] / "admin_core_service" / "src" / "main" / "resources"
                / "capabilities" / "catalog.json")


class Db:
    """Answers the policy query with ``mode`` and the rows query with ``rows`` (key, enabled, expires_at)."""

    def __init__(self, mode=None, rows=(), fail=False):
        self.mode, self.rows, self.fail = mode, list(rows), fail
        self.rollbacks = 0
        self.queries = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.queries.append((sql, params))
        if self.fail:
            raise RuntimeError("relation does not exist")
        if "institute_module_policy" in sql:
            return SimpleNamespace(first=lambda: (self.mode,) if self.mode is not None else None)
        return SimpleNamespace(fetchall=lambda: list(self.rows))

    def rollback(self):
        self.rollbacks += 1


def future(days=30):
    return datetime.now(timezone.utc) + timedelta(days=days)


# ── drift against the Java catalogue ─────────────────────────────────────

def test_catalog_mirror_matches_catalog_json():
    data = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
    java = {m["key"]: (bool(m.get("core", False)), {f["key"]: bool(f["default_on"]) for f in m["features"]})
            for m in data["modules"]}
    assert ent.CATALOG == java, "entitlements.CATALOG drifted from capabilities/catalog.json — copy it over"


def test_derived_maps_are_consistent():
    assert ent.CORE_MODULES == {"core"}
    assert ent.MODULE_OF["crm.leads"] == "crm" and ent.MODULE_OF["communications.whatsapp"] == "communications"
    assert ent.CATALOG_DEFAULT_ON["crm.live_activity"] is False
    assert ent.CATALOG_KEYS == set(ent.CATALOG) | set(ent.MODULE_OF)


# ── LEGACY ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mode", [None, "LEGACY", "legacy", "SOMETHING_ELSE", ""])
def test_anything_but_managed_is_legacy_everything_known_on(mode):
    e = ent.entitlements(Db(mode=mode), "inst-1")
    assert e.mode == ent.MODE_LEGACY and not e.managed
    assert e.on("crm") and e.on("crm.leads") and e.on("crm.live_activity")   # default_on=false is still on
    assert e.on("communications.whatsapp") and e.on("core.dashboard")


def test_unknown_key_is_off_even_in_legacy():
    e = ent.entitlements(Db(mode="LEGACY"), "inst-1")
    assert e.on("crm.unknown_feature") is False
    assert e.on("") is False and e.on(None) is False


def test_no_db_or_no_institute_is_legacy():
    assert ent.entitlements(None, "inst-1").on("crm.calling")
    assert ent.entitlements(Db(mode="MANAGED"), "").on("crm.calling")


def test_legacy_reads_no_rows():
    db = Db(mode="LEGACY", rows=[("crm", False, None)])
    ent.entitlements(db, "inst-1")
    assert len(db.queries) == 1


# ── MANAGED ──────────────────────────────────────────────────────────────

def test_managed_module_needs_a_row():
    e = ent.entitlements(Db(mode="MANAGED", rows=[]), "inst-1")
    assert e.managed
    assert not e.on("crm") and not e.on("crm.leads")          # no module row = module off
    assert e.on("core") and e.on("core.dashboard")             # core is always on


def test_managed_feature_defaults_when_no_feature_row():
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", True, None)]), "inst-1")
    assert e.on("crm") and e.on("crm.leads") and e.on("crm.ai_calling")
    assert e.on("crm.live_activity") is False                  # catalogue default_on=false
    assert e.on("communications.whatsapp") is False            # its module has no row


def test_managed_feature_row_overrides_default():
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", True, None), ("crm.ai_calling", False, None),
                                                  ("crm.live_activity", True, None)]), "inst-1")
    assert e.on("crm.ai_calling") is False
    assert e.on("crm.live_activity") is True


def test_feature_row_cannot_turn_on_a_feature_of_an_off_module():
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", False, None), ("crm.leads", True, None)]), "inst-1")
    assert e.on("crm.leads") is False


def test_expiry():
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", True, past), ("communications", True, future()),
                                                  ("automation", True, past.replace(tzinfo=None))]), "inst-1")
    assert e.on("crm") is False and e.on("crm.leads") is False
    assert e.on("communications") and e.on("communications.email")
    assert e.on("automation") is False                         # naive timestamps are UTC


def test_disabled_row_is_off_whatever_the_expiry():
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", False, future())]), "inst-1")
    assert e.on("crm") is False


def test_all_on_and_any_on():
    e = ent.entitlements(Db(mode="MANAGED", rows=[("crm", True, None), ("crm.calling", False, None)]), "inst-1")
    assert e.all_on("crm.leads", "crm.admissions") and not e.all_on("crm.leads", "crm.calling")
    assert e.any_on("crm.calling", "crm.leads") and not e.any_on("crm.calling", "communications.email")


# ── failure ──────────────────────────────────────────────────────────────

def test_read_error_rolls_back_and_is_legacy():
    db = Db(fail=True)
    e = ent.entitlements(db, "inst-1")
    assert e.mode == ent.MODE_LEGACY and e.on("crm.leads")
    assert db.rollbacks == 1


def test_queries_bind_the_institute():
    db = Db(mode="MANAGED", rows=[])
    ent.entitlements(db, "inst-9")
    assert all(p == {"inst": "inst-9"} for _, p in db.queries)
    assert all("WHERE institute_id = :inst" in sql for sql, _ in db.queries)
