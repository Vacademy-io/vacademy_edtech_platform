package vacademy.io.admin_core_service.features.crm_dashboard.service;

/**
 * SQL for the CRM Dashboard aggregates.
 *
 * <p>{@link #VIS} is the lead visibility of the CRM Leads list
 * ({@code AudienceResponseRepository.findInstituteLeadsWithFilters}) copied predicate
 * for predicate: same owner match (ENQUIRY-linked counsellor OR profile owner), same
 * unassigned-pool rule, same granted-lists bound, soft-deleted and opted-out leads
 * hidden. Change it only together with that query, or the dashboard stops agreeing
 * with the list a number links to.
 *
 * <p>Binds: instituteId, ownerCsv (single-owner narrow: forced self or a team),
 * scopeCsv (sub-org members / counsellor subtree), includeUnassigned, allowedCsv,
 * audienceId (one lead list, or empty for all).
 * Empty string = no restriction for the three CSVs. Window columns hold UTC wall
 * clock, so instants are bound as UTC LocalDateTime.
 */
final class CrmDashboardSql {

    private CrmDashboardSql() {
    }

    static final String STATUS_KEY =
            "COALESCE((SELECT lst.status_key FROM lead_status lst WHERE lst.id = ar.lead_status_id), ulp.conversion_status)";

    static final String VIS = """
            WITH vis AS (
                SELECT ar.id, ar.audience_id, ar.submitted_at, ar.source_type,
                       COALESCE(ulp.assigned_counselor_id, lu.user_id) AS owner_id,
                       ulp.conversion_status, ulp.converted_at, ulp.first_response_at,
                       ulp.last_activity_at, ulp.user_id AS profile_user_id,
                       ulp.lead_tier, ulp.best_score,
                       %s AS status_key
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                LEFT JOIN LATERAL (
                    SELECT lu.user_id
                    FROM linked_users lu
                    WHERE lu.source = 'ENQUIRY' AND lu.source_id = ar.enquiry_id
                    ORDER BY lu.created_at DESC
                    LIMIT 1
                ) lu ON true
                LEFT JOIN user_lead_profile ulp
                    ON ulp.user_id = ar.user_id AND ulp.institute_id = a.institute_id
                WHERE a.institute_id = :instituteId
                  AND (:ownerCsv = ''
                       OR lu.user_id = ANY(STRING_TO_ARRAY(:ownerCsv, ','))
                       OR ulp.assigned_counselor_id = ANY(STRING_TO_ARRAY(:ownerCsv, ',')))
                  AND (:scopeCsv = ''
                       OR lu.user_id = ANY(STRING_TO_ARRAY(:scopeCsv, ','))
                       OR ulp.assigned_counselor_id = ANY(STRING_TO_ARRAY(:scopeCsv, ','))
                       OR (:includeUnassigned = TRUE AND lu.user_id IS NULL AND ulp.assigned_counselor_id IS NULL))
                  AND (:allowedCsv = '' OR ar.audience_id = ANY(STRING_TO_ARRAY(:allowedCsv, ',')))
                  AND (:audienceId = '' OR ar.audience_id = :audienceId)
                  AND ar.audience_status = 'ACTIVE'
                  AND (ar.overall_status IS NULL OR ar.overall_status != 'OPTED_OUT')
                  %s
            )
            """;

    /** VIS limited to leads that arrived in [:seriesFrom, :to). */
    static String visSubmittedIn() {
        return VIS.formatted(STATUS_KEY,
                "AND ar.submitted_at >= :seriesFrom AND ar.submitted_at < :to");
    }

    /** VIS over every visible lead (current-state blocks). */
    static String visAll() {
        return VIS.formatted(STATUS_KEY, "");
    }

    /** New leads per day (and how many of them were contacted) over previous + current period, one scan. */
    static final String DAILY_LEADS = """
            SELECT (v.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day, COUNT(*) AS n,
                   COUNT(*) FILTER (WHERE v.first_response_at IS NOT NULL) AS contacted
            FROM vis v
            GROUP BY 1
            """;

    /** Conversions per day: visible leads whose profile converted inside the series window. */
    static final String DAILY_CONVERTED = """
            SELECT (x.converted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day, COUNT(*) AS n
            FROM (
                SELECT DISTINCT v.profile_user_id, v.converted_at
                FROM vis v
                WHERE v.conversion_status = 'CONVERTED'
                  AND v.converted_at >= :seriesFrom AND v.converted_at < :to
            ) x
            GROUP BY 1
            """;

    /** First-response stats for leads that arrived in the current period. */
    static final String FIRST_RESPONSE = """
            SELECT COUNT(*) AS leads,
                   COUNT(*) FILTER (WHERE v.first_response_at IS NOT NULL) AS contacted,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (v.first_response_at - v.submitted_at)) / 60.0)
                       FILTER (WHERE v.first_response_at >= v.submitted_at) AS median_minutes
            FROM vis v
            WHERE v.submitted_at >= :from
            """;

    static final String PIPELINE = """
            SELECT COALESCE(v.status_key, '__NO_STATUS__') AS status_key, COUNT(*) AS n
            FROM vis v
            WHERE v.submitted_at >= :from
            GROUP BY 1
            ORDER BY 2 DESC
            """;

    static final String SOURCES = """
            SELECT COALESCE(NULLIF(v.source_type, ''), 'UNKNOWN') AS source, COUNT(*) AS leads,
                   COUNT(*) FILTER (WHERE v.conversion_status = 'CONVERTED') AS converted
            FROM vis v
            WHERE v.submitted_at >= :from
            GROUP BY 1
            ORDER BY 2 DESC
            LIMIT 12
            """;

    static final String LISTS = """
            SELECT v.audience_id, a.campaign_name AS name, a.campaign_type,
                   COUNT(*) AS leads,
                   COUNT(*) FILTER (WHERE v.first_response_at IS NOT NULL) AS contacted,
                   COUNT(*) FILTER (WHERE v.conversion_status = 'CONVERTED') AS converted
            FROM vis v
            JOIN audience a ON a.id = v.audience_id
            WHERE v.submitted_at >= :from
            GROUP BY v.audience_id, a.campaign_name, a.campaign_type
            ORDER BY leads DESC
            LIMIT 8
            """;

    static final String COUNSELLORS = """
            SELECT v.owner_id, COUNT(*) AS assigned,
                   COUNT(*) FILTER (WHERE v.first_response_at IS NOT NULL) AS contacted,
                   COUNT(*) FILTER (WHERE v.conversion_status = 'CONVERTED') AS converted,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM (v.first_response_at - v.submitted_at)) / 60.0)
                       FILTER (WHERE v.first_response_at >= v.submitted_at) AS median_minutes
            FROM vis v
            WHERE v.submitted_at >= :from AND v.owner_id IS NOT NULL
            GROUP BY v.owner_id
            ORDER BY converted DESC, assigned DESC
            LIMIT 50
            """;

    /** Open follow-ups past due per owner, on visible non-converted leads (the Follow-ups page rule). */
    static final String OVERDUE_BY_OWNER = """
            SELECT v.owner_id, COUNT(DISTINCT v.id) AS n
            FROM vis v
            JOIN lead_followup lf ON lf.audience_response_id = v.id
            WHERE lf.is_closed = FALSE AND lf.schedule_time IS NOT NULL AND lf.schedule_time < :now
              AND (v.conversion_status IS NULL OR v.conversion_status != 'CONVERTED')
              AND v.owner_id IS NOT NULL
            GROUP BY v.owner_id
            """;

    /**
     * Per lead list: all-time leads, arrived today, unassigned, an open follow-up past
     * due (non-converted), converted. Same rules as the quick views, grouped by list.
     */
    static final String LIST_STATS = """
            SELECT v.audience_id,
                   COUNT(*) AS leads,
                   COUNT(*) FILTER (WHERE v.submitted_at >= :todayStart) AS new_today,
                   COUNT(*) FILTER (WHERE v.owner_id IS NULL) AS unassigned,
                   COUNT(*) FILTER (WHERE v.conversion_status = 'CONVERTED') AS converted,
                   COUNT(*) FILTER (WHERE (v.conversion_status IS NULL OR v.conversion_status != 'CONVERTED')
                                     AND EXISTS (SELECT 1 FROM lead_followup lf
                                                  WHERE lf.audience_response_id = v.id AND lf.is_closed = FALSE
                                                    AND lf.schedule_time IS NOT NULL AND lf.schedule_time < :now)) AS overdue
            FROM vis v
            GROUP BY v.audience_id
            """;

    /** Leads per list per day over the last 14 days (for the card sparklines). */
    static final String LIST_DAILY = """
            SELECT v.audience_id, (v.submitted_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day, COUNT(*) AS n
            FROM vis v
            WHERE v.submitted_at >= :todayStart - INTERVAL '13 days'
            GROUP BY 1, 2
            """;

    /**
     * Quick-view counts for the leads pages, one scan. Each count matches a filter the
     * leads list already has: all, active (not converted), converted, unassigned (no
     * owner on either link), arrived today, and an open follow-up past due on a
     * non-converted lead (the Follow-ups page Overdue rule).
     */
    static final String VIEWS = """
            SELECT COUNT(*) AS all_leads,
                   COUNT(*) FILTER (WHERE v.conversion_status IS NULL OR v.conversion_status != 'CONVERTED') AS active,
                   COUNT(*) FILTER (WHERE v.conversion_status = 'CONVERTED') AS converted,
                   COUNT(*) FILTER (WHERE v.owner_id IS NULL) AS unassigned,
                   COUNT(*) FILTER (WHERE v.submitted_at >= :todayStart) AS new_today,
                   COUNT(*) FILTER (WHERE (v.conversion_status IS NULL OR v.conversion_status != 'CONVERTED')
                                     AND EXISTS (SELECT 1 FROM lead_followup lf
                                                  WHERE lf.audience_response_id = v.id AND lf.is_closed = FALSE
                                                    AND lf.schedule_time IS NOT NULL AND lf.schedule_time < :now)) AS followup_overdue
            FROM vis v
            """;

    /**
     * Open leads (not converted, not lost) by tier and by days since the last touch.
     * Tier is resolved like the leads list Tier filter (stored tier, else the
     * institute tier band for the score, else the default 80/50 bands), but per
     * (stored tier, score) group rather than per lead, so the band lookup runs a
     * few dozen times instead of once per lead.
     */
    static final String QUALITY = """
            , g AS (
                SELECT v.profile_user_id IS NOT NULL AS has_profile,
                       NULLIF(v.lead_tier, '') AS stored_tier, v.best_score,
                       CASE WHEN COALESCE(v.last_activity_at, v.submitted_at) >= :todayStart THEN 'TODAY'
                            WHEN COALESCE(v.last_activity_at, v.submitted_at) >= :todayStart - INTERVAL '3 days' THEN 'D1_3'
                            WHEN COALESCE(v.last_activity_at, v.submitted_at) >= :todayStart - INTERVAL '7 days' THEN 'D4_7'
                            WHEN COALESCE(v.last_activity_at, v.submitted_at) >= :todayStart - INTERVAL '14 days' THEN 'D8_14'
                            ELSE 'D15_PLUS' END AS age,
                       COUNT(*) AS n
                FROM vis v
                WHERE (v.conversion_status IS NULL OR v.conversion_status != 'CONVERTED')
                  AND (v.status_key IS NULL OR v.status_key NOT IN ('LOST', 'NOT_INTERESTED'))
                GROUP BY 1, 2, 3, 4
            )
            SELECT CASE WHEN NOT g.has_profile THEN 'NONE'
                        ELSE COALESCE(g.stored_tier,
                            (SELECT lt.tier_key FROM lead_tier lt
                              WHERE lt.institute_id = :instituteId AND lt.is_active = TRUE
                                AND lt.min_score IS NOT NULL AND g.best_score >= lt.min_score
                              ORDER BY lt.min_score DESC, lt.display_order ASC LIMIT 1),
                            CASE WHEN g.best_score >= 80 THEN 'HOT'
                                 WHEN g.best_score >= 50 THEN 'WARM'
                                 ELSE 'COLD' END) END AS tier,
                   g.age, SUM(g.n) AS n
            FROM g
            GROUP BY 1, 2
            """;

    /*
     * Calls. telephony_call_log carries institute_id and the counsellor, so it is
     * scoped by owner set directly; created_at keeps it on idx (institute_id, created_at).
     */
    static final String CALLS_WHERE = """
            FROM telephony_call_log tcl
            WHERE tcl.institute_id = :instituteId
              AND tcl.created_at >= :from AND tcl.created_at < :to
              AND COALESCE(tcl.provider_type, '') <> 'MOCK'
              AND (:callOwnerCsv = '' OR tcl.counsellor_user_id = ANY(STRING_TO_ARRAY(:callOwnerCsv, ',')))
            """;

    static final String CALLS_TOTALS = """
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE tcl.answer_time IS NOT NULL
                                     OR (tcl.status = 'COMPLETED' AND COALESCE(tcl.duration_seconds, 0) > 0)) AS connected,
                   COALESCE(SUM(tcl.duration_seconds), 0) AS talk_seconds,
                   COUNT(*) FILTER (WHERE tcl.provider_type IN ('VACADEMY_AI', 'AAVTAAR')) AS ai_calls
            """ + CALLS_WHERE;

    static final String CALLS_BY_STATUS = """
            SELECT COALESCE(tcl.status, 'UNKNOWN') AS status, COUNT(*) AS n
            """ + CALLS_WHERE + """
            GROUP BY 1
            ORDER BY 2 DESC
            """;

    static final String CALLS_HEATMAP = """
            SELECT EXTRACT(ISODOW FROM (tcl.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz))::int AS dow,
                   EXTRACT(HOUR FROM (tcl.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz))::int AS hour,
                   COUNT(*) AS n
            """ + CALLS_WHERE + """
              AND (tcl.answer_time IS NOT NULL
                   OR (tcl.status = 'COMPLETED' AND COALESCE(tcl.duration_seconds, 0) > 0))
            GROUP BY 1, 2
            """;

    static final String TIER_LABELS = """
            SELECT tier_key, label, color, display_order
            FROM lead_tier
            WHERE institute_id = :instituteId AND deleted_at IS NULL AND is_active = TRUE
            ORDER BY display_order ASC NULLS LAST
            """;

    static final String STATUS_LABELS = """
            SELECT status_key, label, color, display_order
            FROM lead_status
            WHERE institute_id = :instituteId AND deleted_at IS NULL
            ORDER BY display_order ASC NULLS LAST
            """;

    /** Counsellor pool shifts for one weekday (institute-wide; the page shows its own roster). */
    static final String SHIFTS_TODAY = """
            SELECT m.counselor_user_id AS user_id, p.id AS pool_id, p.name AS pool_name, s.label,
                   to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time
            FROM counselor_pool_shift s
            JOIN counselor_pool p ON p.id = s.pool_id
            JOIN counselor_pool_shift_member m ON m.shift_id = s.id
            WHERE p.institute_id = :instituteId AND s.day_of_week = :dow
              AND s.status = 'ACTIVE' AND m.status = 'ACTIVE'
            ORDER BY s.start_time, p.name
            LIMIT 500
            """;
}
