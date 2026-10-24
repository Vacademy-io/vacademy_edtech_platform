"""
mcp_design_import_part is created twice: by the admin_core Flyway migration
(the source of truth, V561) and by ai_service at startup
(app/models/design_import.py) for standalone local runs. These tests fail when
the two drift apart: column names, types, nullability, and index names and
columns must match.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import DateTime, Integer, String, Text  # noqa: E402

from app.models.design_import import DesignImportPart  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"


def _migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("V*__mcp_design_import_part.sql"))
    assert len(files) == 1, f"expected exactly one mcp_design_import_part migration, found {files}"
    # Drop comments so they cannot be mistaken for columns.
    return re.sub(r"--[^\n]*", "", files[0].read_text(encoding="utf-8"))


def _sql_columns(sql: str) -> dict:
    body = re.search(r"CREATE TABLE IF NOT EXISTS mcp_design_import_part \((.*?)\n\);", sql, re.S)
    assert body, "CREATE TABLE IF NOT EXISTS mcp_design_import_part not found"
    cols = {}
    for line in body.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line:
            continue
        name, sql_type, *rest = line.split()
        rest = " ".join(rest).upper()
        cols[name] = {"type": sql_type.upper(), "not_null": "NOT NULL" in rest or "PRIMARY KEY" in rest,
                      "pk": "PRIMARY KEY" in rest}
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
    sql_cols = _sql_columns(_migration_sql())
    table = DesignImportPart.__table__
    assert list(sql_cols) == [c.name for c in table.columns]
    for col in table.columns:
        got = sql_cols[col.name]
        assert got["type"] == _model_type(col), col.name
        assert got["not_null"] == (not col.nullable), col.name
        assert got["pk"] == col.primary_key, col.name


def test_indexes_match_the_model():
    sql = _migration_sql()
    found = {m.group(1): [c.strip() for c in m.group(2).split(",")]
             for m in re.finditer(r"CREATE INDEX IF NOT EXISTS (\w+)\s+ON mcp_design_import_part \(([^)]*)\)", sql)}
    expected = {ix.name: [c.name for c in ix.columns] for ix in DesignImportPart.__table__.indexes}
    assert found == expected


def test_migration_is_idempotent_and_survives_a_foreign_owner():
    sql = _migration_sql()
    assert "CREATE TABLE IF NOT EXISTS" in sql
    # Every statement against the table besides CREATE TABLE sits in the guarded DO block,
    # so a table ai_service created first (owned by its role) cannot fail the deploy.
    do_block = re.search(r"DO \$\$(.*?)\$\$;", sql, re.S)
    assert do_block and "WHEN insufficient_privilege" in do_block.group(1)
    outside = sql.replace(do_block.group(0), "")
    assert "CREATE INDEX" not in outside and "COMMENT ON" not in outside
    assert not re.search(r"\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b", sql, re.I)
