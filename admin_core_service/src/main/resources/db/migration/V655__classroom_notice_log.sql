-- One row per classroom-panel notice an institute has been sent (or was about
-- to be sent). The unique key is the dedupe: the hourly notify job claims an
-- incident with INSERT ... ON CONFLICT DO NOTHING and only the incidents it
-- claims go into that day's digest, so a standing problem is mentioned once,
-- not every day, and two pods can never both send it.
--
-- kind:         alert kind (OFFLINE, AWAITING_APPROVAL, ...) or WEEKLY_WA
-- subject_id:   device id, room id, grant id, or 'week'
-- incident_key: what makes this occurrence new (e.g. a last-seen time or a
--               week start date)
-- sent_ok:      null while sending, then true/false. Failed rows are not
--               retried, by design.
CREATE TABLE IF NOT EXISTS public.classroom_notice_log (
    id           varchar(36)  PRIMARY KEY,
    institute_id varchar(255) NOT NULL,
    kind         varchar(24)  NOT NULL,
    subject_id   varchar(64)  NOT NULL,
    incident_key varchar(64)  NOT NULL,
    sent_ok      boolean      NULL,
    created_at   timestamp    NOT NULL DEFAULT now(),
    CONSTRAINT uq_classroom_notice UNIQUE (institute_id, kind, subject_id, incident_key)
);
