package vacademy.io.admin_core_service.features.engagement.report;

/**
 * SQL for the engagement diagnosis, the per-person and per-call detail the daily report only keeps as
 * totals. Same rules as {@link EngagementDailyReportSql}: every query is bounded by the institute, the
 * engines in scope ({@code :engineIds}, never empty) and a time window, and times are naive UTC.
 */
final class EngagementDiagnosisSql {

    private EngagementDiagnosisSql() {
    }

    /**
     * One row per person added in the period (the report's leadsAdded), with their contact from the
     * student row and the lead row, as the leads drill-down reads it, and the Lead Agent source that
     * delivered the lead row. lead_candidate has no index on delivered_response_id, so the sources are
     * read per institute (idx_lead_candidate_institute_status) and joined.
     */
    static final String LEADS = EngagementReportItemsSql.LEADS_ADDED.formatted("TRUE") + """
            SELECT i.item_key AS person,
                   st.mobile_number AS st_phone, st.email AS st_email,
                   lr.parent_mobile AS lead_phone, lr.parent_email AS lead_email,
                   lc.source
            FROM items i
            LEFT JOIN LATERAL (SELECT s.mobile_number, s.email FROM student s
                                WHERE s.user_id = i.user_id
                                ORDER BY s.created_at DESC NULLS LAST LIMIT 1) st ON TRUE
            LEFT JOIN audience_response lr ON lr.id = i.audience_response_id
            LEFT JOIN (SELECT DISTINCT ON (c.delivered_response_id) c.delivered_response_id, c.source
                         FROM lead_candidate c
                        WHERE c.institute_id = :instituteId AND c.delivered_response_id IS NOT NULL
                        ORDER BY c.delivered_response_id, c.delivered_at DESC NULLS LAST) lc
                   ON lc.delivered_response_id = i.audience_response_id
            """;

    /** The Lead Agents feeding these lists. created_at is timestamptz, read as naive UTC like the bounds. */
    static final String LEAD_AGENTS = """
            SELECT la.id AS agent_id, la.name, la.status, la.created_at AT TIME ZONE 'UTC' AS created_at,
                   la.window_json::text AS window_json
            FROM lead_agent la
            WHERE la.institute_id = :instituteId AND la.audience_id IN (:listIds)
            """;

    /**
     * Messages dispatched in [{@code :sendsFrom}, {@code :sendsTo}): the report's SENDS with who they
     * went to and the prompt version that wrote them, plus REPLY rows, whose first reply is one more
     * moment the person wrote in. {@code :scanFrom} keeps the scan on idx_ea_engine, as in SENDS.
     */
    static final String ACTIONS = """
            SELECT a.id, a.engine_id, a.kind, a.channel, a.status, a.prompt_version_id, a.template_name,
                   a.variables_json ->> '_subject' AS subject,
                   a.variables_json ->> '_emailTemplateId' AS email_template_id,
                   et.name AS email_template_name,
                   a.dispatched_at, m.user_id, m.audience_response_id
            FROM engagement_action a
            JOIN engagement_member m ON m.id = a.member_id
            LEFT JOIN engagement_email_template et
                   ON a.channel = 'EMAIL' AND et.id = a.variables_json ->> '_emailTemplateId'
                  AND et.engine_id = a.engine_id
            WHERE a.engine_id IN (:engineIds)
              AND a.created_at >= :scanFrom
              AND a.dispatched_at >= :sendsFrom AND a.dispatched_at < :sendsTo
              AND a.kind IN ('SEND', 'TASK', 'REPLY')
              AND a.channel IN ('EMAIL', 'WHATSAPP', 'IN_APP')
              AND a.status IN ('SENT', 'FAILED')
              AND %s
            """.formatted(EngagementDailyReportSql.NOT_CRM_ACTION);

    /**
     * The AI calls queued in the period, one row per queue row, as the report's CALLS counts them. The
     * hour comes from the call log's created_at, when the dial started: start_time is empty on every AI
     * provider's rows and not UTC on Exotel's. Only finished analyses (status COMPLETED) count;
     * call_analysis.objections is the path CallIntelligenceQueryService reads.
     */
    static final String CALLS = """
            SELECT q.id AS queue_id, q.status AS queue_status, q.call_log_id,
                   m.user_id, m.audience_response_id,
                   t.status AS call_status, t.duration_seconds,
                   COALESCE(t.status = ANY(STRING_TO_ARRAY(:connectedCsv, ',')), FALSE) AS connected,
                   EXTRACT(HOUR FROM (t.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz))::int AS local_hour,
                   ci.id IS NOT NULL AS analysed,
                   ci.generic_status, ci.lead_sentiment, ci.conversion_likelihood,
                   (ci.analysis_json -> 'call_analysis' -> 'objections')::text AS objections
            FROM ai_call_queue q
            JOIN engagement_action a ON a.id = q.source_ref
            JOIN engagement_member m ON m.id = a.member_id
            LEFT JOIN telephony_call_log t ON t.id = q.call_log_id
            LEFT JOIN call_intelligence ci ON ci.call_log_id = q.call_log_id AND ci.status = 'COMPLETED'
            WHERE q.institute_id = :instituteId AND q.source = 'ENGAGEMENT_ENGINE'
              AND q.created_at >= :from AND q.created_at < :to
              AND a.engine_id IN (:engineIds)
            """;

    /** The bookings the report counts as demos booked in the period, with whose they are. */
    static final String BOOKINGS = EngagementReportItemsSql.DEMOS_BOOKED.formatted("TRUE") + """
            SELECT i.item_key AS booking_id, i.user_id, i.audience_response_id, i.booked_at
            FROM items i
            """;

    /** Prompt versions of the engines in scope, by id (the ones with sends in the period). */
    static final String PROMPT_VERSIONS = """
            SELECT v.id, v.engine_id, e.name AS engine_name, v.version, v.created_at, v.source,
                   LEFT(v.delta_text, %d) AS change
            FROM engagement_prompt_version v
            JOIN engagement_engine e ON e.id = v.engine_id
            WHERE v.id IN (:versionIds) AND v.engine_id IN (:engineIds)
            """.formatted(EngagementDiagnosisRules.PROMPT_CHANGE_CHARS);

    /**
     * ACTIVE members whose next action is long past, on engines the sweep picks up (the status set of
     * EngagementEngineRepository.findDueEngines: a due member of any other engine is not late). This
     * is the state now, whatever the period; idx_em_due covers it.
     */
    static final String STUCK_MEMBERS = """
            SELECT COUNT(*) AS n
            FROM engagement_member m
            JOIN engagement_engine e ON e.id = m.engine_id
            WHERE m.engine_id IN (:engineIds)
              AND m.status = 'ACTIVE'
              AND m.next_action_at < :stuckBefore
              AND e.status IN ('ACTIVE', 'DRY_RUN')
            """;
}
