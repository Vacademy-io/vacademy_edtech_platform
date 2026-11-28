"""
mcp_crm_confirm is created ONLY by the admin_core Flyway migration V583;
ai_service runs no DDL for it and only checks it exists at startup. These tests
fail when the SQLAlchemy model drifts from the migration, or when ai_service
starts creating the table itself.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from sqlalchemy import DateTime, Integer, String, Text, create_engine, inspect  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.crm_confirm import CrmConfirm, check_crm_confirm_schema  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"
AI_APP = REPO / "ai_service" / "app"
MIGRATION_NAME = "V583__mcp_crm_confirm.sql"


def _migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("V*__mcp_crm_confirm.sql"))
    assert [f.name for f in files] == [MIGRATION_NAME], f"expected exactly one V583 migration, found {files}"
    return re.sub(r"--[^\n]*", "", files[0].read_text(encoding="utf-8"))


def _sql_columns(sql: str, table: str) -> dict:
    body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", sql, re.S)
    assert body, f"CREATE TABLE IF NOT EXISTS {table} not found"
    cols = {}
    for line in body.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line:
            continue
        name, sql_type, *rest = line.split()
        rest = " ".join(rest).upper()
        cols[name] = {"type": sql_type.upper(), "not_null": "NOT NULL" in rest or "PRIMARY KEY" in rest,
                      "pk": "PRIMARY KEY" in rest, "default_now": "DEFAULT NOW()" in rest}
    return cols


def _model_type(col) -> str:
    t = col.type
    if isinstance(t, String) and not isinstance(t, Text):
        return f"VARCHAR({t.length})"
    if isinstance(t, Text):
        return "TEXT"
    if isinstance(t, Integer):
        return "INTEGER"
    if isinstance(t, DateTime):
        return "TIMESTAMPTZ" if t.timezone else "TIMESTAMP"
    raise AssertionError(f"unmapped type {t!r} on {col.name}")


def test_columns_match_the_model():
    table = CrmConfirm.__table__
    assert table.name == "mcp_crm_confirm"
    sql_cols = _sql_columns(_migration_sql(), table.name)
    assert list(sql_cols) == [c.name for c in table.columns]
    for col in table.columns:
        got = sql_cols[col.name]
        assert got["type"] == _model_type(col), col.name
        assert got["not_null"] == (not col.nullable), col.name
        assert got["pk"] == col.primary_key, col.name


def test_columns_are_the_shared_contract():
    """The token helpers in services/crm_data.py and the caps rely on exactly these columns."""
    assert _sql_columns(_migration_sql(), "mcp_crm_confirm") == {
        "id": {"type": "VARCHAR(64)", "not_null": True, "pk": True, "default_now": False},
        "institute_id": {"type": "VARCHAR(255)", "not_null": True, "pk": False, "default_now": False},
        "user_id": {"type": "VARCHAR(255)", "not_null": True, "pk": False, "default_now": False},
        "purpose": {"type": "VARCHAR(64)", "not_null": True, "pk": False, "default_now": False},
        "request_sha256": {"type": "VARCHAR(64)", "not_null": True, "pk": False, "default_now": False},
        # TEXT, not JSONB: the token tests run the model on sqlite.
        "summary_json": {"type": "TEXT", "not_null": False, "pk": False, "default_now": False},
        "created_at": {"type": "TIMESTAMPTZ", "not_null": True, "pk": False, "default_now": True},
        "expires_at": {"type": "TIMESTAMPTZ", "not_null": True, "pk": False, "default_now": False},
        "spent_at": {"type": "TIMESTAMPTZ", "not_null": False, "pk": False, "default_now": False},
        "revoked_at": {"type": "TIMESTAMPTZ", "not_null": False, "pk": False, "default_now": False},
        "outcome": {"type": "VARCHAR(16)", "not_null": False, "pk": False, "default_now": False},
    }


def test_indexes_match_the_model():
    table = CrmConfirm.__table__
    found = {m.group(1): [c.strip() for c in m.group(2).split(",")]
             for m in re.finditer(rf"CREATE INDEX IF NOT EXISTS (\w+)\s+ON {table.name} \(([^)]*)\)", _migration_sql())}
    assert found == {
        "idx_mcp_crm_confirm_caps": ["institute_id", "user_id", "purpose", "spent_at"],
        "idx_mcp_crm_confirm_expires": ["expires_at"],
    }
    # A model that declares indexes must declare exactly these; one that declares none is fine (Flyway owns them).
    declared = {ix.name: [c.name for c in ix.columns] for ix in table.indexes}
    assert not declared or declared == found


def test_migration_is_idempotent_and_survives_a_foreign_owner():
    sql = _migration_sql()
    assert sql.count("CREATE TABLE IF NOT EXISTS") == 1
    blocks = re.findall(r"DO \$\$(.*?)\$\$;", sql, re.S)
    assert len(blocks) == 1 and all("WHEN insufficient_privilege" in b for b in blocks)
    outside = re.sub(r"DO \$\$(.*?)\$\$;", "", sql, flags=re.S)
    assert "CREATE INDEX" not in outside and "COMMENT ON" not in outside
    assert not re.search(r"\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE|INSERT)\b", sql, re.I)
    assert "JSONB" not in sql.upper()


def test_flyway_version_is_unique():
    versions = sorted(int(m.group(1)) for f in MIGRATIONS.glob("V*__*.sql")
                      if (m := re.match(r"V(\d+)__", f.name)))
    assert len(versions) == len(set(versions)), "duplicate Flyway version"
    assert versions.count(580) == 1 and (MIGRATIONS / MIGRATION_NAME).exists()


def test_check_never_creates_the_table(caplog):
    db = sessionmaker(bind=create_engine("sqlite://"))()
    with caplog.at_level("ERROR"):
        assert check_crm_confirm_schema(db) is False
    assert not inspect(db.get_bind()).has_table("mcp_crm_confirm")      # no DDL ran
    assert "mcp_crm_confirm" in caplog.text and "Flyway" in caplog.text


def test_check_never_raises_on_a_broken_bind():
    class Broken:
        def get_bind(self):
            raise RuntimeError("db down")
    assert check_crm_confirm_schema(Broken()) is False


def test_check_true_when_flyway_created_it():
    db = sessionmaker(bind=create_engine("sqlite://"))()
    CrmConfirm.__table__.create(bind=db.get_bind())
    assert check_crm_confirm_schema(db) is True


def test_ai_service_runs_no_ddl_for_the_table():
    src = (AI_APP / "models" / "crm_confirm.py").read_text(encoding="utf-8")
    assert ".create(" not in src and "create_all" not in src and "CREATE TABLE" not in src
    assert MIGRATION_NAME in src, "the model must name the migration that owns its table"
    factory = (AI_APP / "app_factory.py").read_text(encoding="utf-8")
    assert "check_crm_confirm_schema(db)" in factory
    assert "ensure_crm_confirm_schema" not in factory


@pytest.mark.parametrize("path", sorted(p.relative_to(AI_APP).as_posix()
                                        for p in (AI_APP / "services").glob("*crm*.py")))
def test_crm_services_run_no_ddl(path):
    src = (AI_APP / path).read_text(encoding="utf-8")
    assert "create_all" not in src and "CREATE TABLE" not in src.upper(), path
