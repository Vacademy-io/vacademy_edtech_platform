"""Parity between the AI-plan SQLAlchemy models (services/metering/plan_models.py)
and the admin_core Flyway migration that owns the tables (V588__ai_subscription_plans.sql).

Offline (always):
  * per table: column names and order, SQL types (varchar widths, numeric
    precision/scale), NOT NULL, server defaults, primary key, UNIQUE constraints,
    foreign keys, CHECK constraints, indexes (name, uniqueness, partial WHERE);
  * every use case seeded by V586 gets a billing_feature_key in V588, every
    mapped feature is seeded, and the seeded AI Pro items never include or
    allowance an ALWAYS_CHARGED feature; ai_calling / telephony are locked;
  * the models create on SQLite and the partial unique indexes behave.

On a REAL Postgres 16 (skipped unless AI_LIMITS_PG_URL or AI_LIMITS_PGDATA is
set; AI_LIMITS_PG_TEMPLATE=<db> clones a template such as 'prodbase'):
  * V586, V587, V588 each in one transaction (Flyway-like), then V588 AGAIN
    (idempotent);
  * information_schema matches the models;
  * the freeze triggers: a PUBLISHED version's price and items cannot change,
    PUBLISHED -> RETIRED works, RETIRED is final, DRAFT edits work;
  * ux_ias_live refuses a second live subscription; ux_aso_active a second
    active override;
  * 0 catalog rows without billing_feature_key and every key references a feature;
  * the seeded AI Pro DRAFT has valid items.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_plan_models_parity.py -q -p no:cacheprovider
  AI_LIMITS_PGDATA=<dir> AI_LIMITS_PG_TEMPLATE=prodbase <venv>/bin/python -m pytest ai_service/tests/test_plan_models_parity.py -q -p no:cacheprovider
"""
from __future__ import annotations

import os
import re
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Integer, MetaData, Numeric, String, Text  # noqa: E402
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID  # noqa: E402

from ai_service.app.services.metering import plan_models as pm  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
TABLES = ("ai_billing_feature", "ai_plan", "ai_plan_version", "ai_plan_item", "institute_ai_subscription",
          "ai_subscription_period", "ai_subscription_override", "ai_subscription_event")
MODELS = {m.__tablename__: m for m in (pm.AiBillingFeature, pm.AiPlan, pm.AiPlanVersion, pm.AiPlanItem,
                                       pm.InstituteAiSubscription, pm.AiSubscriptionPeriod,
                                       pm.AiSubscriptionOverride, pm.AiSubscriptionEvent)}

_TYPE_RE = (r"VARCHAR\(\d+\)|NUMERIC\(\d+,\s*\d+\)|TEXT\[\]|TIMESTAMPTZ|BOOLEAN|UUID|JSONB|TEXT|INT|BIGINT")


# ── migration parsing ────────────────────────────────────────────────────────

def _strip_comments(body: str) -> str:
    return re.sub(r"--[^\n]*", "", body)


def _migration_file(prefix: str):
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql")) if MIGRATIONS.is_dir() else []
    return hits[0] if hits else None


@pytest.fixture(scope="module")
def sql():
    f = _migration_file("V588")
    if f is None:
        pytest.skip("V588 ai_subscription_plans migration not in this checkout")
    return _strip_comments(f.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def v586_sql():
    f = _migration_file("V586")
    if f is None:
        pytest.skip("V586 not in this checkout")
    return _strip_comments(f.read_text(encoding="utf-8"))


def _split_top_level(body):
    depth, cur, parts, quoted = 0, "", [], False
    for ch in body:
        if ch == "'":
            quoted = not quoted
        if not quoted:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
        if ch == "," and depth == 0 and not quoted:
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
    cols, pk, checks, uniques, fks = {}, [], {}, [], {}
    for p in _split_top_level(m.group(1)):
        cm = re.match(r"CONSTRAINT (\w+) CHECK \((.*)\)$", p, re.I)
        if cm:
            checks[cm.group(1)] = " ".join(cm.group(2).split())
            continue
        um = re.match(r"UNIQUE \((.*)\)$", p, re.I)
        if um:
            uniques.append(tuple(c.strip().lower() for c in um.group(1).split(",")))
            continue
        assert not re.match(r"(PRIMARY KEY|CONSTRAINT|CHECK|FOREIGN)\b", p, re.I), f"unhandled clause in {table}: {p}"
        tm = re.match(rf"(\w+)\s+({_TYPE_RE})(.*)$", p, re.I)
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
        if re.search(r"\bUNIQUE\b", rest, re.I):
            uniques.append((name,))
        fm = re.search(r"\bREFERENCES (\w+)\((\w+)\)", rest, re.I)
        if fm:
            fks[name] = f"{fm.group(1).lower()}.{fm.group(2).lower()}"
    return cols, pk, checks, sorted(uniques), fks


def _parse_indexes(sql, table):
    out = {}
    for m in re.finditer(rf"CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON {table}\s*\((.*?)\)\s*(?:WHERE (.*?))?;",
                         " ".join(sql.split()), re.S):
        cols = [c.lower().replace(" ", "") for c in _split_top_level(m.group(3))]
        out[m.group(2)] = {"unique": bool(m.group(1)), "cols": cols,
                           "where": " ".join(m.group(4).split()) if m.group(4) else None}
    return out


def _values_rows(block: str):
    """Rows of a VALUES (...), (...) list as lists of raw SQL literals."""
    rows = []
    for m in re.finditer(r"\(((?:[^()']|'(?:[^']|'')*')*)\)", block):
        rows.append([v.strip() for v in _split_top_level(m.group(1))])
    return rows


def _lit(v):
    v = v.strip()
    v = re.sub(r"::\w+(\[\])?$", "", v)
    if v.upper() == "NULL":
        return None
    if v.startswith("'"):
        return v[1:-1].replace("''", "'")
    if v.upper() in ("TRUE", "FALSE"):
        return v.upper() == "TRUE"
    return v


def _seed_features(sql):
    m = re.search(r"INSERT INTO ai_billing_feature \((.*?)\)\s*VALUES(.*?)ON CONFLICT", sql, re.S)
    assert m
    names = [c.strip() for c in m.group(1).split(",")]
    rows = ({k: _lit(v) for k, v in zip(names, row)} for row in _values_rows(m.group(2)))
    return {d["feature_key"]: d for d in rows}


def _seed_items(sql):
    m = re.search(r"CROSS JOIN \(VALUES(.*?)\) AS s \((.*?)\)", sql, re.S)
    assert m
    names = [c.strip() for c in m.group(2).split(",")]
    return {d["feature_key"]: d for d in ({k: _lit(v) for k, v in zip(names, row)} for row in _values_rows(m.group(1)))}


def _seed_mapping(sql):
    m = re.search(r"UPDATE ai_use_case_catalog c\s+SET billing_feature_key = m.feature_key\s+FROM \(VALUES(.*?)\) AS m",
                  sql, re.S)
    assert m
    return {_lit(r[0]): _lit(r[1]) for r in _values_rows(m.group(1))}


def _v586_use_cases(v586_sql):
    m = re.search(r"INSERT INTO ai_use_case_catalog.*?VALUES(.*?)ON CONFLICT \(use_case\)", v586_sql, re.S)
    assert m
    return [_lit(r[0]) for r in _values_rows(m.group(1))]


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


def _model_uniques(table):
    # Column(unique=True) also appears in table.constraints: de-duplicate.
    out = {tuple(c.name for c in uc.columns) for uc in table.constraints
           if uc.__class__.__name__ == "UniqueConstraint"}
    out |= {(c.name,) for c in table.columns if c.unique}
    return sorted(out)


# ── offline tests ────────────────────────────────────────────────────────────

def test_migration_is_v588_and_defines_exactly_the_eight_tables(sql):
    f = [p.name for p in MIGRATIONS.glob("V*.sql")
         if "CREATE TABLE IF NOT EXISTS institute_ai_subscription" in p.read_text(encoding="utf-8")]
    assert f == ["V588__ai_subscription_plans.sql"]
    assert set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", sql)) == set(TABLES)
    alters = re.findall(r"ALTER TABLE[^;]*;", sql, re.I)
    assert alters == ["ALTER TABLE ai_use_case_catalog ADD COLUMN IF NOT EXISTS billing_feature_key VARCHAR(48);"]
    assert "credit_transactions" not in sql, "no ledger columns (critique C2/C3)"
    assert re.search(r"SET LOCAL lock_timeout", sql)
    assert "${" not in sql, "Flyway placeholder syntax must not appear"
    # idempotent trigger DDL
    for fn in ("fn_ai_plan_version_freeze", "fn_ai_plan_item_freeze"):
        assert f"CREATE OR REPLACE FUNCTION {fn}()" in sql
    for trg, tbl in (("trg_ai_plan_version_freeze", "ai_plan_version"), ("trg_ai_plan_item_freeze", "ai_plan_item")):
        assert f"DROP TRIGGER IF EXISTS {trg} ON {tbl};" in sql
    # the only UPDATE never overwrites an existing mapping
    assert re.search(r"AND c\.billing_feature_key IS NULL;", sql)


@pytest.mark.parametrize("table", TABLES)
def test_columns_types_nullability_defaults_keys_match(sql, table):
    cols, pk, _, uniques, fks = _parse_table(sql, table)
    model = MODELS[table].__table__
    assert [c.name for c in model.columns] == list(cols), f"{table}: column order/set differs"
    for c in model.columns:
        exp = cols[c.name]
        assert _model_type(c) == exp["type"], f"{table}.{c.name} type"
        assert (not c.nullable) == exp["not_null"], f"{table}.{c.name} nullability"
        assert _model_default(c) == exp["default"], f"{table}.{c.name} default"
    assert [c.name for c in model.primary_key.columns] == pk, f"{table} primary key"
    assert _model_uniques(model) == uniques, f"{table} unique constraints"
    model_fks = {fk.parent.name: f"{fk.column.table.name}.{fk.column.name}" for fk in model.foreign_keys}
    assert model_fks == fks, f"{table} foreign keys"


def test_check_constraints_match(sql):
    for table in TABLES:
        checks = _parse_table(sql, table)[2]
        model_checks = {c.name: " ".join(str(c.sqltext).split())
                        for c in MODELS[table].__table__.constraints if c.__class__.__name__ == "CheckConstraint"}
        assert model_checks == checks, table
    assert _parse_table(sql, "ai_subscription_period")[2] == {"ck_asp_allowance_used_nonneg": "allowance_used >= 0"}


@pytest.mark.parametrize("table", TABLES)
def test_indexes_match(sql, table):
    exp = _parse_indexes(sql, table)
    got = {}
    for idx in MODELS[table].__table__.indexes:
        where = idx.dialect_options["postgresql"].get("where")
        got[idx.name] = {"unique": bool(idx.unique), "cols": [e.name for e in idx.expressions],
                         "where": " ".join(str(where).split()) if where is not None else None}
        sw = idx.dialect_options["sqlite"].get("where")
        assert (str(sw) if sw is not None else None) == (str(where) if where is not None else None), idx.name
    assert got == exp, table
    if table == "institute_ai_subscription":
        assert exp["ux_ias_live"] == {"unique": True, "cols": ["institute_id"],
                                      "where": "status IN ('TRIAL','ACTIVE','GRACE')"}
        assert set(pm.LIVE_STATUSES) == {"TRIAL", "ACTIVE", "GRACE"}


def test_vocabularies_fit_the_columns():
    for vocab, width in ((pm.ELIGIBILITIES, pm.W_ELIGIBILITY), (pm.VERSION_STATUSES, pm.W_VERSION_STATUS),
                         (pm.GRACE_BEHAVIOURS, pm.W_GRACE_BEHAVIOUR), (pm.ITEM_MODES, pm.W_ITEM_MODE),
                         (pm.MODEL_POLICIES, pm.W_MODEL_POLICY), (pm.MODEL_VIOLATION_ACTIONS, pm.W_MODEL_VIOLATION),
                         (pm.OVER_CAP_ACTIONS, pm.W_OVER_CAP), (pm.USER_CAP_BASES, pm.W_USER_CAP_BASIS),
                         (pm.SUBSCRIPTION_STATUSES, pm.W_SUB_STATUS), (pm.ENFORCEMENTS, pm.W_ENFORCEMENT),
                         (pm.SOURCES, pm.W_SOURCE), (pm.PAYMENT_STATUSES, pm.W_PAYMENT_STATUS)):
        assert max(len(v) for v in vocab) <= width, vocab
    t = pm.ITEM_TABLE.c
    assert t.mode.type.length == pm.W_ITEM_MODE and t.model_policy.type.length == pm.W_MODEL_POLICY
    assert pm.VERSION_TABLE.c.status.type.length == pm.W_VERSION_STATUS
    assert pm.SUBSCRIPTION_TABLE.c.status.type.length == pm.W_SUB_STATUS
    assert pm.FEATURE_TABLE.c.feature_key.type.length == pm.W_FEATURE_KEY
    assert pm.CATALOG_FEATURE_TABLE.c.billing_feature_key.type.length == pm.W_FEATURE_KEY
    assert "ai_use_case_catalog" not in pm.PlansBase.metadata.tables


def test_plan_counter_keys_fit_ai_usage_counter():
    sub = str(uuid.uuid4())
    assert pm.plan_counter_key(sub) == f"PLAN:{sub}|ALL"
    assert pm.plan_counter_key(sub, "kb_qa") == f"PLAN:{sub}|F:kb_qa"
    assert pm.plan_counter_key(sub, "kb_qa", "u1") == f"PLAN:{sub}|F:kb_qa|U:u1"
    long_uid = "x" * 255
    k = pm.plan_counter_key(sub, "x" * 48, long_uid)
    assert len(k) <= pm.W_COUNTER_KEY and "|U:h:" in k
    assert k == pm.plan_counter_key(sub, "x" * 48, long_uid)   # deterministic
    from ai_service.app.services.metering import limit_models as lm
    assert lm.W_COUNTER_KEY == pm.W_COUNTER_KEY and pm.PLAN_COUNTER_PERIOD in lm.PERIODS


def test_every_v586_use_case_is_mapped_to_a_seeded_feature(sql, v586_sql):
    features = _seed_features(sql)
    mapping = _seed_mapping(sql)
    use_cases = _v586_use_cases(v586_sql)
    assert len(use_cases) == 57
    assert sorted(mapping) == sorted(use_cases), set(use_cases) ^ set(mapping)
    assert set(mapping.values()) <= set(features)
    assert len(features) == 24
    for k, f in features.items():
        assert f["eligibility"] in pm.ELIGIBILITIES, k
        assert len(k) <= pm.W_FEATURE_KEY
    # platform guards
    for k in pm.LOCKED_ALWAYS_CHARGED:
        assert features[k]["eligibility"] == "ALWAYS_CHARGED" and features[k]["locked"] is True
    assert {k for k, f in features.items() if f["locked"]} == set(pm.LOCKED_ALWAYS_CHARGED)
    for k in ("engagement_messages", "premium_tts", "unmapped"):
        assert features[k]["eligibility"] == "ALWAYS_CHARGED"
    for k in ("image_generation", "video_lesson", "ai_video_clips", "tutor_live_minutes", "tutor_avatar_minutes",
              "kb_ingest", "transcription", "call_intelligence"):
        assert features[k]["eligibility"] == "ALLOWANCE_ONLY", k
    # voice-bot domain never lands on an includable feature
    for uc in ("ai_calling", "telephony", "voice_bot_llm"):
        assert features[mapping[uc]]["eligibility"] == "ALWAYS_CHARGED", uc


def test_seeded_ai_pro_items_respect_eligibility(sql):
    features = _seed_features(sql)
    items = _seed_items(sql)
    assert set(items) == set(features), "AI Pro lists every feature explicitly"
    for k, it in items.items():
        elig = features[k]["eligibility"]
        assert it["mode"] in pm.ITEM_MODES and it["model_policy"] in pm.MODEL_POLICIES
        assert it["user_cap_basis"] in pm.USER_CAP_BASES
        if elig == "ALWAYS_CHARGED":
            assert it["mode"] == "CHARGED", k
        if elig == "ALLOWANCE_ONLY":
            assert it["mode"] in ("ALLOWANCE", "CHARGED"), k
        if it["mode"] == "INCLUDED":
            assert it["model_policy"] == "DEFAULT_CHAIN", k
            caps = [it[c] for c in ("inst_units_cap", "inst_credits_cap", "user_units_cap", "user_credits_cap")]
            assert any(c is not None for c in caps), f"{k}: INCLUDED without any fair-use cap"
            assert it["display_cap_text"], k
        if it["roles_included"]:
            roles = it["roles_included"].strip("{}").split(",")
            assert set(roles) <= set(pm.ROLE_CLASSES), k
    assert items["learner_analytics"]["user_cap_basis"] == "SUBJECT"
    assert items["tutor_chat"]["roles_included"] == "{LEARNER}"
    assert "API_KEY" not in items["copy_check"]["roles_included"]
    assert items["ai_calling"]["mode"] == items["telephony"]["mode"] == "CHARGED"
    m = re.search(r"SELECT p\.id, 1, 'DRAFT', 'INR', (\d+), FALSE, '998313', 1, (\d+), ([\d.]+), 7, 'CHARGED'", sql)
    assert m and m.groups() == ("500000", "2000", "13.95")


def test_models_create_on_sqlite_and_partial_unique_indexes_behave():
    import datetime as dt

    from sqlalchemy import create_engine, insert, update
    from sqlalchemy.exc import IntegrityError

    md = MetaData()
    for t in pm.PlansBase.metadata.tables.values():
        tt = t.to_metadata(md)
        for c in tt.columns:
            c.server_default = None
    eng = create_engine("sqlite://")
    md.create_all(eng)
    S, O = md.tables["institute_ai_subscription"], md.tables["ai_subscription_override"]
    now = dt.datetime(2026, 10, 15, tzinfo=dt.timezone.utc)
    base = dict(institute_id="i1", plan_version_id="v1", status="ACTIVE", enforcement="SHADOW", source="MANUAL",
                anchor_at=now, start_at=now, period_months=1, auto_renew=True, grace_days=7,
                cancel_at_period_end=False, created_by="t", created_at=now, updated_at=now)
    with eng.begin() as c:
        c.execute(insert(S).values(id="a", **base))
        c.execute(insert(S).values(id="b", **{**base, "status": "EXPIRED"}))
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(insert(S).values(id="c", **{**base, "status": "GRACE"}))
    with eng.begin() as c:
        c.execute(update(S).where(S.c.id == "a").values(status="CANCELLED"))
        c.execute(insert(S).values(id="d", **{**base, "status": "TRIAL"}))
    ob = dict(subscription_id="d", feature_key="kb_qa", reason="r", created_by="t", created_at=now, is_active=True)
    with eng.begin() as c:
        c.execute(insert(O).values(id="o1", **ob))
    with pytest.raises(IntegrityError):
        with eng.begin() as c:
            c.execute(insert(O).values(id="o2", **ob))
    with eng.begin() as c:
        c.execute(update(O).where(O.c.id == "o1").values(is_active=False))
        c.execute(insert(O).values(id="o3", **ob))


# ── real Postgres ────────────────────────────────────────────────────────────

STUBS = """
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64));
"""


def _server_url():
    url = os.environ.get("AI_LIMITS_PG_URL")
    if url:
        return url
    data = os.environ.get("AI_LIMITS_PGDATA")
    if not data:
        return None
    try:
        import pgserver  # noqa: PLC0415

        uri = pgserver.get_server(data, cleanup_mode=None).get_uri()
    except Exception:  # noqa: BLE001
        return None
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


def _run_script(engine, body):
    """Run a whole migration file in ONE transaction, like Flyway.

    Through the raw DBAPI cursor with no parameters: psycopg 3 then sends the text
    as is (the PL/pgSQL RAISE format strings contain '%', which a parameterised
    execute would treat as placeholders).
    """
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(body)
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


@pytest.fixture(scope="module")
def pg():
    from sqlalchemy import create_engine, text

    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    for prefix in ("V586", "V587", "V588"):
        if _migration_file(prefix) is None:
            pytest.skip(f"{prefix} migration not in this checkout")
    name = f"plan_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(url, future=True)
    _run_script(engine, STUBS)
    for prefix in ("V586", "V587", "V588", "V588"):          # V588 twice: idempotent
        _run_script(engine, _migration_file(prefix).read_text(encoding="utf-8"))
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


def _scalar(engine, sql, **kw):
    from sqlalchemy import text

    with engine.begin() as c:
        return c.execute(text(sql), kw).scalar()


def _refused(engine, sql, **kw):
    """True when the statement is rejected by the database (and rolled back)."""
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    try:
        with engine.begin() as c:
            c.execute(text(sql), kw)
    except DBAPIError as exc:
        return str(exc.orig).split("\n")[0]
    return None


def _pg_type(row):
    dt_, udt = row.data_type, row.udt_name
    if dt_ == "character varying":
        return f"varchar({row.character_maximum_length})"
    if dt_ == "numeric":
        return f"numeric({row.numeric_precision},{row.numeric_scale})"
    if dt_ == "ARRAY":
        assert udt == "_text"
        return "text[]"
    return {"timestamp with time zone": "timestamptz", "boolean": "boolean", "uuid": "uuid", "jsonb": "jsonb",
            "text": "text", "integer": "int", "bigint": "bigint"}[dt_]


@pytest.mark.parametrize("table", TABLES)
def test_pg_schema_matches_models(pg, table):
    from sqlalchemy import text

    with pg.begin() as c:
        rows = c.execute(text(
            "SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, "
            "is_nullable FROM information_schema.columns WHERE table_name = :t ORDER BY ordinal_position"),
            {"t": table}).all()
    model = MODELS[table].__table__
    assert [r.column_name for r in rows] == [c.name for c in model.columns]
    for r, col in zip(rows, model.columns):
        assert _pg_type(r) == _model_type(col), f"{table}.{col.name}"
        assert (r.is_nullable == "NO") == (not col.nullable), f"{table}.{col.name} nullability"


def test_pg_catalog_fully_mapped(pg):
    assert _scalar(pg, "SELECT count(*) FROM ai_use_case_catalog") == 57
    assert _scalar(pg, "SELECT count(*) FROM ai_use_case_catalog WHERE billing_feature_key IS NULL") == 0
    assert _scalar(pg, "SELECT count(*) FROM ai_use_case_catalog c WHERE NOT EXISTS "
                       "(SELECT 1 FROM ai_billing_feature f WHERE f.feature_key = c.billing_feature_key)") == 0
    assert _scalar(pg, "SELECT count(*) FROM ai_billing_feature") == 24
    assert _scalar(pg, "SELECT string_agg(feature_key, ',' ORDER BY feature_key) FROM ai_billing_feature "
                       "WHERE locked") == "ai_calling,telephony"
    # a pre-existing mapping is never overwritten by a re-run
    from sqlalchemy import text
    with pg.begin() as c:
        c.execute(text("UPDATE ai_use_case_catalog SET billing_feature_key = 'unmapped' WHERE use_case = 'copilot'"))
    _run_script(pg, _migration_file("V588").read_text(encoding="utf-8"))
    try:
        assert _scalar(pg, "SELECT billing_feature_key FROM ai_use_case_catalog WHERE use_case = 'copilot'") == "unmapped"
    finally:
        with pg.begin() as c:
            c.execute(text("UPDATE ai_use_case_catalog SET billing_feature_key = 'copilot' WHERE use_case = 'copilot'"))


def test_pg_seeded_ai_pro_is_one_valid_draft(pg):
    assert _scalar(pg, "SELECT count(*) FROM ai_plan") == 1
    assert _scalar(pg, "SELECT count(*) FROM ai_plan_version v JOIN ai_plan p ON p.id = v.plan_id "
                       "WHERE p.plan_key = 'ai_pro' AND v.version_no = 1 AND v.status = 'DRAFT' "
                       "AND v.price_minor = 500000 AND v.allowance_credits = 2000 "
                       "AND v.internal_cost_cap_usd = 13.95") == 1
    assert _scalar(pg, "SELECT count(*) FROM ai_plan_item") == 24          # not doubled by the re-run
    assert _scalar(pg, "SELECT count(*) FROM ai_plan_item i JOIN ai_billing_feature f USING (feature_key) "
                       "WHERE f.eligibility = 'ALWAYS_CHARGED' AND i.mode <> 'CHARGED'") == 0
    assert _scalar(pg, "SELECT count(*) FROM ai_plan_item i JOIN ai_billing_feature f USING (feature_key) "
                       "WHERE f.eligibility = 'ALLOWANCE_ONLY' AND i.mode = 'INCLUDED'") == 0
    assert _scalar(pg, "SELECT user_cap_basis FROM ai_plan_item WHERE feature_key = 'learner_analytics'") == "SUBJECT"
    assert _scalar(pg, "SELECT array_to_string(roles_included, ',') FROM ai_plan_item "
                       "WHERE feature_key = 'tutor_chat'") == "LEARNER"
    assert _scalar(pg, "SELECT count(*) FROM institute_ai_subscription") == 0


def _new_version(pg, status_after="PUBLISHED"):
    """A fresh plan + version (DRAFT, one item), optionally published. Returns (plan_id, version_id)."""
    from sqlalchemy import text

    with pg.begin() as c:
        pid = c.execute(text("INSERT INTO ai_plan (plan_key, name, created_by) VALUES (:k, 'T', 't') RETURNING id"),
                        {"k": f"t_{uuid.uuid4().hex[:8]}"}).scalar()
        vid = c.execute(text("INSERT INTO ai_plan_version (plan_id, version_no, price_minor, allowance_credits) "
                             "VALUES (:p, 1, 100000, 10) RETURNING id"), {"p": pid}).scalar()
        c.execute(text("INSERT INTO ai_plan_item (plan_version_id, feature_key, mode) VALUES (:v, 'kb_qa', 'INCLUDED')"),
                  {"v": vid})
        if status_after == "PUBLISHED":
            c.execute(text("UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now(), published_by = 't' "
                           "WHERE id = :v"), {"v": vid})
    return pid, vid


def test_pg_draft_versions_and_items_are_editable(pg):
    _, vid = _new_version(pg, status_after="DRAFT")
    assert _refused(pg, "UPDATE ai_plan_version SET price_minor = 123, grace_days = 3 WHERE id = :v", v=vid) is None
    assert _refused(pg, "UPDATE ai_plan_item SET inst_units_cap = 5 WHERE plan_version_id = :v", v=vid) is None
    assert _refused(pg, "INSERT INTO ai_plan_item (plan_version_id, feature_key, mode) "
                        "VALUES (:v, 'copilot', 'INCLUDED')", v=vid) is None
    assert _refused(pg, "DELETE FROM ai_plan_item WHERE plan_version_id = :v AND feature_key = 'copilot'", v=vid) is None
    assert _scalar(pg, "SELECT price_minor FROM ai_plan_version WHERE id = :v", v=vid) == 123
    # DRAFT -> PUBLISHED is allowed (sets published_* in the same statement)
    assert _refused(pg, "UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now() WHERE id = :v",
                    v=vid) is None


def test_pg_published_version_terms_and_items_are_frozen(pg):
    _, vid = _new_version(pg)
    for stmt in ("UPDATE ai_plan_version SET price_minor = 1 WHERE id = :v",
                 "UPDATE ai_plan_version SET allowance_credits = 99999 WHERE id = :v",
                 "UPDATE ai_plan_version SET status = 'DRAFT' WHERE id = :v",
                 "UPDATE ai_plan_version SET status = 'RETIRED', price_minor = 1 WHERE id = :v",
                 "DELETE FROM ai_plan_version WHERE id = :v",
                 "UPDATE ai_plan_item SET mode = 'CHARGED' WHERE plan_version_id = :v",
                 "UPDATE ai_plan_item SET inst_units_cap = 1 WHERE plan_version_id = :v",
                 "DELETE FROM ai_plan_item WHERE plan_version_id = :v",
                 "INSERT INTO ai_plan_item (plan_version_id, feature_key, mode) VALUES (:v, 'copilot', 'INCLUDED')"):
        err = _refused(pg, stmt, v=vid)
        assert err and ("frozen" in err or "cannot" in err), (stmt, err)
    assert _scalar(pg, "SELECT price_minor FROM ai_plan_version WHERE id = :v", v=vid) == 100000
    assert _scalar(pg, "SELECT count(*) FROM ai_plan_item WHERE plan_version_id = :v AND mode = 'INCLUDED'",
                   v=vid) == 1
    # moving an item OUT of a draft INTO a published version is refused too
    _, draft = _new_version(pg, status_after="DRAFT")
    assert _refused(pg, "UPDATE ai_plan_item SET plan_version_id = :v WHERE plan_version_id = :d", v=vid, d=draft)
    # touching updated_at alone is harmless and allowed
    assert _refused(pg, "UPDATE ai_plan_version SET updated_at = now() WHERE id = :v", v=vid) is None


def test_pg_published_to_retired_then_final(pg):
    _, vid = _new_version(pg)
    assert _refused(pg, "UPDATE ai_plan_version SET status = 'RETIRED' WHERE id = :v", v=vid) is None
    assert _scalar(pg, "SELECT status FROM ai_plan_version WHERE id = :v", v=vid) == "RETIRED"
    for stmt in ("UPDATE ai_plan_version SET status = 'PUBLISHED' WHERE id = :v",
                 "UPDATE ai_plan_version SET status = 'DRAFT' WHERE id = :v",
                 "UPDATE ai_plan_version SET price_minor = 5 WHERE id = :v",
                 "DELETE FROM ai_plan_version WHERE id = :v",
                 "UPDATE ai_plan_item SET mode = 'CHARGED' WHERE plan_version_id = :v"):
        assert _refused(pg, stmt, v=vid), stmt


def test_pg_one_live_subscription_per_institute(pg):
    from sqlalchemy import text

    _, vid = _new_version(pg)
    inst = f"inst-{uuid.uuid4().hex[:6]}"
    ins = ("INSERT INTO institute_ai_subscription (institute_id, plan_version_id, status, anchor_at, start_at, "
           "created_by) VALUES (:i, :v, :s, now(), now(), 't') RETURNING id")
    with pg.begin() as c:
        sid = c.execute(text(ins), {"i": inst, "v": vid, "s": "ACTIVE"}).scalar()
        c.execute(text(ins), {"i": inst, "v": vid, "s": "EXPIRED"})
        c.execute(text(ins), {"i": inst, "v": vid, "s": "SCHEDULED"})
    for s in ("ACTIVE", "TRIAL", "GRACE"):
        err = _refused(pg, ins, i=inst, v=vid, s=s)
        assert err and "ux_ias_live" in err, (s, err)
    assert _refused(pg, ins, i=inst + "-other", v=vid, s="ACTIVE") is None
    with pg.begin() as c:
        c.execute(text("UPDATE institute_ai_subscription SET status = 'CANCELLED' WHERE id = :s"), {"s": sid})
    assert _refused(pg, ins, i=inst, v=vid, s="TRIAL") is None
    assert _scalar(pg, "SELECT count(*) FROM institute_ai_subscription WHERE institute_id = :i "
                       "AND status IN ('TRIAL','ACTIVE','GRACE')", i=inst) == 1
    # one active override per (subscription, feature); allowance_used never negative
    with pg.begin() as c:
        live = c.execute(text("SELECT id FROM institute_ai_subscription WHERE institute_id = :i AND status = 'TRIAL'"),
                         {"i": inst}).scalar()
        c.execute(text("INSERT INTO ai_subscription_override (subscription_id, feature_key, mode, reason, created_by) "
                       "VALUES (:s, 'kb_qa', 'CHARGED', 'r', 't')"), {"s": live})
    err = _refused(pg, "INSERT INTO ai_subscription_override (subscription_id, feature_key, reason, created_by) "
                       "VALUES (:s, 'kb_qa', 'r', 't')", s=live)
    assert err and "ux_aso_active" in err
    with pg.begin() as c:
        pid = c.execute(text("INSERT INTO ai_subscription_period (subscription_id, period_start, period_end, "
                             "plan_version_id, price_minor_snapshot, allowance_credits) VALUES "
                             "(:s, now(), now() + interval '1 month', :v, 100000, 10) "
                             "ON CONFLICT (subscription_id, period_start) DO NOTHING RETURNING id"),
                        {"s": live, "v": vid}).scalar()
    assert pid is not None
    assert _refused(pg, "UPDATE ai_subscription_period SET allowance_used = -1 WHERE id = :p", p=pid)
