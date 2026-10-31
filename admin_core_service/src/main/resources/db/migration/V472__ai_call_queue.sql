-- V472: AI call queue — one durable, fleet-wide queue in front of every AI dial.
--
-- Until now there were THREE uncoordinated in-memory pacers (the CALL_AI node's
-- single-thread executor, the bulk campaign's per-campaign sliding window with its
-- own MAX_PARALLEL=3, and the manual click going straight to the provider). None of
-- them knew about the others, none survived a restart, and admin-core runs 2-4
-- replicas so each held its own copy. Overload was absorbed by the voice bot's
-- admission control, which answers "all lines busy" to a real lead.
--
-- This migration adds the three tables that replace them:
--
--   ai_voice_box    the capacity pool. Fleet capacity for our own bot is the SUM of
--                   max_concurrent over enabled, healthy boxes -- so adding a second
--                   Mumbai box is an INSERT, not a redeploy.
--   ai_call_queue   the durable queue itself. FIFO on (priority DESC, created_at).
--   ai_call_lane    per-institute OVERRIDES only. A lane with no row uses the dynamic
--                   default cap, so this table stays empty until someone tunes a
--                   customer.
--
-- Fairness note: ordering is strict FIFO. What stops one institute's 500-lead bulk
-- upload from blocking another institute is the per-lane concurrency cap -- the drain
-- scan SKIPS an item whose institute is already at its cap, so a latecomer with 5
-- leads takes the next free slot instead of waiting out the backlog. That holds while
-- the number of simultaneously-busy institutes is <= fleet capacity; beyond that the
-- tail lane starves and the fix is a rotation. ai_call_lane.last_dispatched_at is
-- carried (written, never read) so switching to round-robin later is an ORDER BY
-- change rather than another migration.

-- ── 1. Capacity pool ────────────────────────────────────────────────────────────
-- Modelled on bbb_server_pool (V192), which already proved this shape out. base_url
-- is recorded for routing + health polling; DIALING still resolves the bot address
-- from telephony.vacademy-ai.bot-base-url, so this table cannot change where a call
-- goes -- it only decides how many may be in flight.
CREATE TABLE IF NOT EXISTS ai_voice_box (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              VARCHAR(50)  NOT NULL UNIQUE,          -- 'mumbai-1'
    base_url          VARCHAR(255) NOT NULL,                 -- https://<host>  (no trailing slash)
    max_concurrent    INT          NOT NULL DEFAULT 3,       -- simultaneous calls this box can carry
    priority          INT          NOT NULL DEFAULT 1,
    enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
    health_status     VARCHAR(20)  NOT NULL DEFAULT 'UNKNOWN', -- HEALTHY | DOWN | UNKNOWN
    active_calls      INT,                                   -- last /health activeCalls reading
    last_health_check TIMESTAMP,
    notes             VARCHAR(255),
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Seed the one box that exists today, at the capacity the docs record for it
-- (MAX_CONCURRENT_CALLS=10 is the bot's own abuse bound; 3 is what a 1 vCPU box
-- actually carries cleanly, and is the number the bulk campaign was already using).
-- base_url is a placeholder: the health poller skips a box whose URL is not a real
-- host, so an unedited seed row contributes capacity without ever being polled.
INSERT INTO ai_voice_box (slug, base_url, max_concurrent, notes)
VALUES ('default', 'CONFIGURE_ME', 3,
        'Seeded by V472. Set base_url to the Mumbai bot host to enable health polling.')
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Runtime knobs ────────────────────────────────────────────────────────────
-- app_config already exists (V192) and is read through AppConfigRepository, so these
-- are tunable without a redeploy.
INSERT INTO app_config (config_key, config_value, description) VALUES
  ('ai_call_capacity_enabled',      'true', 'false = drain the queue with NO concurrency limit (emergency lever; the queue still applies windows + dedupe)'),
  ('ai_call_aavtaar_max_concurrent','20',   'Concurrent AAVTAAR AI calls. Aavtaar dials on THEIR infrastructure, so this is a courtesy rate limit, not our capacity. 0 = unlimited'),
  ('ai_call_stuck_grace_sec',       '720',  'A non-terminal call older than this stops occupying a slot (lost webhook backstop). Max call is 6-10 min'),
  ('ai_call_queue_ttl_hours',       '48',   'A queued call older than this is EXPIRED rather than dialled'),
  ('ai_call_avg_secs',              '180',  'Assumed call duration, used only for the ETA shown to admins'),
  ('ai_call_reserved_interactive',  '0',    'Slots held back for MANUAL clicks. 0 = manual queues behind everything, which is the configured behaviour'),
  ('ai_call_drain_batch',           '200',  'Max queue rows examined per drain tick')
ON CONFLICT (config_key) DO NOTHING;

-- ── 3. The queue ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_call_queue (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id        VARCHAR(255) NOT NULL,
    -- Resolved at ENQUEUE time (never left blank) because capacity is accounted per
    -- provider: VACADEMY_AI draws on ai_voice_box, AAVTAAR on its own limit, MOCK is
    -- unlimited because it never leaves the box.
    provider            VARCHAR(50)  NOT NULL,
    -- Ordering WITHIN a lane. Higher first; ties broken by created_at. Everything
    -- enqueues at 100 today -- the column exists so a future "retries before fresh
    -- bulk" policy needs no migration.
    priority            INT          NOT NULL DEFAULT 100,
    source              VARCHAR(30)  NOT NULL,   -- WORKFLOW | BULK | MANUAL | RETRY
    source_ref          VARCHAR(255),            -- audience id / workflow execution id
    -- The CallTrigger this item must be dialled with. Carried on the row, not
    -- re-derived at dispatch, so a MANUAL click keeps its throttle exemptions after
    -- sitting in the queue for an hour.
    call_trigger        VARCHAR(30)  NOT NULL,

    response_id         VARCHAR(255),
    user_id             VARCHAR(255),
    phone_number        VARCHAR(32),
    campaign_id         VARCHAR(255),
    campaign_name       VARCHAR(255),
    preferred_number_id VARCHAR(255),
    subject_type        VARCHAR(32),
    subject_id          VARCHAR(255),
    customer_name       VARCHAR(255),
    customer_email      VARCHAR(255),
    metadata            TEXT,                    -- JSON, replayed onto AiCallRequestDTO
    actor_user_id       VARCHAR(255),            -- becomes counsellor_user_id on the call log

    -- One PENDING call per (institute, subject, provider). See the partial unique
    -- index below -- this is what makes a workflow resume (the engine restarts runs)
    -- or a re-fired bulk idempotent.
    dedupe_key          VARCHAR(512) NOT NULL,

    status              VARCHAR(20)  NOT NULL DEFAULT 'QUEUED',
                        -- QUEUED | DISPATCHING | DIALED | FAILED | EXPIRED | CANCELLED
    attempts            INT          NOT NULL DEFAULT 0,
    last_error          TEXT,
    status_reason       VARCHAR(255),            -- why it ended where it did, for the UI

    not_before          TIMESTAMP,               -- calling-window / backoff gate
    expires_at          TIMESTAMP,               -- TTL; past this it is EXPIRED, not dialled

    call_log_id         VARCHAR(255),            -- set once dialled
    dispatched_at       TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Idempotency. Partial, so it constrains only rows that have not been dialled yet:
-- a lead may be queued again once its previous call has gone out (which is exactly
-- what a legitimate retry sequence does), but a workflow re-entering the same node
-- five times while the first item still waits inserts once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_call_queue_pending
    ON ai_call_queue (dedupe_key)
    WHERE status IN ('QUEUED', 'DISPATCHING');

-- The drain pick: oldest eligible item per institute. Partial on QUEUED because the
-- table is append-only and the dialled history dwarfs the pending set within a day.
CREATE INDEX IF NOT EXISTS idx_ai_call_queue_pick
    ON ai_call_queue (institute_id, priority DESC, created_at)
    WHERE status = 'QUEUED';

-- Sweeps: TTL expiry and the "how deep is my queue" reads.
CREATE INDEX IF NOT EXISTS idx_ai_call_queue_expiry
    ON ai_call_queue (expires_at)
    WHERE status = 'QUEUED';

CREATE INDEX IF NOT EXISTS idx_ai_call_queue_institute_created
    ON ai_call_queue (institute_id, created_at DESC);

-- Campaign progress dialog: "what happened to the leads I queued from this list?"
CREATE INDEX IF NOT EXISTS idx_ai_call_queue_source_ref
    ON ai_call_queue (source, source_ref)
    WHERE source_ref IS NOT NULL;

-- ── 4. Per-institute overrides ──────────────────────────────────────────────────
-- Deliberately sparse: an institute with no row here gets the dynamic default cap
-- (ceil(fleetCapacity / lanesWithWork), floored at 1), which is work-conserving --
-- one institute dialling alone at 2am uses the whole fleet.
CREATE TABLE IF NOT EXISTS ai_call_lane (
    institute_id       VARCHAR(255) PRIMARY KEY,
    max_concurrent     INT,                       -- NULL = use the dynamic default
    weight             INT          NOT NULL DEFAULT 1,   -- reserved for weighted rotation
    paused             BOOLEAN      NOT NULL DEFAULT FALSE,
    last_dispatched_at TIMESTAMP,                 -- written, not read (see header note)
    created_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── 5. In-flight accounting ─────────────────────────────────────────────────────
-- The drainer counts occupied slots off telephony_call_log rather than a counter, so
-- a lost webhook cannot leak a slot permanently and a call placed OUTSIDE the queue
-- (a legacy path, a MOCK, an inbound AI answer) is still counted. This partial index
-- covers exactly that predicate; it indexes only live calls, so it stays tiny.
CREATE INDEX IF NOT EXISTS idx_tcl_ai_in_flight
    ON telephony_call_log (provider_type, created_at)
    WHERE status IN ('INITIATED', 'QUEUED', 'COUNSELLOR_RINGING',
                     'COUNSELLOR_ANSWERED', 'IN_PROGRESS');
