"""Parity between the usage-limit SQLAlchemy models (services/metering/limit_models.py)
and the admin_core Flyway migration that owns the tables (V587__ai_usage_limits.sql).

Checked, per table: column names, SQL types (incl. varchar widths and numeric
precision/scale), NOT NULL, server defaults, primary key; the CHECK constraints
and the indexes (name, uniqueness, partial WHERE). Also: the models create on
SQLite (offline tests) and the partial unique index there behaves like Postgres.

No network, no Postgres. Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_limit_models_parity.py -q -p no:cacheprovider
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Integer, MetaData, Numeric, String, Text  # noqa: E402
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID  # noqa: E402

from ai_service.app.services.metering import limit_models as lm  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
TABLES = ("institute_ai_limits_policy", "ai_usage_limit", "ai_usage_counter", "ai_usage_reservation")
MODELS = {m.__tablename__: m for m in (lm.InstituteAiLimitsPolicy, lm.AiUsageLimit, lm.AiUsageCounter,
                                       lm.AiUsageReservation)}


# ── migration parsing ────────────────────────────────────────────────────────

def _migration_sql():
    if not MIGRATIONS.is_dir():
        return None
    for f in sorted(MIGRATIONS.glob("V*.sql")):
        body = f.read_text(encoding="utf-8")
        if re.search(r"CREATE TABLE IF NOT EXISTS ai_usage_limit\b", body):
            return re.sub(r"--[^\n]*", "", body)
    return None


@pytest.fixture(scope="module")
def sql():
    s = _migration_sql()
    if s is None:
        pytest.skip("V587 ai_usage_limits migration not in this checkout")
    return s


def _split_top_level(body):
    depth, cur, parts = 0, "", []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [" ".join(p.split()) for p in parts if p.strip()]


def _norm_default(raw):
    if raw is None:
        return None
    v = raw.strip().lower()
    return {"false": "false", "true": "true"}.get(v, v)


def _parse_table(sql, table):
    m = re.search(rf"CREATE TABLE IF NOT EXISTS {table}\s*\((.*?)\n\);", sql, re.S)
    assert m, f"CREATE TABLE IF NOT EXISTS {table} not found"
    cols, pk, checks = {}, [], {}
    for p in _split_top_level(m.group(1)):
        cm = re.match(r"CONSTRAINT (\w+) CHECK \((.*)\)$", p, re.I)
        if cm:
            checks[cm.group(1)] = " ".join(cm.group(2).split())
            continue
        pm = re.match(r"PRIMARY KEY \((.*)\)$", p, re.I)
        if pm:
            pk = [c.strip().lower() for c in pm.group(1).split(",")]
            continue
        assert not re.match(r"(UNIQUE|CONSTRAINT|CHECK)\b", p, re.I), f"unhandled table clause in {table}: {p}"
        tm = re.match(r"(\w+)\s+(VARCHAR\(\d+\)|NUMERIC\(\d+,\s*\d+\)|TEXT\[\]|TIMESTAMPTZ|BOOLEAN|UUID|JSONB|TEXT"
                      r"|INT|BIGINT)(.*)$", p, re.I)
        assert tm, f"unparsed column in {table}: {p}"
        name, sql_type, rest = tm.group(1).lower(), tm.group(2).lower().replace(" ", ""), tm.group(3)
        dm = re.search(r"\bDEFAULT\s+('(?:[^']|'')*'|\w+\(\)|[\w.]+)", rest, re.I)
        cols[name] = {
            "type": sql_type,
            "not_null": bool(re.search(r"\bNOT NULL\b|\bPRIMARY KEY\b", rest, re.I)),
            "default": _norm_default(dm.group(1) if dm else None),
        }
        if re.search(r"\bPRIMARY KEY\b", rest, re.I):
            pk.append(name)
    return cols, pk, checks


def _parse_indexes(sql, table):
    out = {}
    for m in re.finditer(rf"CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON {table}\s*\((.*?)\)\s*(?:WHERE (.*?))?;",
                         " ".join(sql.split()), re.S):
        cols = [c.lower().replace(" ", "") for c in _split_top_level(m.group(3))]
        out[m.group(2)] = {"unique": bool(m.group(1)), "cols": cols,
                           "where": " ".join(m.group(4).split()) if m.group(4) else None}
    return out


# ── model introspection ──────────────────────────────────────────────────────

def _model_type(col):
    t = col.type
    t = getattr(t, "impl", t)
    if isinstance(t, UUID):
        return "uuid"
    if isinstance(t, ARRAY):
        assert isinstance(t.item_type, Text)
        return "text[]"
    if isinstance(t, (JSONB, JSON)):
        return "jsonb"
    if isinstance(t, Text):
        return "text"
    if isinstance(t, String):
        return f"varchar({t.length})"
    if isinstance(t, BigInteger):
        return "bigint"
    if isinstance(t, Integer):
        return "int"
    if isinstance(t, Boolean):
        return "boolean"
    if isinstance(t, Numeric):
        return f"numeric({t.precision},{t.scale})"
    if isinstance(t, DateTime):
        return "timestamptz" if t.timezone else "timestamp"
    raise AssertionError(f"unmapped type {t!r}")


def _model_default(col):
    sd = col.server_default
    if sd is None:
        return None
    return _norm_default(str(sd.arg.text if hasattr(sd.arg, "text") else sd.arg))


def _index_cols(idx):
    out = []
    for e in idx.expressions:
        if hasattr(e, "name") and getattr(e, "table", None) is not None:
            out.append(e.name)
        else:
            s = str(e).lower().replace(" ", "")
            out.append(s)
    return out


# ── tests ────────────────────────────────────────────────────────────────────

def test_migration_is_v587_and_defines_exactly_the_four_tables(sql):
    f = [p.name for p in MIGRATIONS.glob("V*.sql") if "CREATE TABLE IF NOT EXISTS ai_usage_limit" in p.read_text()]
    assert f == ["V587__ai_usage_limits.sql"]
    created = set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", sql))
    assert created == set(TABLES)
    assert "ALTER TABLE" not in sql.upper(), "V587 must not alter existing tables"
    assert "INSERT INTO" not in sql.upper(), "V587 has no seeds"
    assert re.search(r"SET LOCAL lock_timeout", sql)


@pytest.mark.parametrize("table", TABLES)
def test_columns_types_nullability_defaults_match(sql, table):
    cols, pk, _ = _parse_table(sql, table)
    model = MODELS[table]
    sql_order = list(cols)
    model_order = [c.name for c in model.__table__.columns]
    assert model_order == sql_order, f"{table}: column order/set differs"
    for c in model.__table__.columns:
        exp = cols[c.name]
        assert _model_type(c) == exp["type"], f"{table}.{c.name} type"
        assert (not c.nullable) == exp["not_null"], f"{table}.{c.name} nullability"
        assert _model_default(c) == exp["default"], f"{table}.{c.name} default"
    assert [c.name for c in model.__table__.primary_key.columns] == pk, f"{table} primary key"


def test_check_constraints_match(sql):
    for table in TABLES:
        _, _, checks = _parse_table(sql, table)
        model_checks = {c.name: " ".join(str(c.sqltext).split())
                        for c in MODELS[table].__table__.constraints if c.__class__.__name__ == "CheckConstraint"}
        assert model_checks == checks, table
    assert set(_parse_table(sql, "ai_usage_limit")[2]) == {"ck_aul_soft_le_hard", "ck_aul_soft_nonneg",
                                                           "ck_aul_hard_nonneg"}


@pytest.mark.parametrize("table", TABLES)
def test_indexes_match(sql, table):
    exp = _parse_indexes(sql, table)
    got = {}
    for idx in MODELS[table].__table__.indexes:
        where = idx.dialect_options["postgresql"].get("where")
        got[idx.name] = {"unique": bool(idx.unique), "cols": _index_cols(idx),
                         "where": " ".join(str(where).split()) if where is not None else None}
        sw = idx.dialect_options["sqlite"].get("where")
        assert (str(sw) if sw is not None else None) == (str(where) if where is not None else None), idx.name
    assert got == exp, table


def test_period_metric_vocabulary_fits_the_columns():
    for vocab, width in ((lm.PERIODS, lm.W_PERIOD), (lm.METRICS, lm.W_METRIC), (lm.POLICY_MODES, lm.W_MODE),
                         (lm.SUBJECT_KINDS, lm.W_SUBJECT_KIND), (lm.SCOPE_KINDS, lm.W_SCOPE_KIND),
                         (lm.ORIGINS, lm.W_ORIGIN), (lm.RESERVATION_STATUSES, lm.W_STATUS)):
        assert max(len(v) for v in vocab) <= width, vocab
    assert lm.AiUsageLimit.__table__.c.period.type.length == lm.W_PERIOD
    assert lm.AiUsageCounter.__table__.c.period.type.length == lm.W_PERIOD
    assert lm.AiUsageLimit.__table__.c.metric.type.length == lm.W_METRIC
    assert lm.AiUsageCounter.__table__.c.counter_key.type.length == lm.W_COUNTER_KEY
    assert "PLAN_PERIOD" in lm.PERIODS and "PLAN_PERIOD" not in lm.ACTIVE_PERIODS
    assert lm.DEFAULT_TIMEZONE == "Asia/Kolkata"


def test_models_create_on_sqlite_and_partial_unique_index_behaves():
    from sqlalchemy import create_engine, insert, update
    from sqlalchemy.exc import IntegrityError

    md = MetaData()
    for t in lm.LimitsBase.metadata.tables.values():
        tt = t.to_metadata(md)
        for c in tt.columns:
            c.server_default = None
    eng = create_engine("sqlite://")
    md.create_all(eng)
    L = md.tables["ai_usage_limit"]
    import datetime as dt
    now = dt.datetime(2026, 10, 15, tzinfo=dt.timezone.utc)
    base = dict(institute_id="i1", subject_kind="INSTITUTE", subject_value=None, per_member=False,
                scope_kind="ALL", scope_value=None, period="MONTH", metric="CREDITS", soft_limit=1,
                hard_limit=2, origin="TENANT", locked=False, effective_from=now, is_active=True,
                created_by="t", created_at=now, updated_at=now)
    with eng.begin() as c:
        c.execute(insert(L).values(id="a", **base))
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(insert(L).values(id="b", **base))          # same open key (NULLs via COALESCE)
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(insert(L).values(id="c", **{**base, "subject_value": "x", "soft_limit": 3}))  # soft > hard
    with eng.begin() as c:
        c.execute(insert(L).values(id="d", **{**base, "origin": "PLATFORM"}))
        c.execute(update(L).where(L.c.id == "a").values(is_active=False, effective_to=now))
        c.execute(insert(L).values(id="e", **base))              # re-create after soft delete
        ids = sorted(r.id for r in c.execute(L.select()))
    assert ids == ["a", "d", "e"]
