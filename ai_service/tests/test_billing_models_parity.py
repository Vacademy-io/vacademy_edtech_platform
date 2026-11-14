"""Parity between the AI plan payments / storefront SQLAlchemy models
(services/metering/billing_models.py), the admin_core JPA entities of the platform
billing tables, and the Flyway migration that owns them all
(V590__ai_plan_payments_storefront.sql).

Offline (always):
  * per new ai_* table: column names and order, SQL types, NOT NULL, server
    defaults, primary key, CHECK constraints, indexes (name, uniqueness, columns
    or expressions, partial WHERE) and the documented foreign keys;
  * the V590 columns on ai_plan / ai_billing_feature match the Core views;
  * vocabularies fit their columns; the migration is additive and guarded
    (IF NOT EXISTS everywhere, lock_timeout, hot tables last);
  * the models create on SQLite and the partial unique indexes behave.

On a REAL Postgres 16 (skipped unless AI_LIMITS_PG_URL or AI_LIMITS_PGDATA is set;
AI_LIMITS_PG_TEMPLATE=<db> clones a template such as 'prodbase' or a template that
already holds prod's platform_* tables). Missing platform_* tables are created
from PLATFORM_STUBS (prod DDL dumped read-only on 2026-10-16), missing plan tables
from V586..V588; then V590 runs TWICE (Flyway-like, one transaction each):
  * information_schema matches the models AND the JPA entities' @Column lists;
  * pack-less CREDIT_PACK item refused, AI_SUBSCRIPTION item without a pack OK,
    legacy inserts (pre-V590 column lists) still work and get the old behaviour;
  * one non-VOID PERIOD charge per (subscription, service_start); one open
    UPGRADE; unique vendor_payment_id on charges and on platform_payment;
    amounts / currency checks; idempotency key;
  * institute_ai_subscription.status is VARCHAR(16), PENDING never counts as live,
    one PENDING per institute;
  * mandates, audience, billing profile, credit note and number-sequence checks;
  * a duplicate platform_payment.vendor_payment_id present BEFORE V590 does not
    fail the migration: the index is built without it.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_billing_models_parity.py -q -p no:cacheprovider
  AI_LIMITS_PGDATA=<dir> AI_LIMITS_PG_TEMPLATE=prodbase <venv>/bin/python -m pytest \
      ai_service/tests/test_billing_models_parity.py -q -p no:cacheprovider
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
from sqlalchemy.dialects.postgresql import JSONB, UUID  # noqa: E402

from ai_service.app.services.metering import billing_models as bm  # noqa: E402
from ai_service.app.services.metering import plan_models as pm  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "admin_core_service/src/main/resources/db/migration"
ENTITIES = ROOT / "admin_core_service/src/main/java/vacademy/io/admin_core_service/features/platform_billing/entity"
TABLES = ("ai_institute_segment", "ai_storefront_audience", "ai_storefront_institute", "ai_subscription_mandate",
          "ai_subscription_charge")
MODELS = {m.__tablename__: m for m in (bm.AiInstituteSegment, bm.AiStorefrontAudience, bm.AiStorefrontInstitute,
                                       bm.AiSubscriptionMandate, bm.AiSubscriptionCharge)}
#: JPA entity file -> table (the admin_core-owned side of V590)
JPA = {"PlatformPayment": "platform_payment", "PlatformPaymentItem": "platform_payment_item",
       "PlatformPaymentConfig": "platform_payment_config", "PlatformInvoice": "platform_invoice",
       "PlatformBillingProfile": "platform_billing_profile", "PlatformCreditNote": "platform_credit_note",
       "PlatformDocumentSequence": "platform_document_sequence"}

_TYPE_RE = r"VARCHAR\(\d+\)|NUMERIC\(\d+,\s*\d+\)|TEXT\[\]|TIMESTAMPTZ|TIMESTAMP|BOOLEAN|UUID|JSONB|TEXT|BIGINT|INT"


# ── migration parsing ────────────────────────────────────────────────────────

def _migration_file():
    hits = sorted(MIGRATIONS.glob("V*__ai_plan_payments_storefront.sql")) if MIGRATIONS.is_dir() else []
    return hits[0] if hits else None


@pytest.fixture(scope="module")
def raw_sql():
    f = _migration_file()
    if f is None:
        pytest.skip("V590 ai_plan_payments_storefront migration not in this checkout")
    return f.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def sql(raw_sql):
    return re.sub(r"--[^\n]*", "", raw_sql)


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


def _norm_type(t):
    t = t.lower().replace(" ", "")
    return {"timestamptz": "timestamptz", "int": "int"}.get(t, t)


def _parse_table(sql, table):
    m = re.search(rf"CREATE TABLE IF NOT EXISTS {table}\s*\((.*?)\n\);", sql, re.S)
    assert m, f"CREATE TABLE IF NOT EXISTS {table} not found"
    cols, pk, checks, uniques, fks = {}, [], {}, [], {}
    for p in _split_top_level(m.group(1)):
        cm = re.match(r"CONSTRAINT (\w+) CHECK \((.*)\)$", p, re.I)
        if cm:
            checks[cm.group(1)] = " ".join(cm.group(2).split())
            continue
        pm_ = re.match(r"PRIMARY KEY \((.*)\)$", p, re.I)
        if pm_:
            pk = [c.strip().lower() for c in pm_.group(1).split(",")]
            continue
        assert not re.match(r"(CONSTRAINT|CHECK|FOREIGN|UNIQUE)\b", p, re.I), f"unhandled clause in {table}: {p}"
        tm = re.match(rf"(\w+)\s+({_TYPE_RE})(.*)$", p, re.I)
        assert tm, f"unparsed column in {table}: {p}"
        name, sql_type, rest = tm.group(1).lower(), _norm_type(tm.group(2)), tm.group(3)
        dm = re.search(r"\bDEFAULT\s+('(?:[^']|'')*'|\w+\(\)|[\w.]+)", rest, re.I)
        cols[name] = {"type": sql_type,
                      "not_null": bool(re.search(r"\bNOT NULL\b|\bPRIMARY KEY\b", rest, re.I)),
                      "default": _norm_default(dm.group(1) if dm else None)}
        if re.search(r"\bPRIMARY KEY\b", rest, re.I):
            pk.append(name)
        if re.search(r"\bUNIQUE\b", rest, re.I):
            uniques.append((name,))
        fm = re.search(r"\bREFERENCES (\w+)\((\w+)\)", rest, re.I)
        if fm:
            fks[name] = f"{fm.group(1).lower()}.{fm.group(2).lower()}"
    return cols, pk, checks, sorted(uniques), fks


def _norm_expr(e):
    return " ".join(e.replace("( ", "(").replace(" )", ")").split()).lower()


def _parse_indexes(sql, table):
    out = {}
    flat = " ".join(sql.split())
    for m in re.finditer(rf"CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON {table}\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)"
                         rf"\s*(?:WHERE (.*?))?;", flat):
        cols = [_norm_expr(c) for c in _split_top_level(m.group(3))]
        out[m.group(2)] = {"unique": bool(m.group(1)), "cols": cols,
                           "where": " ".join(m.group(4).split()) if m.group(4) else None}
    return out


def _parse_added_columns(sql, table):
    """Columns added by ALTER TABLE <table> ADD COLUMN IF NOT EXISTS ... (in order)."""
    cols = {}
    for m in re.finditer(rf"ALTER TABLE {table}\s+(ADD COLUMN IF NOT EXISTS .*?);", sql, re.S):
        for part in _split_top_level(m.group(1)):
            am = re.match(rf"ADD COLUMN IF NOT EXISTS (\w+)\s+({_TYPE_RE})(.*)$", part, re.I)
            assert am, f"unparsed ADD COLUMN on {table}: {part}"
            dm = re.search(r"\bDEFAULT\s+('(?:[^']|'')*'|\w+\(\)|[\w.]+)", am.group(3), re.I)
            cols[am.group(1).lower()] = {"type": _norm_type(am.group(2)),
                                         "not_null": bool(re.search(r"\bNOT NULL\b", am.group(3), re.I)),
                                         "default": _norm_default(dm.group(1) if dm else None)}
    return cols


# ── model introspection ──────────────────────────────────────────────────────

def _model_type(col):
    t = col.type
    t = getattr(t, "impl", t)
    if isinstance(t, UUID):
        return "uuid"
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


# ── offline tests ────────────────────────────────────────────────────────────

def test_migration_is_v590_additive_and_guarded(raw_sql, sql):
    f = _migration_file()
    assert f.name == "V590__ai_plan_payments_storefront.sql"
    assert len(list(MIGRATIONS.glob("V590__*.sql"))) == 1, "Flyway version collision"
    assert re.search(r"SET LOCAL lock_timeout = '5s';", sql)
    assert "${" not in sql, "Flyway placeholder syntax must not appear"
    created = re.findall(r"CREATE TABLE (IF NOT EXISTS )?(\w+)", sql)
    assert all(g[0] for g in created), "every CREATE TABLE is IF NOT EXISTS"
    assert {g[1] for g in created} == set(TABLES) | {"platform_billing_profile", "platform_document_sequence",
                                                    "platform_credit_note"}
    assert all("IF NOT EXISTS" in m for m in re.findall(r"(?<!')CREATE (?:UNIQUE )?INDEX[^;']*?ON", sql)), \
        "every index is IF NOT EXISTS (the guarded vendor index is built in a DO block)"
    for m in re.findall(r"ADD COLUMN [^,;]*", sql):
        assert m.startswith("ADD COLUMN IF NOT EXISTS"), m
    # nothing destructive, no rewrite of existing rows
    for bad in (r"\bDROP TABLE\b", r"\bDROP COLUMN\b", r"\bTRUNCATE\b", r"\bDELETE FROM\b", r"UPDATE platform_",
                r"UPDATE institute", r"\bRENAME\b", r"institutes\b"):
        assert not re.search(bad, sql, re.I), bad
    # the only data change: the admin_assistant tenant label, never overwriting a set one
    updates = re.findall(r"UPDATE (\w+)", sql)
    assert updates == ["ai_billing_feature"]
    assert re.search(r"WHERE feature_key = 'admin_assistant'\s+AND tenant_label IS NULL;", sql)
    assert "Vacademy" not in re.search(r"SET tenant_label = '([^']*)'", sql).group(1)
    # hot billing tables are altered last (after every CREATE TABLE)
    last_create = max(m.end() for m in re.finditer(r"CREATE TABLE IF NOT EXISTS", sql))
    for hot in ("ALTER TABLE platform_payment_item", "ALTER TABLE platform_payment\n",
                "ALTER TABLE institute_ai_subscription"):
        assert sql.find(hot) > last_create, hot
    assert re.search(r"ALTER TABLE institute_ai_subscription ALTER COLUMN status TYPE VARCHAR\(16\);", sql)
    assert re.search(r"ALTER TABLE platform_payment_item ALTER COLUMN pack_id DROP NOT NULL;", sql)
    assert "CHECK (item_kind <> 'CREDIT_PACK' OR pack_id IS NOT NULL)" in sql
    # duplicate-tolerant unique vendor_payment_id
    assert "ux_platform_payment_vendor_payment" in sql and "RAISE WARNING" in sql
    # never a colon cast in this file (Java-side habit; the DO blocks run through JDBC too)
    assert "::" not in sql


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
    assert uniques == [], f"{table}: uniqueness lives in named indexes"
    assert not model.foreign_keys, "no SQLAlchemy FKs across MetaData (see billing_models docstring)"
    assert fks == bm.DB_FOREIGN_KEYS.get(table, {}), f"{table} foreign keys"


def test_check_constraints_match(sql):
    for table in TABLES:
        checks = _parse_table(sql, table)[2]
        model_checks = {c.name: " ".join(str(c.sqltext).split())
                        for c in MODELS[table].__table__.constraints if c.__class__.__name__ == "CheckConstraint"}
        assert model_checks == checks, table


@pytest.mark.parametrize("table", TABLES)
def test_indexes_match(sql, table):
    exp = _parse_indexes(sql, table)
    got = {}
    for idx in MODELS[table].__table__.indexes:
        where = idx.dialect_options["postgresql"].get("where")
        cols = [_norm_expr(e.name if hasattr(e, "name") and not hasattr(e, "text") else str(e))
                for e in idx.expressions]
        got[idx.name] = {"unique": bool(idx.unique), "cols": cols,
                         "where": " ".join(str(where).split()) if where is not None else None}
        sw = idx.dialect_options["sqlite"].get("where")
        assert (str(sw) if sw is not None else None) == (str(where) if where is not None else None), idx.name
    assert got == exp, table


def test_v590_columns_on_v588_tables_match_core_views(sql):
    for table, view in (("ai_plan", bm.PLAN_LISTING_TABLE), ("ai_billing_feature", bm.FEATURE_LABEL_TABLE)):
        added = _parse_added_columns(sql, table)
        mine = [c for c in view.columns if not c.primary_key]
        assert [c.name for c in mine] == list(added), table
        for c in mine:
            exp = added[c.name]
            assert _model_type(c) == exp["type"], f"{table}.{c.name}"
            assert (not c.nullable) == exp["not_null"], f"{table}.{c.name}"
            assert _model_default(c) == exp["default"], f"{table}.{c.name}"
        # the V588 models are untouched: none of these columns leaked into PlansBase
        base = pm.PlansBase.metadata.tables[table]
        assert not set(added) & {c.name for c in base.columns}, table
    name, expr = bm.PLAN_HIGHLIGHTS_CHECK
    assert f"ADD CONSTRAINT {name}\n            CHECK ({expr})" in sql
    idx = _parse_indexes(sql, "institute_ai_subscription")
    n, cols, where = bm.SUBSCRIPTION_PENDING_INDEX
    assert idx == {n: {"unique": True, "cols": list(cols), "where": where}}
    # the SQLite DDL helper adds exactly the V590 columns
    sqlite_cols = [re.match(r"ALTER TABLE (\w+) ADD COLUMN (\w+)", s).groups() for s in bm.SQLITE_V590_DDL
                   if s.startswith("ALTER")]
    assert sqlite_cols == [("ai_billing_feature", "tenant_label")] + [("ai_plan", c) for c in
                                                                      _parse_added_columns(sql, "ai_plan")]


def test_vocabularies_fit_the_columns():
    for vocab, width in ((pm.SUBSCRIPTION_STATUSES, bm.W_SUB_STATUS_V590), (bm.CHARGE_KINDS, bm.W_CHARGE_KIND),
                         (bm.CHARGE_STATUSES, bm.W_CHARGE_STATUS), (bm.MANDATE_METHODS, bm.W_MANDATE_METHOD),
                         (bm.MANDATE_STATUSES, bm.W_MANDATE_STATUS), (bm.AUDIENCE_RULES, bm.W_AUDIENCE_RULE),
                         (bm.AUDIENCE_MODES, bm.W_AUDIENCE_MODE), (bm.BRAND_MODES, bm.W_BRAND_MODE),
                         (bm.TAX_HEADS, bm.W_TAX_HEAD), (pm.PAYMENT_STATUSES, pm.W_PAYMENT_STATUS)):
        assert max(len(v) for v in vocab) <= width, vocab
    c = bm.CHARGE_TABLE.c
    assert c.kind.type.length == bm.W_CHARGE_KIND and c.status.type.length == bm.W_CHARGE_STATUS
    assert c.tax_head.type.length == bm.W_TAX_HEAD and c.institute_id.type.length == bm.W_INSTITUTE
    m = bm.MANDATE_TABLE.c
    assert m.status.type.length == bm.W_MANDATE_STATUS and m.method.type.length == bm.W_MANDATE_METHOD
    assert bm.AUDIENCE_TABLE.c.rule.type.length == bm.W_AUDIENCE_RULE
    assert bm.PLAN_LISTING_TABLE.c.audience_mode.type.length == bm.W_AUDIENCE_MODE
    assert bm.STOREFRONT_INSTITUTE_TABLE.c.brand_mode_override.type.length == bm.W_BRAND_MODE
    assert bm.SEGMENT_TABLE.c.segment_key.type.length == bm.W_SEGMENT_KEY
    assert "PENDING" in pm.SUBSCRIPTION_STATUSES and "PENDING" not in pm.LIVE_STATUSES
    assert len("PENDING_PAYMENT") <= bm.W_SUB_STATUS_V590      # critique #3: either name fits after V590
    assert set(bm.CHARGE_OPEN_STATUSES) <= set(bm.CHARGE_STATUSES)
    assert set(bm.CHARGE_PAID_STATUSES) <= set(bm.CHARGE_STATUSES)
    assert bm.CHARGE_CURRENCY == "INR" and bm.DEFAULT_SUBSCRIPTION_SAC_CODE == "998315"
    assert bm.AUTOPAY_AFA_FREE_MAX_MINOR == 15_000 * 100
    # ux_asc_open_upgrade covers exactly the open statuses
    upgrade_idx = next(i for i in bm.CHARGE_TABLE.indexes if i.name == "ux_asc_open_upgrade")
    where = str(upgrade_idx.dialect_options["postgresql"]["where"])
    assert set(re.findall(r"'(\w+)'", where)) - {"UPGRADE"} == set(bm.CHARGE_OPEN_STATUSES)


def test_models_create_on_sqlite_and_partial_unique_indexes_behave():
    import datetime as dt

    from sqlalchemy import create_engine, insert, update
    from sqlalchemy.exc import IntegrityError

    eng = create_engine("sqlite://")
    plans = MetaData()
    for t in pm.PlansBase.metadata.tables.values():
        tt = t.to_metadata(plans)
        for c in tt.columns:
            c.server_default = None
    plans.create_all(eng)
    bm.create_sqlite_billing_schema(eng)
    md = bm.stripped_billing_metadata()
    C, M, A = md.tables["ai_subscription_charge"], md.tables["ai_subscription_mandate"], \
        md.tables["ai_storefront_audience"]
    now = dt.datetime(2026, 10, 16, tzinfo=dt.timezone.utc)
    nxt = now + dt.timedelta(days=30)
    base = dict(subscription_id="s1", institute_id="i1", kind="PERIOD", status="DUE", service_start=now,
                service_end=nxt, plan_version_id="v1", currency="INR", is_tax_inclusive=False, base_minor=500000,
                debit_attempts=0, refunded_minor=0, created_at=now, updated_at=now)
    with eng.begin() as c:
        c.execute(insert(C).values(id="c1", **base))
    with pytest.raises(IntegrityError):                       # second live PERIOD charge, period_id NULL
        with eng.begin() as c:
            c.execute(insert(C).values(id="c2", **base))
    with eng.begin() as c:
        c.execute(update(C).where(C.c.id == "c1").values(status="VOID"))
        c.execute(insert(C).values(id="c3", **base))          # replacement after VOID
        c.execute(insert(C).values(id="u1", **{**base, "kind": "UPGRADE"}))
    with pytest.raises(IntegrityError):                       # second open upgrade
        with eng.begin() as c:
            c.execute(insert(C).values(id="u2", **{**base, "kind": "UPGRADE", "status": "LINK_SENT"}))
    with pytest.raises(IntegrityError):                       # total must equal base + tax
        with eng.begin() as c:
            c.execute(update(C).where(C.c.id == "c3").values(tax_minor=90000, total_minor=590001))
    with pytest.raises(IntegrityError):                       # INR only
        with eng.begin() as c:
            c.execute(insert(C).values(id="c4", **{**base, "currency": "USD", "service_start": nxt,
                                                   "service_end": nxt + dt.timedelta(days=30)}))
    with eng.begin() as c:
        c.execute(update(C).where(C.c.id == "c3").values(tax_minor=90000, total_minor=590000,
                                                         vendor_payment_id="pay_1"))
    with pytest.raises(IntegrityError):                       # a payment pays one charge
        with eng.begin() as c:
            c.execute(update(C).where(C.c.id == "u1").values(vendor_payment_id="pay_1"))
    mb = dict(institute_id="i1", subscription_id="s1", status="ACTIVE", created_at=now, updated_at=now)
    with eng.begin() as c:
        c.execute(insert(M).values(id="m1", token_id="token_1", **mb))
        c.execute(insert(M).values(id="m0", **{**mb, "status": "PENDING"}))
    with pytest.raises(IntegrityError):                       # one usable mandate per subscription
        with eng.begin() as c:
            c.execute(insert(M).values(id="m2", token_id="token_2", **mb))
    ab = dict(rule="INCLUDE", is_active=True, created_by="t", created_at=now)
    with eng.begin() as c:
        c.execute(insert(A).values(id="a1", plan_id=None, institute_id="i1", **ab))
        c.execute(insert(A).values(id="a2", plan_id="p1", institute_id="i1", **ab))
    with pytest.raises(IntegrityError):                       # NULL plan_id rows are still unique
        with eng.begin() as c:
            c.execute(insert(A).values(id="a3", plan_id=None, institute_id="i1", **ab))
    with pytest.raises(IntegrityError):                       # institute XOR segment
        with eng.begin() as c:
            c.execute(insert(A).values(id="a4", plan_id=None, institute_id="i2", segment_key="pilot", **ab))
    # the V590 columns on the V588 tables exist on SQLite too
    with eng.begin() as c:
        cols = {r[1] for r in c.exec_driver_sql("PRAGMA table_info(ai_plan)")}
        assert {"listed", "audience_mode", "highlights", "sort_order"} <= cols
        assert "tenant_label" in {r[1] for r in c.exec_driver_sql("PRAGMA table_info(ai_billing_feature)")}


# ── JPA entities (admin_core side) ───────────────────────────────────────────

def _entity_columns(name):
    """{column: nullable_false} from a JPA entity's @Column / @Id fields."""
    body = (ENTITIES / f"{name}.java").read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r"@Column\(([^)]*)\)", body):
        args = m.group(1)
        col = re.search(r'name\s*=\s*"(\w+)"', args).group(1)
        out[col] = bool(re.search(r"nullable\s*=\s*false", args))
    if re.search(r"@Id\s+@UuidGenerator\s+private String id;", body):
        out["id"] = True
    return out


def test_jpa_entities_declare_the_v590_columns(sql):
    pay = _entity_columns("PlatformPayment")
    for col in ("buyer_legal_name", "buyer_gstin", "buyer_state_code", "buyer_address", "place_of_supply",
                "tax_head", "brand_mode", "disposition", "refund_requested_at", "refunded_amount_minor",
                "link_expires_at"):
        assert col in pay, col
        assert re.search(rf"ALTER TABLE platform_payment\b.*ADD COLUMN IF NOT EXISTS {col}\b", sql, re.S), col
    item = _entity_columns("PlatformPaymentItem")
    assert item["pack_id"] is False, "pack_id is nullable after V590"
    for col in ("item_kind", "subscription_charge_id", "description_snapshot"):
        assert col in item
    body = (ENTITIES / "PlatformPayment.java").read_text(encoding="utf-8")
    # NOT NULL DEFAULT columns are initialised in Java, so code that never sets them keeps working
    assert "disposition = PlatformPaymentDisposition.NORMAL" in body and "refundedAmountMinor = 0L" in body
    assert "itemKind = PlatformPaymentItemKind.CREDIT_PACK" in (ENTITIES / "PlatformPaymentItem.java").read_text()
    cfg = (ENTITIES / "PlatformPaymentConfig.java").read_text(encoding="utf-8")
    assert 'tradeName = "Vacademy"' in cfg and 'neutralDisplayName = "Vidyayatan Technologies"' in cfg
    assert "sourceKind = PlatformPaymentItemKind.CREDIT_PACK" in (ENTITIES / "PlatformInvoice.java").read_text()


# ── real Postgres ────────────────────────────────────────────────────────────

# prod DDL of the platform billing tables (dumped read-only 2026-10-16), for a
# database that does not already have them (IF NOT EXISTS: a template that holds
# prod's tables is used as is)
PLATFORM_STUBS = """
CREATE TABLE IF NOT EXISTS credit_pack (
  id VARCHAR(255) PRIMARY KEY, code VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(128) NOT NULL,
  credits NUMERIC(12,2) NOT NULL, hsn_sac_code VARCHAR(8) NOT NULL DEFAULT '998313',
  display_order INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE, badge VARCHAR(32), metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_payment_config (
  id VARCHAR(255) PRIMARY KEY, singleton_lock BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
  vendor VARCHAR(32) NOT NULL DEFAULT 'RAZORPAY', api_key VARCHAR(255) NOT NULL, key_secret_encrypted TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL, supplier_legal_name VARCHAR(255) NOT NULL, supplier_gstin VARCHAR(15),
  supplier_state_code VARCHAR(2) NOT NULL, supplier_address TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_payment_config_singleton_chk CHECK (singleton_lock = TRUE));
CREATE TABLE IF NOT EXISTS platform_payment (
  id VARCHAR(255) PRIMARY KEY, institute_id VARCHAR(255) NOT NULL, buyer_user_id VARCHAR(255),
  vendor VARCHAR(32) NOT NULL DEFAULT 'RAZORPAY', vendor_order_id VARCHAR(64) UNIQUE, vendor_payment_id VARCHAR(64),
  currency VARCHAR(3) NOT NULL, base_amount_minor BIGINT NOT NULL, tax_amount_minor BIGINT NOT NULL DEFAULT 0,
  total_amount_minor BIGINT NOT NULL, status VARCHAR(32) NOT NULL, payment_status VARCHAR(32) NOT NULL,
  payment_specific_data JSONB, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_platform_payment_vendor_payment ON platform_payment (vendor_payment_id);
CREATE TABLE IF NOT EXISTS platform_payment_item (
  id VARCHAR(255) PRIMARY KEY,
  platform_payment_id VARCHAR(255) NOT NULL REFERENCES platform_payment(id) ON DELETE CASCADE,
  pack_id VARCHAR(255) NOT NULL REFERENCES credit_pack(id), pack_code_snapshot VARCHAR(64) NOT NULL,
  credits NUMERIC(12,2) NOT NULL, currency VARCHAR(3) NOT NULL, base_amount_minor BIGINT NOT NULL,
  tax_rate_bps INT NOT NULL, tax_amount_minor BIGINT NOT NULL, total_amount_minor BIGINT NOT NULL,
  hsn_sac_snapshot VARCHAR(8) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS platform_invoice (
  id VARCHAR(255) PRIMARY KEY, platform_payment_id VARCHAR(255) NOT NULL UNIQUE REFERENCES platform_payment(id),
  invoice_number VARCHAR(64) NOT NULL UNIQUE, supplier_legal_name VARCHAR(255) NOT NULL,
  supplier_gstin VARCHAR(15), supplier_state_code VARCHAR(2) NOT NULL, supplier_address TEXT NOT NULL,
  buyer_institute_id VARCHAR(255) NOT NULL, buyer_legal_name VARCHAR(255) NOT NULL, buyer_gstin VARCHAR(15),
  buyer_state_code VARCHAR(2), buyer_address TEXT, place_of_supply VARCHAR(2) NOT NULL,
  is_export BOOLEAN NOT NULL DEFAULT FALSE, currency VARCHAR(3) NOT NULL, base_amount_minor BIGINT NOT NULL,
  cgst_amount_minor BIGINT NOT NULL DEFAULT 0, sgst_amount_minor BIGINT NOT NULL DEFAULT 0,
  igst_amount_minor BIGINT NOT NULL DEFAULT 0, total_amount_minor BIGINT NOT NULL, pdf_s3_url TEXT,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
"""

PLAN_STUBS = """
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64));
"""

# exactly the columns today's (pre-V590) Java code writes: must keep working after V590
LEGACY_PAYMENT_INSERT = (
    "INSERT INTO platform_payment (id, institute_id, buyer_user_id, vendor, vendor_order_id, vendor_payment_id, "
    "currency, base_amount_minor, tax_amount_minor, total_amount_minor, status, payment_status, payment_specific_data) "
    "VALUES (:id, 'inst-legacy', 'u1', 'RAZORPAY', :o, NULL, 'INR', 100000, 18000, 118000, 'INITIATED', "
    "'PAYMENT_PENDING', NULL)")
LEGACY_ITEM_INSERT = (
    "INSERT INTO platform_payment_item (id, platform_payment_id, pack_id, pack_code_snapshot, credits, currency, "
    "base_amount_minor, tax_rate_bps, tax_amount_minor, total_amount_minor, hsn_sac_snapshot) "
    "VALUES (:id, :p, :pack, 'STARTER', 500, 'INR', 100000, 1800, 18000, 118000, '998313')")


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
    """Run a whole migration file in ONE transaction, like Flyway (raw cursor, no parameters)."""
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


def _db_url(base, name):
    return base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"


def _prepare(engine):
    """platform_* (stubs when absent) + V586..V588 when absent; returns the ids of seeded legacy rows."""
    from sqlalchemy import text

    with engine.begin() as c:
        has_plans = c.execute(text("SELECT to_regclass('ai_plan') IS NOT NULL")).scalar()
    _run_script(engine, PLATFORM_STUBS)
    if not has_plans:
        _run_script(engine, PLAN_STUBS)
        for prefix in ("V586", "V587", "V588"):
            hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
            if not hits:
                pytest.skip(f"{prefix} migration not in this checkout")
            _run_script(engine, hits[0].read_text(encoding="utf-8"))
    pack = f"pack-{uuid.uuid4().hex[:8]}"
    pay = str(uuid.uuid4())
    with engine.begin() as c:   # a pre-V590 pack purchase, written the way today's code writes it
        c.execute(text("INSERT INTO credit_pack (id, code, name, credits) VALUES (:p, :c, 'Starter', 500)"),
                  {"p": pack, "c": pack})
        c.execute(text(LEGACY_PAYMENT_INSERT), {"id": pay, "o": f"order_{uuid.uuid4().hex[:12]}"})
        c.execute(text(LEGACY_ITEM_INSERT), {"id": str(uuid.uuid4()), "p": pay, "pack": pack})
    return {"pack": pack, "payment": pay}


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
    f = _migration_file()
    if f is None:
        pytest.skip("V590 not in this checkout")
    name = f"bill_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    engine = create_engine(_db_url(base, name), future=True)
    seeded = _prepare(engine)
    body = f.read_text(encoding="utf-8")
    _run_script(engine, body)
    _run_script(engine, body)                     # V590 twice: idempotent
    engine.seeded = seeded
    engine.admin, engine.base, engine.template, engine.body = admin, base, template, body
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
    """The first line of the database error when the statement is rejected (and rolled back), else None."""
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
    return {"timestamp with time zone": "timestamptz", "timestamp without time zone": "timestamp",
            "boolean": "boolean", "uuid": "uuid", "jsonb": "jsonb", "text": "text", "integer": "int",
            "bigint": "bigint", "character": f"char({row.character_maximum_length})"}[dt_]


def _columns(engine, table):
    from sqlalchemy import text

    with engine.begin() as c:
        return c.execute(text(
            "SELECT column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, "
            "is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = :t ORDER BY ordinal_position"), {"t": table}).all()


@pytest.mark.parametrize("table", TABLES)
def test_pg_schema_matches_models(pg, table):
    rows = _columns(pg, table)
    model = MODELS[table].__table__
    assert [r.column_name for r in rows] == [c.name for c in model.columns]
    for r, col in zip(rows, model.columns):
        assert _pg_type(r) == _model_type(col), f"{table}.{col.name}"
        assert (r.is_nullable == "NO") == (not col.nullable), f"{table}.{col.name} nullability"


def test_pg_v590_columns_on_v588_tables(pg):
    for table, view in (("ai_plan", bm.PLAN_LISTING_TABLE), ("ai_billing_feature", bm.FEATURE_LABEL_TABLE)):
        rows = {r.column_name: r for r in _columns(pg, table)}
        for col in view.columns:
            assert _pg_type(rows[col.name]) == _model_type(col), f"{table}.{col.name}"
            assert (rows[col.name].is_nullable == "NO") == (not col.nullable), f"{table}.{col.name}"
        # the V588 model columns are all still there, unchanged in type
        for col in pm.PlansBase.metadata.tables[table].columns:
            assert _pg_type(rows[col.name]) == _model_type(col), f"{table}.{col.name}"
    sub = {r.column_name: r for r in _columns(pg, "institute_ai_subscription")}
    assert _pg_type(sub["status"]) == f"varchar({bm.W_SUB_STATUS_V590})"
    assert _scalar(pg, "SELECT tenant_label FROM ai_billing_feature WHERE feature_key = 'admin_assistant'") \
        == "Admin AI assistant"
    assert _scalar(pg, "SELECT count(*) FROM ai_billing_feature WHERE tenant_label IS NOT NULL") == 1
    assert _scalar(pg, "SELECT count(*) FROM ai_plan WHERE listed OR audience_mode <> 'ALLOWLIST'") == 0
    # a re-run never overwrites a label the portal set
    from sqlalchemy import text
    with pg.begin() as c:
        c.execute(text("UPDATE ai_billing_feature SET tenant_label = 'Team assistant' "
                       "WHERE feature_key = 'admin_assistant'"))
    _run_script(pg, pg.body)
    assert _scalar(pg, "SELECT tenant_label FROM ai_billing_feature WHERE feature_key = 'admin_assistant'") \
        == "Team assistant"
    assert _refused(pg, "UPDATE ai_plan SET highlights = '{\"a\": 1}'")
    assert _refused(pg, "UPDATE ai_plan SET highlights = '[\"Fair use\", \"Allowance\"]'") is None


def test_pg_schema_matches_jpa_entities(pg):
    for entity, table in JPA.items():
        cols = _entity_columns(entity)
        rows = {r.column_name: r for r in _columns(pg, table)}
        assert set(cols) == set(rows), (entity, set(cols) ^ set(rows))
        for col, not_null in cols.items():
            if col == "id":
                continue
            assert (rows[col].is_nullable == "NO") == not_null, f"{entity}.{col} nullability"


def test_pg_existing_pack_rows_keep_their_behaviour(pg):
    pay = pg.seeded["payment"]
    assert _scalar(pg, "SELECT disposition FROM platform_payment WHERE id = :p", p=pay) == "NORMAL"
    assert _scalar(pg, "SELECT refunded_amount_minor FROM platform_payment WHERE id = :p", p=pay) == 0
    assert _scalar(pg, "SELECT item_kind FROM platform_payment_item WHERE platform_payment_id = :p", p=pay) \
        == "CREDIT_PACK"
    assert _scalar(pg, "SELECT count(*) FROM platform_payment WHERE disposition <> 'NORMAL' "
                       "OR brand_mode IS NOT NULL OR tax_head IS NOT NULL") == 0
    assert _scalar(pg, "SELECT count(*) FROM platform_payment_item WHERE item_kind <> 'CREDIT_PACK' "
                       "OR pack_id IS NULL") == 0
    assert _scalar(pg, "SELECT count(*) FROM platform_invoice WHERE source_kind <> 'CREDIT_PACK' "
                       "OR series_key IS NOT NULL") == 0
    # today's (pre-V590) insert statements still work unchanged after V590
    new_pay = str(uuid.uuid4())
    assert _refused(pg, LEGACY_PAYMENT_INSERT, id=new_pay, o=f"order_{uuid.uuid4().hex[:12]}") is None
    assert _refused(pg, LEGACY_ITEM_INSERT, id=str(uuid.uuid4()), p=new_pay, pack=pg.seeded["pack"]) is None
    assert _scalar(pg, "SELECT item_kind || '/' || disposition FROM platform_payment_item i "
                       "JOIN platform_payment p ON p.id = i.platform_payment_id WHERE p.id = :p", p=new_pay) \
        == "CREDIT_PACK/NORMAL"


def test_pg_payment_item_kind_and_pack(pg):
    pay = str(uuid.uuid4())
    assert _refused(pg, LEGACY_PAYMENT_INSERT, id=pay, o=f"order_{uuid.uuid4().hex[:12]}") is None
    ins = ("INSERT INTO platform_payment_item (id, platform_payment_id, pack_id, pack_code_snapshot, credits, currency, "
           "base_amount_minor, tax_rate_bps, tax_amount_minor, total_amount_minor, hsn_sac_snapshot, item_kind, "
           "subscription_charge_id, description_snapshot) VALUES (:id, :p, :pack, :code, 0, 'INR', 500000, 1800, "
           "90000, 590000, '998315', :kind, :charge, 'AI Pro, 16 Oct 2026 to 15 Nov 2026')")
    err = _refused(pg, ins, id=str(uuid.uuid4()), p=pay, pack=None, code="X", kind="CREDIT_PACK", charge=None)
    assert err and "ck_ppi_pack_required" in err, err
    err = _refused(pg, ins, id=str(uuid.uuid4()), p=pay, pack=None, code="X", kind="SOMETHING", charge=None)
    assert err and "ck_ppi_item_kind" in err, err
    assert _refused(pg, ins, id=str(uuid.uuid4()), p=pay, pack=None, code="AI_SUB:ai_pro", kind="AI_SUBSCRIPTION",
                    charge=str(uuid.uuid4())) is None
    # and a CREDIT_PACK item with a pack is still fine through the new column list
    assert _refused(pg, ins, id=str(uuid.uuid4()), p=pay, pack=pg.seeded["pack"], code="STARTER",
                    kind="CREDIT_PACK", charge=None) is None


def test_pg_unique_vendor_payment_id_on_platform_payment(pg):
    ins = ("INSERT INTO platform_payment (id, institute_id, vendor_payment_id, currency, base_amount_minor, "
           "total_amount_minor, status, payment_status) VALUES (:id, 'i', :v, 'INR', 1, 1, 'SUCCESS', 'PAID')")
    v = f"pay_{uuid.uuid4().hex[:14]}"
    assert _refused(pg, ins, id=str(uuid.uuid4()), v=v) is None
    err = _refused(pg, ins, id=str(uuid.uuid4()), v=v)
    assert err and "ux_platform_payment_vendor_payment" in err, err
    assert _refused(pg, ins, id=str(uuid.uuid4()), v=None) is None
    assert _refused(pg, ins, id=str(uuid.uuid4()), v=None) is None
    assert _scalar(pg, "SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_platform_payment_vendor_payment'") \
        .endswith("WHERE (vendor_payment_id IS NOT NULL)")


def test_pg_v590_survives_a_pre_existing_duplicate_vendor_payment_id(pg):
    """A duplicate that slipped in before the deploy must not crash Flyway (and so admin_core's boot)."""
    from sqlalchemy import create_engine, text

    name = f"bild_{uuid.uuid4().hex[:10]}"
    with pg.admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{pg.template}"' if pg.template else "")))
    eng = create_engine(_db_url(pg.base, name), future=True)
    try:
        _prepare(eng)
        ins = ("INSERT INTO platform_payment (id, institute_id, vendor_payment_id, currency, base_amount_minor, "
               "total_amount_minor, status, payment_status) VALUES (:id, 'i', 'pay_DUPLICATE01', 'INR', 1, 1, "
               "'SUCCESS', 'PAID')")
        with eng.begin() as c:
            c.execute(text(ins), {"id": str(uuid.uuid4())})
            c.execute(text(ins), {"id": str(uuid.uuid4())})
        _run_script(eng, pg.body)
        idx = _scalar(eng, "SELECT indexdef FROM pg_indexes WHERE indexname = 'ux_platform_payment_vendor_payment'")
        # PG renders a one-value NOT IN as "<>", several as "<> ALL (ARRAY[...])"
        assert "IS NOT NULL" in idx and "'pay_DUPLICATE01'" in idx.split("WHERE", 1)[1], idx
        v = f"pay_{uuid.uuid4().hex[:14]}"
        assert _refused(eng, ins.replace("'pay_DUPLICATE01'", f"'{v}'"), id=str(uuid.uuid4())) is None
        assert _refused(eng, ins.replace("'pay_DUPLICATE01'", f"'{v}'"), id=str(uuid.uuid4()))
    finally:
        eng.dispose()
        with pg.admin.connect() as c:
            c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _new_published_version(pg):
    from sqlalchemy import text

    with pg.begin() as c:
        pid = c.execute(text("INSERT INTO ai_plan (plan_key, name, created_by) VALUES (:k, 'T', 't') RETURNING id"),
                        {"k": f"t_{uuid.uuid4().hex[:8]}"}).scalar()
        vid = c.execute(text("INSERT INTO ai_plan_version (plan_id, version_no, price_minor, allowance_credits) "
                             "VALUES (:p, 1, 500000, 10) RETURNING id"), {"p": pid}).scalar()
        c.execute(text("UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now(), published_by = 't' "
                       "WHERE id = :v"), {"v": vid})
    return str(pid), str(vid)


def _new_subscription(pg, vid, status="PENDING", inst=None):
    from sqlalchemy import text

    inst = inst or f"inst-{uuid.uuid4().hex[:8]}"
    with pg.begin() as c:
        sid = c.execute(text("INSERT INTO institute_ai_subscription (institute_id, plan_version_id, status, source, "
                             "enforcement, anchor_at, start_at, created_by) VALUES (:i, :v, :s, 'PAYMENT', 'LIVE', "
                             "now(), now(), 't') RETURNING id"), {"i": inst, "v": vid, "s": status}).scalar()
    return str(sid), inst


CHARGE_INS = ("INSERT INTO ai_subscription_charge (subscription_id, institute_id, kind, status, service_start, "
              "service_end, plan_version_id, base_minor, idempotency_key) VALUES (:s, :i, :k, :st, "
              "TIMESTAMPTZ '2026-11-01 00:00+05:30', TIMESTAMPTZ '2026-12-01 00:00+05:30', :v, 500000, :idem) "
              "RETURNING id")


def test_pg_subscription_status_pending(pg):
    _, vid = _new_published_version(pg)
    sid, inst = _new_subscription(pg, vid, "PENDING")
    assert _scalar(pg, "SELECT status FROM institute_ai_subscription WHERE id = :s", s=sid) == "PENDING"
    ins = ("INSERT INTO institute_ai_subscription (institute_id, plan_version_id, status, anchor_at, start_at, "
           "created_by) VALUES (:i, :v, :s, now(), now(), 't')")
    err = _refused(pg, ins, i=inst, v=vid, s="PENDING")              # one PENDING checkout per institute
    assert err and "ux_ias_pending" in err, err
    assert _refused(pg, ins, i=inst, v=vid, s="ACTIVE") is None      # PENDING is not live (outside ux_ias_live)
    assert _refused(pg, ins, i=inst, v=vid, s="PENDING_PAYMENT") is None   # 15 chars fit VARCHAR(16)
    err = _refused(pg, ins, i=inst + "-x", v=vid, s="X" * 17)
    assert err and "too long" in err, err


def test_pg_charge_invariants(pg):
    from sqlalchemy import text

    _, vid = _new_published_version(pg)
    sid, inst = _new_subscription(pg, vid)
    kw = dict(s=sid, i=inst, v=vid)
    with pg.begin() as c:
        c1 = c.execute(text(CHARGE_INS), {**kw, "k": "PERIOD", "st": "DUE", "idem": "k-1"}).scalar()
    err = _refused(pg, CHARGE_INS, **kw, k="PERIOD", st="LINK_SENT", idem=None)
    assert err and "ux_asc_period" in err, err                       # critique #5: period_id is NULL here
    err = _refused(pg, CHARGE_INS, **kw, k="UPGRADE", st="DUE", idem="k-1")
    assert err and "ux_asc_idem" in err, err
    with pg.begin() as c:
        c.execute(text("UPDATE ai_subscription_charge SET status = 'FAILED' WHERE id = :c"), {"c": c1})
    assert _refused(pg, CHARGE_INS, **kw, k="PERIOD", st="DUE", idem=None)   # FAILED still holds the slot
    with pg.begin() as c:
        c.execute(text("UPDATE ai_subscription_charge SET status = 'VOID' WHERE id = :c"), {"c": c1})
    with pg.begin() as c:
        c2 = c.execute(text(CHARGE_INS), {**kw, "k": "PERIOD", "st": "DUE", "idem": None}).scalar()
        c.execute(text(CHARGE_INS), {**kw, "k": "UPGRADE", "st": "DUE", "idem": None})
    err = _refused(pg, CHARGE_INS, **kw, k="UPGRADE", st="FAILED", idem=None)
    assert err and "ux_asc_open_upgrade" in err, err
    # snapshot amounts: total = base + tax (inclusive prices: tax = total - base)
    err = _refused(pg, "UPDATE ai_subscription_charge SET tax_minor = 90000, total_minor = 590001 WHERE id = :c", c=c2)
    assert err and "ck_asc_total" in err, err
    assert _refused(pg, "UPDATE ai_subscription_charge SET tax_minor = 90000, total_minor = 590000, "
                        "place_of_supply = '27', tax_head = 'IGST', vendor_payment_id = 'pay_C2' WHERE id = :c",
                    c=c2) is None
    err = _refused(pg, "UPDATE ai_subscription_charge SET vendor_payment_id = 'pay_C2' WHERE id <> :c "
                       "AND subscription_id = :s", c=c2, s=sid)
    assert err and "ux_asc_vendor" in err, err
    err = _refused(pg, "UPDATE ai_subscription_charge SET currency = 'USD' WHERE id = :c", c=c2)
    assert err and "ck_asc_currency" in err, err
    err = _refused(pg, "UPDATE ai_subscription_charge SET paid_minor = 590000, refunded_minor = 590001 WHERE id = :c",
                   c=c2)
    assert err and "ck_asc_refund" in err, err
    err = _refused(pg, "UPDATE ai_subscription_charge SET service_end = service_start WHERE id = :c", c=c2)
    assert err and "ck_asc_window" in err, err
    err = _refused(pg, "UPDATE ai_subscription_charge SET subscription_id = gen_random_uuid() WHERE id = :c", c=c2)
    assert err and "foreign key" in err, err
    # paying: period row created at payment, linked to the charge
    with pg.begin() as c:
        per = c.execute(text("INSERT INTO ai_subscription_period (subscription_id, period_start, period_end, "
                             "plan_version_id, price_minor_snapshot, payment_status) SELECT subscription_id, "
                             "service_start, service_end, plan_version_id, base_minor, 'PAID' "
                             "FROM ai_subscription_charge WHERE id = :c RETURNING id"), {"c": c2}).scalar()
        c.execute(text("UPDATE ai_subscription_charge SET status = 'PAID', period_id = :p, paid_minor = 590000, "
                       "paid_at = now() WHERE id = :c"), {"c": c2, "p": per})
    assert _scalar(pg, "SELECT count(*) FROM ai_subscription_charge WHERE period_id IS NOT NULL AND id = :c", c=c2) == 1


def test_pg_mandates(pg):
    from sqlalchemy import text

    _, vid = _new_published_version(pg)
    sid, inst = _new_subscription(pg, vid)
    ins = ("INSERT INTO ai_subscription_mandate (institute_id, subscription_id, token_id, method, max_amount_minor, "
           "status) VALUES (:i, :s, :t, 'UPI', :m, :st)")
    assert _refused(pg, ins, i=inst, s=sid, t="token_A", m=1_500_000, st="ACTIVE") is None
    assert _refused(pg, ins, i=inst, s=sid, t=None, m=None, st="PENDING") is None
    assert _refused(pg, ins, i=inst, s=sid, t=None, m=None, st="PENDING") is None   # abandoned registrations
    err = _refused(pg, ins, i=inst, s=sid, t="token_B", m=1_500_000, st="PAUSED")
    assert err and "ux_asm_usable" in err, err
    err = _refused(pg, ins, i=inst, s=None, t="token_A", m=None, st="CANCELLED")
    assert err and "ux_asm_token" in err, err
    err = _refused(pg, ins, i=inst, s=None, t=None, m=0, st="PENDING")
    assert err and "ck_asm_max_amount" in err, err
    with pg.begin() as c:
        mid = c.execute(text("SELECT id FROM ai_subscription_mandate WHERE token_id = 'token_A'")).scalar()
        c.execute(text(CHARGE_INS.replace("RETURNING id", "")), dict(s=sid, i=inst, v=vid, k="PERIOD", st="DUE",
                                                                    idem=None))
        c.execute(text("UPDATE ai_subscription_charge SET mandate_id = :m, status = 'DEBIT_SCHEDULED' "
                       "WHERE subscription_id = :s"), {"m": mid, "s": sid})
    err = _refused(pg, "UPDATE ai_subscription_charge SET mandate_id = gen_random_uuid() WHERE subscription_id = :s",
                   s=sid)
    assert err and "foreign key" in err, err


def test_pg_storefront_audience_and_switches(pg):
    pid, _ = _new_published_version(pg)
    ins = ("INSERT INTO ai_storefront_audience (plan_id, rule, institute_id, segment_key, created_by) "
           "VALUES (:p, :r, :i, :g, 't')")
    assert _refused(pg, ins, p=None, r="INCLUDE", i="inst-A", g=None) is None
    err = _refused(pg, ins, p=None, r="INCLUDE", i="inst-A", g=None)
    assert err and "ux_asa_rule" in err, err
    assert _refused(pg, ins, p=pid, r="INCLUDE", i="inst-A", g=None) is None
    assert _refused(pg, ins, p=pid, r="EXCLUDE", i="inst-A", g=None) is None
    assert _refused(pg, ins, p=None, r="INCLUDE", i=None, g="pilot") is None
    err = _refused(pg, ins, p=None, r="INCLUDE", i="inst-B", g="pilot")
    assert err and "ck_asa_target" in err, err
    err = _refused(pg, ins, p=None, r="INCLUDE", i=None, g=None)
    assert err and "ck_asa_target" in err, err
    err = _refused(pg, ins, p=str(uuid.uuid4()), r="INCLUDE", i="inst-A", g=None)
    assert err and "foreign key" in err, err
    assert _refused(pg, "UPDATE ai_storefront_audience SET is_active = FALSE WHERE plan_id IS NULL "
                        "AND institute_id = 'inst-A'") is None
    assert _refused(pg, ins, p=None, r="INCLUDE", i="inst-A", g=None) is None   # re-add after deactivation
    assert _refused(pg, "INSERT INTO ai_institute_segment (institute_id, segment_key, created_by) "
                        "VALUES ('inst-A', 'pilot', 't')") is None
    assert _refused(pg, "INSERT INTO ai_institute_segment (institute_id, segment_key, created_by) "
                        "VALUES ('inst-A', 'pilot', 't')")
    assert _refused(pg, "INSERT INTO ai_storefront_institute (institute_id, brand_mode_override, storefront_enabled) "
                        "VALUES ('inst-A', 'NEUTRAL', NULL)") is None


def test_pg_billing_profile_checks(pg):
    ins = "INSERT INTO platform_billing_profile (institute_id, legal_name, gstin, state_code) VALUES (:i, 'X', :g, :s)"
    assert _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g="23AAYFV8247N1Z3", s="23") is None
    assert _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g=None, s="27") is None
    assert _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g=None, s=None) is None
    assert "ck_pbp_gstin_state" in _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g="23AAYFV8247N1Z3", s="27")
    assert "ck_pbp_gstin_format" in _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g="23aayfv8247n1z3", s=None)
    assert "ck_pbp_state_format" in _refused(pg, ins, i=f"i-{uuid.uuid4().hex[:6]}", g=None, s="M")


def test_pg_credit_note_checks(pg):
    from sqlalchemy import text

    with pg.begin() as c:
        pay = str(uuid.uuid4())
        c.execute(text(LEGACY_PAYMENT_INSERT), {"id": pay, "o": f"order_{uuid.uuid4().hex[:12]}"})
        inv = str(uuid.uuid4())
        c.execute(text("INSERT INTO platform_invoice (id, platform_payment_id, invoice_number, supplier_legal_name, "
                       "supplier_state_code, supplier_address, buyer_institute_id, buyer_legal_name, place_of_supply, "
                       "currency, base_amount_minor, igst_amount_minor, total_amount_minor) VALUES (:id, :p, :n, "
                       "'Vidyayatan Technologies LLP', '23', 'Indore', 'i', 'Buyer', '27', 'INR', 100000, 18000, "
                       "118000)"), {"id": inv, "p": pay, "n": f"VT/2627/I{uuid.uuid4().int % 100000:05d}"})
    ins = ("INSERT INTO platform_credit_note (id, credit_note_number, fy, invoice_id, invoice_number, invoice_issued_at, "
           "platform_payment_id, vendor_refund_id, reason, supplier_legal_name, supplier_state_code, supplier_address, "
           "buyer_institute_id, buyer_legal_name, place_of_supply, tax_head, currency, description, hsn_sac_code, "
           "base_amount_minor, igst_rate_bps, igst_amount_minor, total_amount_minor) VALUES (:id, :n, '2627', :inv, "
           "'VT/2627/I00001', now(), :p, :r, 'Refund', 'Vidyayatan Technologies LLP', '23', 'Indore', 'i', 'Buyer', "
           "'27', 'IGST', 'INR', 'AI Pro refund', '998315', :b, 1800, :t, :tot)")
    ok = dict(inv=inv, p=pay, b=50000, t=9000, tot=59000)
    assert _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00001", r="rfnd_1", **ok) is None
    assert "ux_pcn_vendor_refund" in _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00002", r="rfnd_1", **ok)
    assert "credit_note_number" in _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00001", r=None, **ok)
    assert "ck_pcn_total" in _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00003", r=None,
                                      **{**ok, "tot": 59001})
    assert "ck_pcn_amounts" in _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00004", r=None,
                                        **{**ok, "b": 0, "t": 0, "tot": 0})
    assert _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C123456789", r=None, **ok)   # 18 > 16
    assert "foreign key" in _refused(pg, ins, id=str(uuid.uuid4()), n="VT/2627/C00005", r=None,
                                     **{**ok, "inv": "missing"})


def test_pg_document_sequence_allocation(pg):
    """The allocation statement PlatformDocumentSequenceService uses: gapless, per series and FY."""
    from sqlalchemy import text

    alloc = ("INSERT INTO platform_document_sequence (series_key, fy, next_no) VALUES (:k, :fy, 2) "
             "ON CONFLICT (series_key, fy) DO UPDATE SET next_no = platform_document_sequence.next_no + 1 "
             "RETURNING next_no - 1")
    got = []
    for k, fy in (("I", "2627"), ("I", "2627"), ("C", "2627"), ("I", "2627"), ("I", "2728")):
        with pg.begin() as c:
            got.append(c.execute(text(alloc), {"k": k, "fy": fy}).scalar())
    assert got == [1, 2, 1, 3, 1]
    with pytest.raises(Exception):          # a rolled-back document gives its number back
        with pg.begin() as c:
            assert c.execute(text(alloc), {"k": "I", "fy": "2627"}).scalar() == 4
            raise RuntimeError("invoice insert failed")
    with pg.begin() as c:
        assert c.execute(text(alloc), {"k": "I", "fy": "2627"}).scalar() == 4
    assert "ck_pds_fy" in _refused(pg, alloc.replace(":fy", "'26A7'"), k="I")
