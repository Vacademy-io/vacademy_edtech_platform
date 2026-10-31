"""
Private file exports (services/file_exports.py, table mcp_file_export) — the shared store for every
tool-generated file that must not go through the AI chat. Runs the real SQL on SQLite.
"""
import json
import re
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.services.file_exports as fe  # noqa: E402

from app.models.file_export import MIGRATION, FileExport, check_file_export_schema  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS = REPO / "admin_core_service" / "src" / "main" / "resources" / "db" / "migration"


@pytest.fixture
def Session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    FileExport.__table__.create(bind=engine)  # the model IS the V565 table (checked below)
    return sessionmaker(bind=engine)


@pytest.fixture
def kinds(monkeypatch):
    monkeypatch.setattr(fe, "EXPORT_KINDS", dict(fe.EXPORT_KINDS))
    fe.register_kind("TEST_REPORT", fe.ExportKind(label="a test report", ttl_minutes=60, max_downloads=2,
                                                  max_bytes=1000, content_types=("text/csv", "application/pdf")))


def make(db, **kw):
    args = dict(institute_id="inst-1", user_id="admin-1", source_tool="some_tool", kind="TEST_REPORT",
                file_name="report.csv", content="name,secret\nAsha,S3cret\n")
    args.update(kw)
    return fe.create_export(db, **args)


def key_of(handle):
    return handle.url.rsplit("/", 1)[1]


def row(db, export_id):
    return db.execute(text("SELECT * FROM mcp_file_export WHERE id = :id"), {"id": export_id}).mappings().first()


def test_stored_encrypted_with_audit_fields(Session, kinds):
    db = Session()
    h = make(db, metadata={"rows": 1}, file_name="bad/name?.csv")
    r = row(db, h.export_id)
    assert "S3cret" not in r["ciphertext"] and key_of(h) not in r["key_hash"]
    assert (r["institute_id"], r["created_by_user_id"], r["source_tool"], r["kind"]) == \
           ("inst-1", "admin-1", "some_tool", "TEST_REPORT")
    assert r["status"] == "ACTIVE" and r["size_bytes"] == len("name,secret\nAsha,S3cret\n")
    assert json.loads(r["metadata_json"]) == {"rows": 1} and r["file_name"] == "bad_name_.csv"
    assert h.url.startswith("https://") and "/ai-service/exports/" in h.url


def test_wrong_key_reveals_nothing_and_burns_nothing(Session, kinds):
    db = Session()
    h = make(db)
    assert fe.read_export(db, h.export_id, "x" * 43) is None
    assert row(db, h.export_id)["download_count"] == 0
    assert fe.read_export(db, h.export_id, key_of(h))[2] == b"name,secret\nAsha,S3cret\n"


def test_used_up_file_is_wiped_but_kept_as_audit(Session, kinds):
    db = Session()
    h = make(db)  # policy: 2 downloads
    assert fe.read_export(db, h.export_id, key_of(h)) is not None
    assert fe.read_export(db, h.export_id, key_of(h)) is not None
    assert fe.read_export(db, h.export_id, key_of(h)) is None
    r = row(db, h.export_id)
    assert r["status"] == "CONSUMED" and r["ciphertext"] is None and r["download_count"] == 2
    assert r["last_downloaded_at"]


def test_expired_files_are_refused_and_wiped_by_purge(Session, kinds, monkeypatch):
    db = Session()
    h = make(db)
    real_now = fe._now
    monkeypatch.setattr(fe, "_now", lambda: real_now() + timedelta(minutes=61))
    assert fe.read_export(db, h.export_id, key_of(h)) is None
    fe.purge(db)
    db.commit()
    r = row(db, h.export_id)
    assert r["status"] == "EXPIRED" and r["ciphertext"] is None
    monkeypatch.setattr(fe, "_now", lambda: real_now() + timedelta(days=fe.RETENTION_DAYS + 1))
    fe.purge(db)
    db.commit()
    assert row(db, h.export_id) is None  # audit row gone after retention


def test_revoke_is_scoped_to_the_institute(Session, kinds):
    db = Session()
    h = make(db)
    assert fe.revoke_export(db, h.export_id, "other-inst") is False
    assert fe.revoke_export(db, h.export_id, "inst-1") is True
    assert fe.read_export(db, h.export_id, key_of(h)) is None
    assert row(db, h.export_id)["status"] == "REVOKED" and row(db, h.export_id)["ciphertext"] is None


def test_policy_is_enforced_and_can_only_be_tightened(Session, kinds):
    db = Session()
    with pytest.raises(fe.ExportError, match="unknown export kind"):
        make(db, kind="WHATEVER")
    with pytest.raises(fe.ExportError, match="may be"):
        make(db, content_type="text/html")
    with pytest.raises(fe.ExportError, match="limit"):
        make(db, content="x" * 1001)
    h = make(db, ttl_minutes=10_000, max_downloads=50)
    assert h.max_downloads == 2 and h.expires_at - fe._now() <= timedelta(minutes=60)
    tight = make(db, ttl_minutes=5, max_downloads=1)
    assert tight.max_downloads == 1 and tight.expires_at - fe._now() <= timedelta(minutes=5)
    with pytest.raises(ValueError):
        fe.register_kind("lower_case", fe.ExportKind("x", 1, 1, 10, ("text/csv",)))
    with pytest.raises(ValueError):
        fe.register_kind("TOO_BIG", fe.ExportKind("x", 1, 1, fe.ABSOLUTE_MAX_BYTES + 1, ("text/csv",)))


def test_binary_files_round_trip(Session, kinds):
    db = Session()
    pdf = b"%PDF-1.7\n\x00\xff\x10binary"
    h = make(db, content=pdf, content_type="application/pdf", file_name="statement.pdf")
    assert fe.read_export(db, h.export_id, key_of(h)) == ("statement.pdf", "application/pdf", pdf)


def test_link_result_is_the_same_for_every_tool(Session, kinds):
    h = make(Session())
    out = fe.link_result(h, rows=1)
    assert out["status"] == "ready" and out["download_url"] == h.url and out["rows"] == 1
    assert out["contains"] == "a test report" and "do not open" in out["note"] and out["max_downloads"] == 2


def test_download_route_attachment_then_410(Session, kinds):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.db import db_dependency

    db = Session()
    h = make(db, max_downloads=1, file_name="résumé logins.csv")
    app = FastAPI()
    app.include_router(fe.router)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[db_dependency] = _db
    client = TestClient(app)
    path = h.url[h.url.index(fe.EXPORT_PATH_PREFIX):]

    ok = client.get(path)
    assert ok.status_code == 200 and ok.content == b"name,secret\nAsha,S3cret\n"
    cd = ok.headers["content-disposition"]
    assert cd.startswith("attachment;") and "filename*=UTF-8''r%C3%A9sum%C3%A9%20logins.csv" in cd
    for k, v in (("cache-control", "no-store"), ("referrer-policy", "no-referrer"),
                 ("x-content-type-options", "nosniff")):
        assert ok.headers[k] == v
    gone = client.get(path)
    assert gone.status_code == 410 and "S3cret" not in gone.text
    assert client.get(f"{fe.EXPORT_PATH_PREFIX}/not-an-id/short").status_code == 410


# ── Flyway owns the table (V565); ai_service runs no DDL for it ──────────
def _migration_sql() -> str:
    files = sorted(MIGRATIONS.glob("V*__mcp_file_export.sql"))
    assert [f.name for f in files] == [MIGRATION]
    return re.sub(r"--[^\n]*", "", files[0].read_text(encoding="utf-8"))


def _sql_type(col) -> str:
    from sqlalchemy import BigInteger, DateTime, Integer, String, Text
    t = col.type
    if isinstance(t, Text):
        return "TEXT"
    if isinstance(t, String):
        return f"VARCHAR({t.length})"
    if isinstance(t, BigInteger):
        return "BIGINT"
    if isinstance(t, Integer):
        return "INTEGER"
    if isinstance(t, DateTime):
        return "TIMESTAMPTZ" if t.timezone else "TIMESTAMP"
    raise AssertionError(f"unmapped type {t!r}")


def test_model_matches_the_flyway_migration():
    sql = _migration_sql()
    body = re.search(r"CREATE TABLE IF NOT EXISTS mcp_file_export \((.*?)\n\);", sql, re.S).group(1)
    cols = {}
    for line in filter(None, (l.strip().rstrip(",") for l in body.splitlines())):
        name, sql_type, *rest = line.split()
        rest = " ".join(rest).upper()
        cols[name] = (sql_type.upper(), "NOT NULL" in rest or "PRIMARY KEY" in rest, "PRIMARY KEY" in rest)
    table = FileExport.__table__
    assert list(cols) == [c.name for c in table.columns]
    for c in table.columns:
        assert cols[c.name] == (_sql_type(c), not c.nullable, c.primary_key), c.name
    found = {m.group(1): [x.strip() for x in m.group(2).split(",")]
             for m in re.finditer(r"CREATE INDEX IF NOT EXISTS (\w+)\s+ON mcp_file_export \(([^)]*)\)", sql)}
    assert found == {ix.name: [c.name for c in ix.columns] for ix in table.indexes}
    # Same shape as V561 / V562: index + comment DDL guarded against a foreign table owner.
    outside = re.sub(r"DO \$\$(.*?)\$\$;", "", sql, flags=re.S)
    assert "CREATE INDEX" not in outside and "insufficient_privilege" in sql
    assert not re.search(r"\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b", sql, re.I)


def test_flyway_version_is_unique():
    versions = [int(m.group(1)) for f in MIGRATIONS.glob("V*__*.sql") if (m := re.match(r"V(\d+)__", f.name))]
    assert len(versions) == len(set(versions)), "duplicate Flyway version"


def test_ai_service_never_creates_the_table(caplog):
    for path in ("app/models/file_export.py", "app/services/file_exports.py"):
        src = (REPO / "ai_service" / path).read_text(encoding="utf-8")
        assert "CREATE TABLE" not in src and ".create(" not in src and "create_all" not in src, path
    assert "mcp_file_export" not in (REPO / "ai_service" / "app" / "mcp" / "schema.py").read_text(encoding="utf-8")
    db = sessionmaker(bind=create_engine("sqlite://"))()
    with caplog.at_level("ERROR"):
        assert check_file_export_schema(db) is False  # reports, never creates
    assert "mcp_file_export" in caplog.text and MIGRATION in caplog.text
