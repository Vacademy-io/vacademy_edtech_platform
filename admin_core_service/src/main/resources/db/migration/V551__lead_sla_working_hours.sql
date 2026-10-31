-- ============================================================
-- V551: working-hours-aware TAT / follow-up SLA deadlines.
--
-- Rule (applies to TAT and the follow-up SLA alike, when working hours are on):
--   * clock starts INSIDE working hours  → due = start + the configured duration
--     (plain wall clock, even if that lands after closing time);
--   * clock starts OUTSIDE working hours (after closing, before opening, or on a
--     non-working day) → due = the configured "off-hours due time" on the next
--     working day (today, when it starts before opening on a working day).
--
-- lead_sla_due_at() is the ONE place this rule lives. The leads list SLA filter, the
-- lead reports, the "Reach out in" badge and the SLA scheduler all call it, so every
-- screen agrees. The working-hours settings are passed in as a small JSON rule
-- (built in LeadSlaConfigService) — NULL rule = working hours off = plain wall clock.
-- ============================================================

ALTER TABLE lead_sla_config
    ADD COLUMN IF NOT EXISTS working_hours_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    -- ISO weekdays, 1 = Monday … 7 = Sunday, comma-separated
    ADD COLUMN IF NOT EXISTS working_days               VARCHAR(20) NOT NULL DEFAULT '1,2,3,4,5,6',
    ADD COLUMN IF NOT EXISTS working_start_time         TIME NOT NULL DEFAULT '09:00',
    ADD COLUMN IF NOT EXISTS working_end_time           TIME NOT NULL DEFAULT '18:00',
    ADD COLUMN IF NOT EXISTS tat_offhours_due_time      TIME NOT NULL DEFAULT '10:00',
    ADD COLUMN IF NOT EXISTS followup_offhours_due_time TIME NOT NULL DEFAULT '10:00';

-- Per-lead manual override of the TAT deadline (admins only, via
-- PUT /v1/lead-sla-config/lead/{responseId}/tat-due). When set it wins over the computed
-- deadline everywhere: effective TAT due = COALESCE(tat_due_override_at, lead_sla_due_at(...)).
ALTER TABLE audience_response
    ADD COLUMN IF NOT EXISTS tat_due_override_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS tat_due_override_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS tat_due_override_set_at TIMESTAMP;

-- anchor   : when the clock starts (submitted_at for TAT, last response for follow-up),
--            a TIMESTAMP in the session time zone like every other timestamp column.
-- minutes  : the configured duration.
-- rule     : {"tz":"Asia/Kolkata","days":[1,2,3,4,5,6],"start":"09:00","end":"18:00","off":"10:00"}
--            or NULL for plain wall-clock deadlines.
-- Returns the deadline as a TIMESTAMP in the session time zone (same convention as anchor).
CREATE OR REPLACE FUNCTION lead_sla_due_at(anchor TIMESTAMP, minutes INTEGER, rule JSONB)
RETURNS TIMESTAMP
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    tz       TEXT;
    days     INTEGER[];
    start_t  TIME;
    end_t    TIME;
    off_t    TIME;
    local_ts TIMESTAMP;
    local_t  TIME;
    due_day  DATE;
    i        INTEGER;
BEGIN
    IF anchor IS NULL OR minutes IS NULL THEN
        RETURN NULL;
    END IF;
    IF rule IS NULL OR jsonb_typeof(rule) <> 'object' THEN
        RETURN anchor + make_interval(mins => minutes);
    END IF;

    tz      := COALESCE(NULLIF(rule ->> 'tz', ''), 'Asia/Kolkata');
    days    := ARRAY(SELECT jsonb_array_elements_text(COALESCE(rule -> 'days', '[]'::jsonb))::INTEGER);
    start_t := COALESCE((rule ->> 'start')::TIME, '09:00');
    end_t   := COALESCE((rule ->> 'end')::TIME, '18:00');
    off_t   := COALESCE((rule ->> 'off')::TIME, '10:00');

    -- No working days configured: nothing to wait for — fall back to wall clock.
    IF cardinality(days) = 0 THEN
        RETURN anchor + make_interval(mins => minutes);
    END IF;

    -- Wall-clock time where the institute is.
    local_ts := (anchor::TIMESTAMPTZ) AT TIME ZONE tz;
    local_t  := local_ts::TIME;

    -- Inside working hours → plain duration.
    IF EXTRACT(ISODOW FROM local_ts)::INTEGER = ANY(days)
       AND local_t >= start_t AND local_t < end_t THEN
        RETURN anchor + make_interval(mins => minutes);
    END IF;

    -- Outside working hours → off-hours due time on the next working day. Before opening
    -- on a working day, "next working day" is today.
    due_day := local_ts::DATE;
    IF NOT (EXTRACT(ISODOW FROM due_day)::INTEGER = ANY(days) AND local_t < start_t) THEN
        due_day := due_day + 1;
        FOR i IN 1..7 LOOP
            EXIT WHEN EXTRACT(ISODOW FROM due_day)::INTEGER = ANY(days);
            due_day := due_day + 1;
        END LOOP;
    END IF;

    -- Institute-local wall clock → absolute instant → session-zone TIMESTAMP.
    RETURN ((due_day + off_t) AT TIME ZONE tz)::TIMESTAMP;
END;
$$;
