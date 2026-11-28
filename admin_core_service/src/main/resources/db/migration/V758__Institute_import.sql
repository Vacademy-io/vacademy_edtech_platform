-- Institute import: moves a school's data in from its old system, keyed on the school's own IDs.
-- institute_import_ref maps each (kind, external id) to the row it created, so running an import
-- again updates instead of duplicating. institute_import_run keeps an audit of every run.

CREATE TABLE IF NOT EXISTS institute_import_ref (
    id           VARCHAR(255) PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,
    kind         VARCHAR(40)  NOT NULL,
    external_id  VARCHAR(255) NOT NULL,
    internal_id  VARCHAR(255) NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_institute_import_ref UNIQUE (institute_id, kind, external_id)
);

CREATE INDEX IF NOT EXISTS idx_institute_import_ref_internal ON institute_import_ref (institute_id, kind, internal_id);

CREATE TABLE IF NOT EXISTS institute_import_run (
    id            VARCHAR(255) PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    step          VARCHAR(40)  NOT NULL,
    dry_run       BOOLEAN      NOT NULL,
    requested     INTEGER      NOT NULL DEFAULT 0,
    created       INTEGER      NOT NULL DEFAULT 0,
    updated       INTEGER      NOT NULL DEFAULT 0,
    skipped       INTEGER      NOT NULL DEFAULT 0,
    failed        INTEGER      NOT NULL DEFAULT 0,
    result_json   TEXT,
    run_by        VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_institute_import_run_institute ON institute_import_run (institute_id, created_at DESC);
