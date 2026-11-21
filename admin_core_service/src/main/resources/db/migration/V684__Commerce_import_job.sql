-- Commerce product import (docs/commerce/ADMIN.md section 4.3, BUILD_PLAN.md WP-07).
-- New tables only: no existing table is altered, so nothing here takes a lock on a live table.

-- One commit of an import file. The counters and next_group_index are written after every
-- product, so a job whose worker stopped is taken up again where it stopped.
CREATE TABLE IF NOT EXISTS commerce_import_job (
    id                        VARCHAR(36)  PRIMARY KEY,
    institute_id              VARCHAR(36)  NOT NULL,
    kind                      VARCHAR(32)  NOT NULL DEFAULT 'PRODUCTS',
    status                    VARCHAR(32)  NOT NULL DEFAULT 'QUEUED',
    file_name                 VARCHAR(255),
    file_format               VARCHAR(8)   NOT NULL,
    file_sha256               VARCHAR(64)  NOT NULL,
    file_size                 INTEGER      NOT NULL,
    rows_total                INTEGER      NOT NULL DEFAULT 0,
    rows_done                 INTEGER      NOT NULL DEFAULT 0,
    rows_failed               INTEGER      NOT NULL DEFAULT 0,
    products_total            INTEGER      NOT NULL DEFAULT 0,
    products_created          INTEGER      NOT NULL DEFAULT 0,
    products_updated          INTEGER      NOT NULL DEFAULT 0,
    products_failed           INTEGER      NOT NULL DEFAULT 0,
    variants_created          INTEGER      NOT NULL DEFAULT 0,
    variants_updated          INTEGER      NOT NULL DEFAULT 0,
    image_urls_queued         INTEGER      NOT NULL DEFAULT 0,
    next_group_index          INTEGER      NOT NULL DEFAULT 0,
    attempt                   INTEGER      NOT NULL DEFAULT 0,
    error_count               INTEGER      NOT NULL DEFAULT 0,
    issues_json               TEXT,
    failed_rows_json          TEXT,
    created_package_ids_json  TEXT,
    failure_message           TEXT,
    created_by_user_id        VARCHAR(36),
    started_at                TIMESTAMP,
    heartbeat_at              TIMESTAMP,
    finished_at               TIMESTAMP,
    created_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_import_job_status
        CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED')),
    CONSTRAINT ck_commerce_import_job_format CHECK (file_format IN ('CSV', 'XLSX'))
);

-- One import in flight per institute and kind: two files cannot race on the same SKU.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_import_job_active
    ON commerce_import_job (institute_id, kind) WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX IF NOT EXISTS idx_commerce_import_job_institute_created
    ON commerce_import_job (institute_id, kind, created_at);
-- The sweep that resumes stopped jobs reads only the few rows in flight.
CREATE INDEX IF NOT EXISTS idx_commerce_import_job_heartbeat
    ON commerce_import_job (heartbeat_at) WHERE status IN ('QUEUED', 'RUNNING');

-- The uploaded file (at most 5 MB), apart from the job row so that reading progress never
-- loads it. Removed when the job ends without a failed row; otherwise kept for the
-- error-rows download and purged after 30 days.
CREATE TABLE IF NOT EXISTS commerce_import_job_file (
    job_id        VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(36)  NOT NULL,
    content       BYTEA        NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commerce_import_job_file_institute
    ON commerce_import_job_file (institute_id, created_at);

-- Image addresses named by an import file. The import only stores them; the migration tool
-- downloads from the old shop under its own host allow-list, uploads to the media service
-- and attaches the file. package_id is VARCHAR(255) like the legacy column it points at.
CREATE TABLE IF NOT EXISTS commerce_import_image_queue (
    id            VARCHAR(36)   PRIMARY KEY,
    institute_id  VARCHAR(36)   NOT NULL,
    job_id        VARCHAR(36)   NOT NULL,
    package_id    VARCHAR(255)  NOT NULL,
    source_url    TEXT          NOT NULL,
    position      INTEGER       NOT NULL DEFAULT 0,
    status        VARCHAR(32)   NOT NULL DEFAULT 'PENDING',
    media_id      VARCHAR(255),
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_commerce_import_image_queue_status CHECK (status IN ('PENDING', 'DONE', 'FAILED'))
);

-- One row per address per product, so a repeated import queues nothing twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_import_image_queue_url
    ON commerce_import_image_queue (institute_id, package_id, md5(source_url));
CREATE INDEX IF NOT EXISTS idx_commerce_import_image_queue_status
    ON commerce_import_image_queue (institute_id, status);
