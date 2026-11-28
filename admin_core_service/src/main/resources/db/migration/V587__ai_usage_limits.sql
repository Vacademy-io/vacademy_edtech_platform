-- ============================================================================
-- V587: AI usage limits (per user / role / role class / institute caps)
--
-- Everything here is additive and inert for existing behaviour:
--   * four NEW tables: institute_ai_limits_policy, ai_usage_limit,
--     ai_usage_counter, ai_usage_reservation. No seeds.
--   * No row in institute_ai_limits_policy = mode OFF = exactly today: ai_service
--     keeps an in-memory set of institute ids that have a policy (one bulk query
--     at most every 30 s) and never touches the other three tables for an
--     institute outside that set. ai_service tolerates these tables being absent
--     (limits silently off), so deploy order does not matter.
--   * No existing table is altered, so nothing here takes a contended lock.
--   * Like V586, the enum-like columns carry NO CHECK constraint (validated in
--     ai_service); only the numeric sanity CHECKs on the limit values exist.
--
-- Vocabularies (validated in ai_service, documented here):
--   policy mode     OFF | SHADOW | ENFORCE   (global kill switch metering.limits.enforce
--                   = false makes every ENFORCE behave as SHADOW)
--   subject_kind    INSTITUTE | ROLE_CLASS | ROLE | USER
--   scope_kind      ALL | GROUP | USE_CASE   (scope_value = feature_group or use_case)
--   period          DAY | WEEK | MONTH | PLAN_PERIOD   (PLAN_PERIOD reserved for AI plans;
--                   windows start at local midnight / week / month in the policy timezone,
--                   stored as UTC instants)
--   metric          CREDITS (counts ai_usage_event.list_credits) | COUNT (request_count or
--                   the catalog count unit) | COST_USD (ai_usage_event.real_cost_usd)
--   origin          TENANT | PLATFORM  (PLATFORM rows may be locked: tenant cannot edit
--                   or out-rank them)
--   reservation     OPEN | SETTLED | RELEASED  (expired OPEN rows are ignored, no sweeper)
--   counter_key     I|ALL  I|G:<group>  I|UC:<use_case>  R:<role>|...  RC:<class>|...
--                   U:<user id>|...   (built by ai_service metering/limits.py)
--
-- Limit semantics: soft_limit = warn at or above; hard_limit = block at or above;
-- hard_limit 0 = feature off for the subject; NULL = unlimited (a USER row with a
-- NULL hard_limit exempts that user from the role cap, never from a PLATFORM cap).
-- Audit of every write: ai_model_change_log (V569).
-- ============================================================================
SET LOCAL lock_timeout = '10s';

-- ── Per-institute limits policy (no row = OFF = today) ─────────────────────
CREATE TABLE IF NOT EXISTS institute_ai_limits_policy (
    institute_id             VARCHAR(64) PRIMARY KEY,
    mode                     VARCHAR(8) NOT NULL DEFAULT 'OFF',              -- OFF | SHADOW | ENFORCE
    tenant_may_enforce       BOOLEAN NOT NULL DEFAULT FALSE,                 -- super admin unlocks ENFORCE for the tenant
    timezone                 VARCHAR(48) NOT NULL DEFAULT 'Asia/Kolkata',    -- window boundaries
    notify_admins_on_soft    BOOLEAN NOT NULL DEFAULT TRUE,
    show_numbers_to_learners BOOLEAN NOT NULL DEFAULT FALSE,                 -- learners see used / limit numbers
    updated_by               VARCHAR(255),
    updated_at               TIMESTAMPTZ DEFAULT now(),
    reason                   TEXT
);

-- ── Limit rows ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_limit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id    VARCHAR(64) NOT NULL,
    subject_kind    VARCHAR(16) NOT NULL,             -- INSTITUTE | ROLE_CLASS | ROLE | USER
    subject_value   VARCHAR(255),                     -- NULL for INSTITUTE; role class; role name; user id
    per_member      BOOLEAN NOT NULL DEFAULT TRUE,    -- ROLE*: TRUE = each member capped; FALSE = pooled
    scope_kind      VARCHAR(16) NOT NULL,             -- ALL | GROUP | USE_CASE
    scope_value     VARCHAR(64),                      -- feature_group or use_case; NULL for ALL
    period          VARCHAR(12) NOT NULL,             -- DAY | WEEK | MONTH | PLAN_PERIOD
    metric          VARCHAR(8) NOT NULL,              -- CREDITS | COUNT | COST_USD
    soft_limit      NUMERIC(14,4),                    -- warn at or above
    hard_limit      NUMERIC(14,4),                    -- block at or above; 0 = off; NULL = unlimited
    origin          VARCHAR(10) NOT NULL DEFAULT 'TENANT',   -- TENANT | PLATFORM
    locked          BOOLEAN NOT NULL DEFAULT FALSE,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    reason          TEXT,
    created_by      VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_by      VARCHAR(255),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_aul_soft_le_hard CHECK (soft_limit IS NULL OR hard_limit IS NULL OR soft_limit <= hard_limit),
    CONSTRAINT ck_aul_soft_nonneg  CHECK (soft_limit IS NULL OR soft_limit >= 0),
    CONSTRAINT ck_aul_hard_nonneg  CHECK (hard_limit IS NULL OR hard_limit >= 0)
);
-- at most one open row per (institute, subject, scope, period, metric, origin)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_usage_limit_open ON ai_usage_limit
    (institute_id, subject_kind, COALESCE(subject_value, ''), per_member, scope_kind,
     COALESCE(scope_value, ''), period, metric, origin)
    WHERE is_active AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_aul_inst ON ai_usage_limit (institute_id);

-- ── Usage counters (a cache of ai_usage_event; rebuilt nightly) ────────────
CREATE TABLE IF NOT EXISTS ai_usage_counter (
    institute_id  VARCHAR(64) NOT NULL,
    counter_key   VARCHAR(320) NOT NULL,
    period        VARCHAR(12) NOT NULL,              -- DAY | WEEK | MONTH | PLAN_PERIOD
    window_start  TIMESTAMPTZ NOT NULL,              -- UTC instant of the local window start
    credits_used  NUMERIC(16,4) NOT NULL DEFAULT 0,  -- sum of list_credits
    count_used    NUMERIC(16,4) NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(16,8) NOT NULL DEFAULT 0,  -- sum of real_cost_usd
    warned_at     TIMESTAMPTZ,                       -- de-dup of soft-limit notifications per window
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, counter_key, period, window_start)
);

-- ── Reservations (reserve_on_authorize use cases: video, evaluation batches) ─
CREATE TABLE IF NOT EXISTS ai_usage_reservation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id    VARCHAR(64) NOT NULL,
    counter_keys    TEXT[] NOT NULL,
    period_windows  JSONB NOT NULL,                     -- [{key, period, window_start}, ...]
    credits         NUMERIC(14,4) NOT NULL DEFAULT 0,
    count           NUMERIC(14,4) NOT NULL DEFAULT 1,
    use_case        VARCHAR(64) NOT NULL,
    actor_user_id   VARCHAR(255),
    status          VARCHAR(10) NOT NULL DEFAULT 'OPEN',   -- OPEN | SETTLED | RELEASED
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_aur_open ON ai_usage_reservation (institute_id, status, expires_at) WHERE status = 'OPEN';
