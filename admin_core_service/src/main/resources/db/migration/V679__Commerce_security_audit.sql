-- V679: Commerce module, security and audit tables (docs/commerce/ARCHITECTURE.md 3.2, 3.6, 7.3).
-- New tables only; nothing existing is altered and no data is moved.
-- Conventions: id VARCHAR(36), institute_id first in every index, enums VARCHAR(32).

-- Which locations a staff member may act at. location_id points at stock_location, which
-- arrives with the stock tables, so there is no foreign key here.
CREATE TABLE IF NOT EXISTS commerce_staff_location (
    id           VARCHAR(36)  PRIMARY KEY,
    institute_id VARCHAR(36)  NOT NULL,
    user_id      VARCHAR(36)  NOT NULL,
    location_id  VARCHAR(36)  NOT NULL,
    created_by   VARCHAR(36),
    created_at   TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT uq_commerce_staff_location UNIQUE (institute_id, user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_staff_location_location
    ON commerce_staff_location (institute_id, location_id);

-- A manager's personal approval PIN. Only the hash is stored. Five wrong tries in a row set
-- locked_until; the counter restarts when the lock has passed or a new PIN is set.
CREATE TABLE IF NOT EXISTS commerce_staff_pin (
    id              VARCHAR(36)  PRIMARY KEY,
    institute_id    VARCHAR(36)  NOT NULL,
    user_id         VARCHAR(36)  NOT NULL,
    pin_hash        VARCHAR(100) NOT NULL,
    failed_attempts INTEGER      NOT NULL DEFAULT 0,
    locked_until    TIMESTAMP,
    lock_count      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT uq_commerce_staff_pin UNIQUE (institute_id, user_id)
);

-- One row per approval by PIN, written in the transaction of the action it approves.
CREATE TABLE IF NOT EXISTS commerce_approval (
    id             VARCHAR(36)   PRIMARY KEY,
    institute_id   VARCHAR(36)   NOT NULL,
    action         VARCHAR(32)   NOT NULL,
    reference_type VARCHAR(32)   NOT NULL,
    reference_id   VARCHAR(64)   NOT NULL,
    requested_by   VARCHAR(36)   NOT NULL,
    approved_by    VARCHAR(36)   NOT NULL,
    amount         NUMERIC(12,2),
    reason         TEXT,
    created_at     TIMESTAMP     NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerce_approval_reference
    ON commerce_approval (institute_id, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_commerce_approval_created
    ON commerce_approval (institute_id, created_at);

-- Append-only audit of commerce changes. Rows are never updated and never purged.
CREATE TABLE IF NOT EXISTS commerce_audit (
    id             VARCHAR(36)  PRIMARY KEY,
    institute_id   VARCHAR(36)  NOT NULL,
    actor_user_id  VARCHAR(36),
    location_id    VARCHAR(36),
    kind           VARCHAR(32)  NOT NULL,
    reference_type VARCHAR(32),
    reference_id   VARCHAR(64),
    old_value_json JSONB,
    new_value_json JSONB,
    reason         TEXT,
    created_at     TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commerce_audit_created
    ON commerce_audit (institute_id, created_at);

CREATE INDEX IF NOT EXISTS idx_commerce_audit_reference
    ON commerce_audit (institute_id, reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_commerce_audit_kind
    ON commerce_audit (institute_id, kind, created_at);

-- Shared limiter for public endpoints: fixed windows, one row per scope, subject and window.
-- subject_key is an IP, an order number or the SHA-256 of a phone number (never a raw phone).
CREATE TABLE IF NOT EXISTS commerce_rate_limit (
    id           VARCHAR(36)  PRIMARY KEY,
    institute_id VARCHAR(36)  NOT NULL,
    scope        VARCHAR(32)  NOT NULL,
    subject_key  VARCHAR(128) NOT NULL,
    window_start TIMESTAMP    NOT NULL,
    hits         INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT uq_commerce_rate_limit UNIQUE (institute_id, scope, subject_key, window_start)
);

-- For deleting old windows per institute.
CREATE INDEX IF NOT EXISTS idx_commerce_rate_limit_window
    ON commerce_rate_limit (institute_id, window_start);
