package vacademy.io.admin_core_service.features.engagement.report;

/**
 * SQL for the engagement daily report. Every query is bounded by the institute, the engines in
 * scope ({@code :engineIds}, never empty) and a time window, so a report is a handful of indexed
 * reads however long an engine has run.
 *
 * <p>Time parameters: engagement_*, ai_call_queue, lead_status_history, user_lead_profile and
 * booking_instance store naive UTC, so {@code :from}/{@code :to} (and the other window bounds)
 * are UTC LocalDateTimes. ai_usage_event and lead_candidate are timestamptz: the same bounds are
 * read as UTC explicitly ({@code CAST(:x AS timestamp) AT TIME ZONE 'UTC'}), so the session time
 * zone never shifts a day. {@code :tz} is a region id Postgres accepts (TimezoneNormalizer).
 */
final class EngagementDailyReportSql {

    private EngagementDailyReportSql() {
    }

    /** Action types that are CRM work, not a message, even on a SEND/TASK row. */
    private static final String NOT_CRM_ACTION =
            "COALESCE(a.action_type, '') NOT IN ('ADD_NOTE', 'CREATE_FOLLOWUP', 'ESCALATE', 'UPDATE_STATUS', 'SCHEDULE_AI_CALL')";

    /** The engine's audience selectors as rows; a malformed (non-array) audience reads as none. */
    static final String SELECTORS =
            "jsonb_array_elements(CASE WHEN jsonb_typeof(e.audience) = 'array' THEN e.audience ELSE '[]'::jsonb END)";

    // ── engines ──────────────────────────────────────────────────────────────

    /** Picker options. Archived engines keep their history, so they stay (last). */
    static final String ENGINES = """
            SELECT e.id, e.name, e.status, e.created_by
            FROM engagement_engine e
            WHERE e.institute_id = :instituteId AND e.status <> 'DELETED'
            ORDER BY CASE WHEN e.status = 'ARCHIVED' THEN 1 ELSE 0 END, e.created_at DESC
            """;

    // ── leads in ─────────────────────────────────────────────────────────────

    /** The lead lists each engine targets (AUDIENCE selectors), so a list shows even on a day it added no one. */
    static final String LIST_SELECTORS = """
            SELECT e.id AS engine_id, s.elem ->> 'id' AS list_id, au.campaign_name AS list_name
            FROM engagement_engine e
            CROSS JOIN LATERAL %s AS s(elem)
            LEFT JOIN audience au ON au.id = s.elem ->> 'id' AND au.institute_id = e.institute_id
            WHERE e.institute_id = :instituteId AND e.id IN (:engineIds)
              AND s.elem ->> 'type' = 'AUDIENCE'
            """.formatted(SELECTORS);

    /**
     * Members added on D, counted as distinct people (the lead row, else the user): one person two
     * engines took in is one lead for "All". A member without a lead row came from a batch
     * (PACKAGE_SESSION) or a named user (USER selector naming its user id). "New" = the lead row
     * itself was created on D. grp tells the three levels apart (GROUPING over engine, kind, list):
     * 0 = per engine and list, 4 = per list across the engines, 7 = everyone (one row, also on a
     * day that added no one).
     */
    static final String MEMBERS_ADDED = """
            WITH added AS (
                SELECT m.engine_id,
                       CASE WHEN m.audience_response_id IS NOT NULL THEN 'LIST'
                            WHEN EXISTS (SELECT 1 FROM %s AS s(elem)
                                          WHERE s.elem ->> 'type' = 'USER' AND s.elem ->> 'id' = m.user_id) THEN 'USERS'
                            ELSE 'BATCH' END AS kind,
                       COALESCE(ar.original_audience_id, ar.audience_id) AS list_id,
                       au.campaign_name AS list_name,
                       COALESCE(m.audience_response_id, 'u:' || m.user_id) AS person,
                       (ar.created_at >= :from AND ar.created_at < :to) AS is_new
                FROM engagement_member m
                JOIN engagement_engine e ON e.id = m.engine_id
                LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                LEFT JOIN audience au ON au.id = COALESCE(ar.original_audience_id, ar.audience_id)
                WHERE m.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                  AND m.created_at >= :from AND m.created_at < :to
            )
            SELECT GROUPING(engine_id, kind, list_id) AS grp, engine_id, kind, list_id,
                   MAX(list_name) AS list_name,
                   COUNT(DISTINCT person) AS leads_added,
                   COUNT(DISTINCT person) FILTER (WHERE is_new) AS new_leads
            FROM added
            GROUP BY GROUPING SETS ((engine_id, kind, list_id), (kind, list_id), ())
            """.formatted(SELECTORS);

    /** Lead Agents feeding these lists, with D's "already in your leads" skips. */
    static final String LEAD_AGENTS = """
            SELECT la.id AS agent_id, la.name, la.audience_id AS list_id, la.status,
                   (SELECT COUNT(*) FROM lead_candidate c
                     WHERE c.agent_id = la.id AND c.status = 'SKIPPED'
                       AND c.delivery_note LIKE 'Already in your leads%'
                       AND c.updated_at >= (CAST(:from AS timestamp) AT TIME ZONE 'UTC')
                       AND c.updated_at < (CAST(:to AS timestamp) AT TIME ZONE 'UTC')) AS already_in_crm
            FROM lead_agent la
            WHERE la.institute_id = :instituteId AND la.audience_id IN (:listIds)
            """;

    /** The agents' own day counters (agent's window time zone; same calendar day), trend range. */
    static final String LEAD_AGENT_DAYS = """
            SELECT d.agent_id, d.day::text AS day, d.discovered, d.researched, d.delivered, d.review,
                   d.rejected, d.searches, d.pages, d.cost_usd, d.credits
            FROM lead_agent_day d
            JOIN lead_agent la ON la.id = d.agent_id
            WHERE la.institute_id = :instituteId AND la.audience_id IN (:listIds)
              AND d.day >= CAST(:trendFromDay AS date) AND d.day <= CAST(:day AS date)
            """;

    // ── runs ─────────────────────────────────────────────────────────────────

    /** Everything the engines decided on D, per engine. */
    static final String RUNS = """
            SELECT a.engine_id,
                   COUNT(*) AS decisions,
                   COUNT(DISTINCT a.member_id) AS members,
                   COUNT(*) FILTER (WHERE a.kind = 'SEND') AS k_send,
                   COUNT(*) FILTER (WHERE a.kind = 'TASK') AS k_task,
                   COUNT(*) FILTER (WHERE a.kind = 'NO_OP') AS k_noop,
                   COUNT(*) FILTER (WHERE a.kind = 'REPLY') AS k_reply,
                   COUNT(*) FILTER (WHERE a.status = 'FAILED') AS failed,
                   COUNT(*) FILTER (WHERE a.status = 'EXPIRED') AS expired,
                   COUNT(*) FILTER (WHERE a.kind = 'REPLY'
                                      AND (a.rationale ILIKE 'Asked to stop%' OR a.rationale ILIKE 'Asked by email to stop%')) AS opt_outs,
                   COALESCE(SUM(a.llm_tokens_in), 0) AS tokens_in,
                   COALESCE(SUM(a.llm_tokens_out), 0) AS tokens_out,
                   COUNT(*) FILTER (WHERE a.llm_tokens_in IS NOT NULL OR a.llm_tokens_out IS NOT NULL) AS with_usage,
                   COALESCE(SUM(a.llm_cost_usd), 0) AS ai_usd
            FROM engagement_action a
            WHERE a.engine_id IN (:engineIds) AND a.created_at >= :from AND a.created_at < :to
            GROUP BY a.engine_id
            """;

    static final String TOP_ERRORS = """
            SELECT LEFT(a.error_message, 300) AS message, COUNT(*) AS n
            FROM engagement_action a
            WHERE a.engine_id IN (:engineIds) AND a.created_at >= :from AND a.created_at < :to
              AND a.status = 'FAILED' AND a.error_message IS NOT NULL
            GROUP BY 1
            ORDER BY n DESC, message
            LIMIT 5
            """;

    /** First decision carrying token data, looked for from {@code :trackedLookback} (the report's oldest day). */
    static final String AI_TRACKED_SINCE = """
            SELECT MIN(a.created_at) AS first_at
            FROM engagement_action a
            WHERE a.engine_id IN (:engineIds) AND a.created_at >= :trackedLookback
              AND (a.llm_model IS NOT NULL OR a.llm_tokens_in IS NOT NULL)
            """;

    // ── outreach ─────────────────────────────────────────────────────────────

    /**
     * Messages that went out (or failed going out) from {@code :signalsFrom} to the end of D: the
     * trend's sends, D's sends, and the earlier sends a reply on D can belong to. A SEND row, or a
     * TASK a person approved and sent (copilot mode). Message channels only; CRM tasks excluded.
     * created_at bounds the scan to the engine index (a send goes out within hours of its draft).
     * An email drafted on an approved email template carries its id (EngagementDispatcher
     * VAR_EMAIL_TEMPLATE); its name is read when the template is still the engine's.
     */
    static final String SENDS = """
            SELECT a.id, a.engine_id, a.kind, a.channel, a.status, a.template_name,
                   a.variables_json ->> '_subject' AS subject,
                   a.variables_json ->> '_emailTemplateId' AS email_template_id,
                   et.name AS email_template_name,
                   a.dispatched_at
            FROM engagement_action a
            LEFT JOIN engagement_email_template et
                   ON a.channel = 'EMAIL' AND et.id = a.variables_json ->> '_emailTemplateId'
                  AND et.engine_id = a.engine_id
            WHERE a.engine_id IN (:engineIds)
              AND a.created_at >= :scanFrom
              AND a.dispatched_at >= :signalsFrom AND a.dispatched_at < :to
              AND a.kind IN ('SEND', 'TASK')
              AND a.channel IN ('EMAIL', 'WHATSAPP', 'IN_APP')
              AND a.status IN ('SENT', 'FAILED')
              AND %s
            """.formatted(NOT_CRM_ACTION);

    /**
     * AI calls the engines queued, per engine and local day of queueing (trend range). A call is
     * counted once per call log; credits are the call's telephony + AI-calling meters, whenever
     * they were billed.
     */
    static final String CALLS = """
            WITH calls AS (
                SELECT a.engine_id, q.id AS queue_id, q.status AS queue_status, q.call_log_id,
                       (q.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                       t.status AS call_status, t.duration_seconds
                FROM ai_call_queue q
                JOIN engagement_action a ON a.id = q.source_ref
                LEFT JOIN telephony_call_log t ON t.id = q.call_log_id
                WHERE q.institute_id = :instituteId AND q.source = 'ENGAGEMENT_ENGINE'
                  AND q.created_at >= :trendFrom AND q.created_at < :to
                  AND a.engine_id IN (:engineIds)
            ),
            billed AS (
                SELECT u.context ->> 'call_log_id' AS call_log_id, u.credits_charged - u.refunded_credits AS credits
                FROM ai_usage_event u
                WHERE u.institute_id = :instituteId AND u.use_case = 'telephony'
                  AND u.occurred_at >= (CAST(:trendFrom AS timestamp) AT TIME ZONE 'UTC')
                  AND u.context ->> 'call_log_id' IN (SELECT call_log_id FROM calls WHERE call_log_id IS NOT NULL)
                UNION ALL
                SELECT r.call_log_id, u.credits_charged - u.refunded_credits
                FROM ai_usage_event u
                JOIN ai_call_result r ON r.id = u.context ->> 'ai_call_result_id'
                WHERE u.institute_id = :instituteId AND u.use_case = 'ai_calling'
                  AND u.occurred_at >= (CAST(:trendFrom AS timestamp) AT TIME ZONE 'UTC')
                  AND r.call_log_id IN (SELECT call_log_id FROM calls WHERE call_log_id IS NOT NULL)
            ),
            credits AS (
                SELECT call_log_id, SUM(credits) AS credits FROM billed GROUP BY call_log_id
            )
            SELECT c.engine_id, c.day::text AS day,
                   COUNT(DISTINCT c.queue_id) AS placed,
                   COUNT(DISTINCT c.queue_id) FILTER (WHERE c.queue_status IN ('FAILED', 'EXPIRED', 'CANCELLED')) AS not_dialled,
                   COUNT(DISTINCT c.call_log_id) FILTER (WHERE c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS connected,
                   COUNT(DISTINCT c.call_log_id) FILTER (WHERE c.call_status = 'NO_ANSWER'
                                                           AND NOT c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS no_answer,
                   COUNT(DISTINCT c.call_log_id) FILTER (WHERE c.call_status = 'BUSY'
                                                           AND NOT c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS busy,
                   COUNT(DISTINCT c.call_log_id) FILTER (WHERE c.call_status = 'FAILED'
                                                           AND NOT c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS failed,
                   COUNT(DISTINCT c.queue_id) FILTER (WHERE (c.call_log_id IS NULL AND c.queue_status IN ('QUEUED', 'DISPATCHING'))
                                                       OR (c.call_status IN ('QUEUED', 'INITIATED', 'IN_PROGRESS', 'COUNSELLOR_RINGING', 'COUNSELLOR_ANSWERED')
                                                           AND NOT c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ',')))) AS in_progress,
                   COALESCE(SUM(c.duration_seconds), 0) AS total_seconds,
                   AVG(c.duration_seconds) FILTER (WHERE c.call_status = ANY(STRING_TO_ARRAY(:connectedCsv, ','))) AS avg_connected_sec,
                   COALESCE(SUM(cr.credits), 0) AS credits
            FROM calls c
            LEFT JOIN credits cr ON cr.call_log_id = c.call_log_id
            GROUP BY c.engine_id, c.day
            """;

    // ── costs ────────────────────────────────────────────────────────────────

    /**
     * Engine message credits per engine, channel and local day (trend range). A row the
     * credit_transactions backfill wrote has no engine_id; its external_reference_id is the action.
     */
    static final String MESSAGE_CREDITS = """
            SELECT COALESCE(u.context ->> 'engine_id', a.engine_id) AS engine_id,
                   COALESCE(u.context ->> 'channel', a.channel) AS channel,
                   (u.occurred_at AT TIME ZONE :tz)::date::text AS day,
                   SUM(u.credits_charged - u.refunded_credits) AS credits
            FROM ai_usage_event u
            LEFT JOIN engagement_action a
                   ON u.context ->> 'engine_id' IS NULL AND a.id = u.context ->> 'external_reference_id'
            WHERE u.institute_id = :instituteId AND u.use_case = 'engagement_message'
              AND u.occurred_at >= (CAST(:trendFrom AS timestamp) AT TIME ZONE 'UTC')
              AND u.occurred_at < (CAST(:to AS timestamp) AT TIME ZONE 'UTC')
              AND COALESCE(u.context ->> 'engine_id', a.engine_id) IN (:engineIds)
            GROUP BY 1, 2, 3
            """;

    /** Balance now, and the institute's net credits over the last 7 days (all features) for the runway. */
    static final String CREDIT_BALANCE = """
            SELECT (SELECT ic.current_balance FROM institute_credits ic WHERE ic.institute_id = :instituteId) AS balance,
                   (SELECT COALESCE(SUM(u.credits_charged - u.refunded_credits), 0)
                      FROM ai_usage_event u
                     WHERE u.institute_id = :instituteId AND u.occurred_at >= now() - interval '7 days') AS last7
            """;

    // ── outcomes ─────────────────────────────────────────────────────────────

    /**
     * lead_status_history.source values a person wrote: the lead page (MANUAL), the leads list's
     * bulk change (BULK_MANUAL) and a counsellor's call disposition (MANUAL_DISPOSITION). Every
     * other source except the engine is automation (AI_CALLING, AI_WORKFLOW, WHATSAPP_FLOW,
     * COLD_EMAIL_REPLY, BACKFILL, ...).
     */
    static final String HUMAN_STATUS_SOURCES = "'MANUAL', 'BULK_MANUAL', 'MANUAL_DISPOSITION'";

    /** Lead status moves of the engines' leads per local day (trend range), from → to, by actor. */
    /**
     * WhatsApp templates the engine(s) proposed on D: the category each was proposed in, where it
     * stands now (admin review, Meta, live, rejected, withdrawn) and the category Meta gave it, so a
     * utility proposal Meta moved to marketing (the expensive category) shows up.
     */
    static final String NEW_TEMPLATES = """
            SELECT UPPER(COALESCE(p.proposed_category, 'UNKNOWN')) AS proposed_category, p.status,
                   UPPER(p.meta_category) AS meta_category, COUNT(*) AS n
            FROM engagement_template_proposal p
            WHERE p.institute_id = :instituteId AND p.engine_id IN (:engineIds)
              AND p.created_at >= :from AND p.created_at < :to
            GROUP BY 1, 2, 3
            """;

    static final String STATUS_CHANGES = """
            SELECT (h.changed_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date::text AS day,
                   fs.label AS from_label, ts.label AS to_label,
                   COUNT(*) FILTER (WHERE h.source = 'ENGAGEMENT_ENGINE') AS by_engine,
                   COUNT(*) FILTER (WHERE h.source IN (%1$s)) AS by_team,
                   COUNT(*) FILTER (WHERE COALESCE(h.source, '') NOT IN ('ENGAGEMENT_ENGINE', %1$s)) AS by_automation
            FROM lead_status_history h
            LEFT JOIN lead_status fs ON fs.id = h.from_status_id
            LEFT JOIN lead_status ts ON ts.id = h.to_status_id
            WHERE h.institute_id = :instituteId
              AND h.changed_at >= :trendFrom AND h.changed_at < :to
              AND h.audience_response_id IN (SELECT m.audience_response_id FROM engagement_member m
                                              WHERE m.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                                                AND m.audience_response_id IS NOT NULL)
            GROUP BY 1, 2, 3
            """.formatted(HUMAN_STATUS_SOURCES);

    /**
     * Engine leads converted on D (EngagementCrmMirrorDao's rule): the lead row moved to a
     * CONVERTED status, or the person's lead profile was converted. One row per engine and
     * person (the user, else the lead row), so a person converted on two lead rows, or by both
     * rules, counts once.
     */
    static final String CONVERSIONS = """
            SELECT m.engine_id, COALESCE(m.user_id, m.audience_response_id) AS lead_key
            FROM lead_status_history h
            JOIN engagement_member m ON m.audience_response_id = h.audience_response_id
                                    AND m.institute_id = h.institute_id
            WHERE h.institute_id = :instituteId
              AND h.to_status_id IN (SELECT ls.id FROM lead_status ls
                                      WHERE ls.institute_id = :instituteId AND ls.status_key = 'CONVERTED')
              AND h.changed_at >= :from AND h.changed_at < :to
              AND m.engine_id IN (:engineIds)
            UNION
            SELECT m.engine_id, COALESCE(m.user_id, m.audience_response_id)
            FROM user_lead_profile ulp
            JOIN engagement_member m ON m.user_id = ulp.user_id AND m.institute_id = ulp.institute_id
            WHERE ulp.institute_id = :instituteId
              AND ulp.conversion_status = 'CONVERTED'
              AND ulp.converted_at >= :from AND ulp.converted_at < :to
              AND m.audience_response_id IS NOT NULL
              AND m.engine_id IN (:engineIds)
            """;

    /**
     * Meetings of the engines' leads: booked in the trend range (not cancelled, not a reschedule)
     * or scheduled on D (not cancelled or rescheduled), with the mentor's outcome when marked.
     * Matched by lead row or by the invitee's account, as EngagementCrmMirrorDao matches them.
     */
    static final String BOOKINGS = """
            WITH b AS (
                SELECT m.engine_id, bi.id, bi.status, bi.reschedule_of_instance_id, bi.created_at, bi.scheduled_start_utc
                FROM booking_instance bi
                JOIN engagement_member m ON m.audience_response_id = bi.audience_response_id
                                        AND m.institute_id = bi.institute_id
                WHERE bi.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                  AND ((bi.created_at >= :trendFrom AND bi.created_at < :to)
                       OR (bi.scheduled_start_utc >= :from AND bi.scheduled_start_utc < :to))
                UNION
                SELECT m.engine_id, bi.id, bi.status, bi.reschedule_of_instance_id, bi.created_at, bi.scheduled_start_utc
                FROM booking_instance bi
                JOIN engagement_member m ON m.user_id = bi.invitee_user_id
                                        AND m.institute_id = bi.institute_id
                WHERE bi.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                  AND bi.invitee_user_id IS NOT NULL
                  AND ((bi.created_at >= :trendFrom AND bi.created_at < :to)
                       OR (bi.scheduled_start_utc >= :from AND bi.scheduled_start_utc < :to))
            )
            SELECT b.engine_id, b.id AS booking_id,
                   CASE WHEN b.created_at >= :trendFrom AND b.created_at < :to
                             AND b.status <> 'CANCELLED' AND b.reschedule_of_instance_id IS NULL
                        THEN (b.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date::text END AS booked_day,
                   (b.scheduled_start_utc >= :from AND b.scheduled_start_utc < :to
                       AND b.status NOT IN ('CANCELLED', 'RESCHEDULED')) AS scheduled_on_day,
                   r.outcome
            FROM b
            LEFT JOIN mentor_session_record r ON r.booking_instance_id = b.id
            """;
}
