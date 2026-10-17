package vacademy.io.admin_core_service.features.group_dashboard.service;

/**
 * SQL for the group dashboards (Contacts, Automations, Engagement). Every query is
 * bounded by the institute and, where it reads events, by the requested window.
 */
final class GroupDashboardSql {

    private GroupDashboardSql() {
    }

    // ── Contacts ─────────────────────────────────────────────────────────────

    private static final String CONTACT_CTES = """
            WITH learners AS (
                SELECT m.user_id, MIN(m.created_at) AS first_at,
                       BOOL_OR(m.status = 'ACTIVE') AS active,
                       BOOL_OR(m.status = 'INVITED') AS invited
                FROM student_session_institute_group_mapping m
                WHERE m.institute_id = :instituteId AND m.status <> 'DELETED' AND m.user_id IS NOT NULL
                GROUP BY m.user_id
            ),
            leads AS (
                SELECT ar.user_id, MIN(ar.submitted_at) AS first_at
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                WHERE a.institute_id = :instituteId AND ar.user_id IS NOT NULL
                  AND COALESCE(ar.audience_status, 'ACTIVE') = 'ACTIVE'
                GROUP BY ar.user_id
            )
            """;

    static final String CONTACTS_SUMMARY = CONTACT_CTES + """
            SELECT
                (SELECT COUNT(*) FROM learners) AS learners,
                (SELECT COUNT(*) FILTER (WHERE active) FROM learners) AS active_learners,
                (SELECT COUNT(*) FILTER (WHERE invited AND NOT active) FROM learners) AS invited_learners,
                (SELECT COUNT(*) FROM leads) AS leads,
                (SELECT COUNT(*) FROM leads l JOIN learners s ON s.user_id = l.user_id) AS both_count,
                (SELECT COUNT(*) FROM learners WHERE first_at >= :from AND first_at < :to) AS new_learners,
                (SELECT COUNT(*) FROM leads WHERE first_at >= :from AND first_at < :to) AS new_leads,
                (SELECT COUNT(*) FROM learners WHERE first_at >= :prevFrom AND first_at < :from) AS prev_new_learners,
                (SELECT COUNT(*) FROM leads WHERE first_at >= :prevFrom AND first_at < :from) AS prev_new_leads,
                (SELECT COUNT(DISTINCT ut.user_id) FROM user_tags ut
                  WHERE ut.institute_id = :instituteId AND ut.status = 'ACTIVE') AS tagged
            """;

    static final String CONTACTS_DAILY = CONTACT_CTES + """
            SELECT d.day::date::text AS day,
                   COALESCE(lr.n, 0) AS learners,
                   COALESCE(ld.n, 0) AS leads
            FROM generate_series(CAST(:fromDay AS date), CAST(:toDay AS date), interval '1 day') AS d(day)
            LEFT JOIN (SELECT (first_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day, COUNT(*) AS n
                       FROM learners WHERE first_at >= :from AND first_at < :to GROUP BY 1) lr
                   ON lr.day = d.day::date
            LEFT JOIN (SELECT (first_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day, COUNT(*) AS n
                       FROM leads WHERE first_at >= :from AND first_at < :to GROUP BY 1) ld
                   ON ld.day = d.day::date
            ORDER BY d.day
            """;

    static final String CONTACTS_TAGS = """
            SELECT t.id AS tag_id, t.tag_name AS name, COUNT(DISTINCT ut.user_id) AS users
            FROM user_tags ut
            JOIN tags t ON t.id = ut.tag_id
            WHERE ut.institute_id = :instituteId AND ut.status = 'ACTIVE' AND t.status = 'ACTIVE'
            GROUP BY t.id, t.tag_name
            ORDER BY users DESC
            LIMIT 8
            """;

    // ── Automations ──────────────────────────────────────────────────────────

    static final String WF_TOTALS = """
            SELECT
                COUNT(*) FILTER (WHERE we.created_at >= :from AND we.created_at < :to) AS runs,
                COUNT(*) FILTER (WHERE we.created_at >= :from AND we.created_at < :to AND we.status = 'FAILED') AS failed,
                COUNT(*) FILTER (WHERE we.created_at >= :prevFrom AND we.created_at < :from) AS prev_runs,
                COUNT(*) FILTER (WHERE we.created_at >= :prevFrom AND we.created_at < :from AND we.status = 'FAILED') AS prev_failed,
                COUNT(DISTINCT we.workflow_id) FILTER (WHERE we.created_at >= :from AND we.created_at < :to) AS workflows_ran,
                (SELECT COUNT(*) FROM workflow w2 WHERE w2.institute_id = :instituteId AND w2.status = 'ACTIVE') AS active_workflows,
                (SELECT COUNT(*) FROM workflow w3 WHERE w3.institute_id = :instituteId AND w3.status <> 'DELETED') AS total_workflows
            FROM workflow w
            JOIN workflow_execution we ON we.workflow_id = w.id
            WHERE w.institute_id = :instituteId AND we.created_at >= :prevFrom AND we.created_at < :to
            """;

    static final String WF_DAILY = """
            SELECT d.day::date::text AS day, COALESCE(x.runs, 0) AS runs, COALESCE(x.failed, 0) AS failed
            FROM generate_series(CAST(:fromDay AS date), CAST(:toDay AS date), interval '1 day') AS d(day)
            LEFT JOIN (
                SELECT (we.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                       COUNT(*) AS runs, COUNT(*) FILTER (WHERE we.status = 'FAILED') AS failed
                FROM workflow w JOIN workflow_execution we ON we.workflow_id = w.id
                WHERE w.institute_id = :instituteId AND we.created_at >= :from AND we.created_at < :to
                GROUP BY 1
            ) x ON x.day = d.day::date
            ORDER BY d.day
            """;

    static final String WF_PER_WORKFLOW = """
            SELECT w.id AS workflow_id, w.name, w.status,
                   COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE we.status = 'FAILED') AS failed,
                   MAX(we.created_at) FILTER (WHERE we.status = 'FAILED') AS last_failed_at,
                   (ARRAY_AGG(LEFT(we.error_message, 200) ORDER BY we.created_at DESC)
                        FILTER (WHERE we.status = 'FAILED' AND we.error_message IS NOT NULL))[1] AS last_error
            FROM workflow w JOIN workflow_execution we ON we.workflow_id = w.id
            WHERE w.institute_id = :instituteId AND we.created_at >= :from AND we.created_at < :to
            GROUP BY w.id, w.name, w.status
            ORDER BY runs DESC
            LIMIT 50
            """;

    // ── Engagement ───────────────────────────────────────────────────────────

    static final String ENG_ENGINES = """
            SELECT e.id AS engine_id, e.name, e.status,
                   (SELECT COUNT(*) FROM engagement_member m WHERE m.engine_id = e.id) AS members,
                   (SELECT COUNT(*) FROM engagement_member m WHERE m.engine_id = e.id AND m.is_holdout) AS holdout,
                   COUNT(a.id) AS drafted,
                   COUNT(a.id) FILTER (WHERE a.status IN ('SENT', 'DONE')) AS completed,
                   COUNT(a.id) FILTER (WHERE a.status = 'FAILED') AS failed
            FROM engagement_engine e
            LEFT JOIN engagement_action a
                   ON a.engine_id = e.id AND a.created_at >= :from AND a.created_at < :to
            WHERE e.institute_id = :instituteId AND e.status <> 'DELETED'
            GROUP BY e.id, e.name, e.status
            ORDER BY drafted DESC, e.name
            LIMIT 50
            """;

    static final String ENG_TOTALS = """
            SELECT
                COUNT(*) FILTER (WHERE a.created_at >= :from AND a.created_at < :to) AS drafted,
                COUNT(*) FILTER (WHERE a.created_at >= :from AND a.created_at < :to AND a.status IN ('SENT', 'DONE')) AS completed,
                COUNT(*) FILTER (WHERE a.created_at >= :from AND a.created_at < :to AND a.status = 'FAILED') AS failed,
                COUNT(*) FILTER (WHERE a.created_at >= :from AND a.created_at < :to AND a.status = 'EXPIRED') AS expired,
                COUNT(*) FILTER (WHERE a.created_at >= :prevFrom AND a.created_at < :from) AS prev_drafted,
                COUNT(*) FILTER (WHERE a.created_at >= :prevFrom AND a.created_at < :from AND a.status IN ('SENT', 'DONE')) AS prev_completed,
                (SELECT COUNT(*) FROM engagement_action o WHERE o.institute_id = :instituteId AND o.status = 'OPEN') AS open_now,
                (SELECT COUNT(*) FROM engagement_action o WHERE o.institute_id = :instituteId AND o.status = 'OPEN'
                    AND o.created_at < :dayAgo) AS open_over_day
            FROM engagement_action a
            WHERE a.institute_id = :instituteId AND a.created_at >= :prevFrom AND a.created_at < :to
            """;

    static final String ENG_DAILY = """
            SELECT d.day::date::text AS day, COALESCE(x.drafted, 0) AS drafted, COALESCE(x.completed, 0) AS completed
            FROM generate_series(CAST(:fromDay AS date), CAST(:toDay AS date), interval '1 day') AS d(day)
            LEFT JOIN (
                SELECT (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS day,
                       COUNT(*) AS drafted,
                       COUNT(*) FILTER (WHERE a.status IN ('SENT', 'DONE')) AS completed
                FROM engagement_action a
                WHERE a.institute_id = :instituteId AND a.created_at >= :from AND a.created_at < :to
                GROUP BY 1
            ) x ON x.day = d.day::date
            ORDER BY d.day
            """;
}
