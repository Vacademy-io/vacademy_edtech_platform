"""
mcp_catalog_data_record and mcp_publish_confirm are created ONLY by the admin_core
Flyway migration V562; ai_service runs no DDL for them (nor for V561's
mcp_design_import_part) and only checks they exist. These tests fail when the
SQLAlchemy models drift from the migration, or when ai_service starts creating
tables again.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from sqlalchemy import DateTime, Integer, String, Text, create_engine, inspect  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.models.catalog_data_edit import CatalogDataRecord, check_catalog_data_schema  # noqa: E402
from app.models.design_import import DesignImportPart, check_design_import_schema  # noqa: E402
from app.models.publish_confirm import PublishConfirm, check_publish_confirm_schema  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"
AI_APP = REPO / "ai_service" / "app"


def _migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("V*__mcp_catalog_data_record_and_publish_confirm.sql"))
    assert len(files) == 1, f"expected exactly one V562 migration, found {files}"
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


@pytest.mark.parametrize("model", [CatalogDataRecord, PublishConfirm])
def test_columns_match_the_model(model):
    table = model.__table__
    sql_cols = _sql_columns(_migration_sql(), table.name)
    assert list(sql_cols) == [c.name for c in table.columns]
    for col in table.columns:
        got = sql_cols[col.name]
        assert got["type"] == _model_type(col), col.name
        assert got["not_null"] == (not col.nullable), col.name
        assert got["pk"] == col.primary_key, col.name


@pytest.mark.parametrize("model", [CatalogDataRecord, PublishConfirm])
def test_indexes_match_the_model(model):
    table = model.__table__
    found = {m.group(1): [c.strip() for c in m.group(2).split(",")]
             for m in re.finditer(rf"CREATE INDEX IF NOT EXISTS (\w+)\s+ON {table.name} \(([^)]*)\)", _migration_sql())}
    assert found == {ix.name: [c.name for c in ix.columns] for ix in table.indexes}


def test_migration_is_idempotent_and_survives_a_foreign_owner():
    sql = _migration_sql()
    assert sql.count("CREATE TABLE IF NOT EXISTS") == 2
    blocks = re.findall(r"DO \$\$(.*?)\$\$;", sql, re.S)
    assert len(blocks) == 2 and all("WHEN insufficient_privilege" in b for b in blocks)
    outside = re.sub(r"DO \$\$(.*?)\$\$;", "", sql, flags=re.S)
    assert "CREATE INDEX" not in outside and "COMMENT ON" not in outside
    assert not re.search(r"\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b", sql, re.I)


def test_flyway_versions_are_unique_and_both_present():
    versions = sorted(int(m.group(1)) for f in MIGRATIONS.glob("V*__*.sql")
                      if (m := re.match(r"V(\d+)__", f.name)))
    assert len(versions) == len(set(versions)), "duplicate Flyway version"
    assert (MIGRATIONS / "V561__mcp_design_import_part.sql").exists()
    assert (MIGRATIONS / "V562__mcp_catalog_data_record_and_publish_confirm.sql").exists()


@pytest.mark.parametrize("check, table", [
    (check_design_import_schema, DesignImportPart.__tablename__),
    (check_catalog_data_schema, CatalogDataRecord.__tablename__),
    (check_publish_confirm_schema, PublishConfirm.__tablename__),
])
def test_checks_never_create_the_table(check, table, caplog):
    db = sessionmaker(bind=create_engine("sqlite://"))()
    with caplog.at_level("ERROR"):
        assert check(db) is False
    assert not inspect(db.get_bind()).has_table(table)      # no DDL ran
    assert table in caplog.text and "Flyway" in caplog.text


def test_check_never_raises_on_a_broken_bind():
    class Broken:
        def get_bind(self):
            raise RuntimeError("db down")
    assert check_publish_confirm_schema(Broken()) is False


def test_check_true_when_flyway_created_it():
    db = sessionmaker(bind=create_engine("sqlite://"))()
    PublishConfirm.__table__.create(bind=db.get_bind())
    assert check_publish_confirm_schema(db) is True


def test_ai_service_runs_no_ddl_for_flyway_owned_tables():
    for path in ("models/design_import.py", "models/catalog_data_edit.py", "models/publish_confirm.py",
                 "models/flyway_owned.py", "app_factory.py"):
        src = (AI_APP / path).read_text(encoding="utf-8")
        assert ".create(" not in src and "create_all" not in src and "CREATE TABLE" not in src, path
    factory = (AI_APP / "app_factory.py").read_text(encoding="utf-8")
    assert "ensure_design_import_schema" not in factory and "ensure_publish_confirm_schema" not in factory
