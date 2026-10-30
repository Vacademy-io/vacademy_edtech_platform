package vacademy.io.admin_core_service.features.engagement.report;

/**
 * SQL for the rows behind the daily report's lead numbers (GET /reports/daily/items). Each kind is
 * the report's own definition ({@link EngagementDailyReportSql}) with rows instead of counts, and
 * one row per thing the report counts once: a person for leads added and conversions, a booking
 * for demos, a history row for status changes. When the report's thing belongs to several engines
 * (one lead in two engines), the row names the engine that took the lead in first.
 *
 * <p>Each kind is a CTE named {@code items} with {@code item_key}, {@code engine_id},
 * {@code user_id}, {@code audience_response_id} and {@code sort_at}, plus its own columns; its
 * filter is a {@code %s} the service fills with a fixed SQL fragment ("TRUE" for none). The
 * wrappers below add the person's contact for display and search: the student row first, then
 * the lead row's parent_* fields, as ContactResolver resolves them. Same parameters and time
 * rules as the report: naive UTC {@code :from}/{@code :to}, the period's bounds.
 */
final class EngagementReportItemsSql {

    private EngagementReportItemsSql() {
    }

    /** lead_status_history.source of a status the engine set; the human ones are the report's. */
    static final String ACTOR = """
            CASE WHEN h.source = 'ENGAGEMENT_ENGINE' THEN 'ENGINE'
                 WHEN h.source IN (%s) THEN 'TEAM'
                 ELSE 'AUTOMATION' END""".formatted(EngagementDailyReportSql.HUMAN_STATUS_SOURCES);

    /**
     * MEMBERS_ADDED, one row per person (the lead row, else the user). is_new: the lead row itself
     * was created in the period. list_kind LIST | USERS | BATCH as the report's list rows.
     */
    static final String LEADS_ADDED = """
            WITH added AS (
                SELECT m.engine_id, m.user_id, m.audience_response_id, m.created_at AS joined_at,
                       CASE WHEN m.audience_response_id IS NOT NULL THEN 'LIST'
                            WHEN EXISTS (SELECT 1 FROM %1$s AS s(elem)
                                          WHERE s.elem ->> 'type' = 'USER' AND s.elem ->> 'id' = m.user_id) THEN 'USERS'
                            ELSE 'BATCH' END AS list_kind,
                       COALESCE(ar.original_audience_id, ar.audience_id) AS list_id,
                       au.campaign_name AS list_name,
                       COALESCE(m.audience_response_id, 'u:' || m.user_id) AS person,
                       COALESCE(ar.created_at >= :from AND ar.created_at < :to, FALSE) AS is_new,
                       ar.created_at AS lead_created_at
                FROM engagement_member m
                JOIN engagement_engine e ON e.id = m.engine_id
                LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                LEFT JOIN audience au ON au.id = COALESCE(ar.original_audience_id, ar.audience_id)
                WHERE m.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                  AND m.created_at >= :from AND m.created_at < :to
            ),
            items AS (
                SELECT DISTINCT ON (person) person AS item_key, engine_id, user_id, audience_response_id,
                       joined_at AS sort_at, list_kind, list_id, list_name, is_new, lead_created_at, joined_at
                FROM added
                WHERE %%s
                ORDER BY person, joined_at, engine_id
            )
            """.formatted(EngagementDailyReportSql.SELECTORS);

    /** Bookings of the engines' leads (by lead row, else the invitee's account), one row per booking. */
    private static final String BOOKINGS = """
            WITH matched AS (
                SELECT m.engine_id, m.user_id, m.audience_response_id, m.created_at AS member_at, 0 AS match_rank,
                       bi.id, bi.status, bi.created_at, bi.scheduled_start_utc, bi.host_user_id,
                       bi.invitee_name, bi.invitee_email, bi.invitee_phone
                FROM booking_instance bi
                JOIN engagement_member m ON m.audience_response_id = bi.audience_response_id
                                        AND m.institute_id = bi.institute_id
                WHERE bi.institute_id = :instituteId AND m.engine_id IN (:engineIds) AND %1$s
                UNION ALL
                SELECT m.engine_id, m.user_id, m.audience_response_id, m.created_at, 1,
                       bi.id, bi.status, bi.created_at, bi.scheduled_start_utc, bi.host_user_id,
                       bi.invitee_name, bi.invitee_email, bi.invitee_phone
                FROM booking_instance bi
                JOIN engagement_member m ON m.user_id = bi.invitee_user_id
                                        AND m.institute_id = bi.institute_id
                WHERE bi.institute_id = :instituteId AND m.engine_id IN (:engineIds)
                  AND bi.invitee_user_id IS NOT NULL AND %1$s
            ),
            items AS (
                SELECT DISTINCT ON (b.id) b.id AS item_key, b.engine_id, b.user_id, b.audience_response_id,
                       %2$s AS sort_at,
                       b.id AS booking_id, b.created_at AS booked_at, b.scheduled_start_utc AS scheduled_start,
                       b.status AS booking_status, r.outcome, b.host_user_id,
                       b.invitee_name AS inv_name, b.invitee_email AS inv_email, b.invitee_phone AS inv_phone
                FROM matched b
                LEFT JOIN mentor_session_record r ON r.booking_instance_id = b.id
                WHERE %%s
                ORDER BY b.id, b.match_rank, b.member_at, b.engine_id
            )
            """;

    /** Booked in the period: not cancelled, not a reschedule (the report's demosBooked). */
    static final String DEMOS_BOOKED = BOOKINGS.formatted("""
            bi.created_at >= :from AND bi.created_at < :to
                  AND bi.status <> 'CANCELLED' AND bi.reschedule_of_instance_id IS NULL""", "b.created_at");

    /** Scheduled in the period: not cancelled or rescheduled (the report's demosScheduled), with the outcome. */
    static final String DEMOS_SCHEDULED = BOOKINGS.formatted("""
            bi.scheduled_start_utc >= :from AND bi.scheduled_start_utc < :to
                  AND bi.status NOT IN ('CANCELLED', 'RESCHEDULED')""", "b.scheduled_start_utc");

    /** STATUS_CHANGES in the period, one row per history row (the report counts rows). */
    static final String STATUS_CHANGES = """
            WITH items AS (
                SELECT DISTINCT ON (h.id) h.id AS item_key, m.engine_id, m.user_id, h.audience_response_id,
                       h.changed_at AS sort_at, fs.label AS from_status, ts.label AS to_status,
                       h.source, h.changed_by_user_id, h.changed_at, %1$s AS actor
                FROM lead_status_history h
                JOIN engagement_member m ON m.audience_response_id = h.audience_response_id
                                        AND m.institute_id = h.institute_id
                                        AND m.engine_id IN (:engineIds)
                LEFT JOIN lead_status fs ON fs.id = h.from_status_id
                LEFT JOIN lead_status ts ON ts.id = h.to_status_id
                WHERE h.institute_id = :instituteId
                  AND h.changed_at >= :from AND h.changed_at < :to
                  AND %%s
                ORDER BY h.id, m.created_at, m.engine_id
            )
            """.formatted(ACTOR);

    /**
     * CONVERSIONS in the period, one row per person (the user, else the lead row). A lead-status move to
     * CONVERTED is preferred over the lead-profile flag, for its from/to and who made it; a
     * profile-only conversion has no status move and reads as automation (an enrolment, a payment).
     */
    static final String CONVERSIONS = """
            WITH conv AS (
                SELECT m.engine_id, m.user_id, m.audience_response_id, m.created_at AS member_at,
                       COALESCE(m.user_id, m.audience_response_id) AS lead_key,
                       h.changed_at AS converted_at, fs.label AS from_status, ts.label AS to_status,
                       h.source, h.changed_by_user_id, %1$s AS actor, 0 AS rule_rank
                FROM lead_status_history h
                JOIN engagement_member m ON m.audience_response_id = h.audience_response_id
                                        AND m.institute_id = h.institute_id
                LEFT JOIN lead_status fs ON fs.id = h.from_status_id
                LEFT JOIN lead_status ts ON ts.id = h.to_status_id
                WHERE h.institute_id = :instituteId
                  AND h.to_status_id IN (SELECT ls.id FROM lead_status ls
                                          WHERE ls.institute_id = :instituteId AND ls.status_key = 'CONVERTED')
                  AND h.changed_at >= :from AND h.changed_at < :to
                  AND m.engine_id IN (:engineIds)
                UNION ALL
                SELECT m.engine_id, m.user_id, m.audience_response_id, m.created_at,
                       COALESCE(m.user_id, m.audience_response_id),
                       ulp.converted_at, NULL, NULL, NULL, NULL, 'AUTOMATION', 1
                FROM user_lead_profile ulp
                JOIN engagement_member m ON m.user_id = ulp.user_id AND m.institute_id = ulp.institute_id
                WHERE ulp.institute_id = :instituteId
                  AND ulp.conversion_status = 'CONVERTED'
                  AND ulp.converted_at >= :from AND ulp.converted_at < :to
                  AND m.audience_response_id IS NOT NULL
                  AND m.engine_id IN (:engineIds)
            ),
            items AS (
                SELECT DISTINCT ON (lead_key) lead_key AS item_key, engine_id, user_id, audience_response_id,
                       converted_at AS sort_at, from_status, to_status, source, changed_by_user_id,
                       converted_at AS changed_at, actor
                FROM conv
                WHERE %%s
                ORDER BY lead_key, rule_rank, converted_at, member_at, engine_id
            )
            """.formatted(ACTOR);

    /** The label of the institute's CONVERTED status, for a conversion that came without a status move. */
    static final String CONVERTED_LABEL = """
            SELECT ls.label FROM lead_status ls
            WHERE ls.institute_id = :instituteId AND ls.status_key = 'CONVERTED'
            ORDER BY ls.is_active DESC NULLS LAST, ls.display_order NULLS LAST
            LIMIT 1
            """;

    /** The person's contact next to an item: the student row (newest), and the lead row. */
    private static final String CONTACT_JOINS = """
            FROM items i
            JOIN engagement_engine en ON en.id = i.engine_id
            LEFT JOIN LATERAL (SELECT s.full_name, s.mobile_number, s.email FROM student s
                                WHERE s.user_id = i.user_id
                                ORDER BY s.created_at DESC NULLS LAST LIMIT 1) st ON TRUE
            LEFT JOIN audience_response lr ON lr.id = i.audience_response_id
            """;

    /** Page of a kind's items; {@code %s} = the search condition ("TRUE" for none), then the order. */
    static final String PAGE = """
            SELECT i.*, en.name AS engine_name,
                   st.full_name AS st_name, st.mobile_number AS st_phone, st.email AS st_email,
                   lr.parent_name AS lead_name, lr.parent_mobile AS lead_phone, lr.parent_email AS lead_email
            """ + CONTACT_JOINS + """
            WHERE %s
            ORDER BY %s
            LIMIT :limit OFFSET :offset
            """;

    /** Count of a kind's items after search; {@code %s} = the search condition. */
    static final String COUNT = "SELECT COUNT(*) AS n\n" + CONTACT_JOINS + "WHERE %s\n";

    /**
     * Search on name, email and phone, as typed (ILIKE) and, for phone, in digits only so
     * "+91 98765" finds 919876500001. Demos also search the invitee's own fields.
     */
    static String search(boolean demos, boolean digits) {
        StringBuilder s = new StringBuilder("""
                (st.full_name ILIKE :q OR lr.parent_name ILIKE :q
                 OR st.email ILIKE :q OR lr.parent_email ILIKE :q
                 OR st.mobile_number ILIKE :q OR lr.parent_mobile ILIKE :q""");
        if (demos) s.append("\n OR i.inv_name ILIKE :q OR i.inv_email ILIKE :q OR i.inv_phone ILIKE :q");
        if (digits) {
            s.append("""

                     OR regexp_replace(COALESCE(st.mobile_number, ''), '[^0-9]', '', 'g') LIKE :qDigits
                     OR regexp_replace(COALESCE(lr.parent_mobile, ''), '[^0-9]', '', 'g') LIKE :qDigits""");
            if (demos) s.append("\n OR regexp_replace(COALESCE(i.inv_phone, ''), '[^0-9]', '', 'g') LIKE :qDigits");
        }
        return s.append(')').toString();
    }

    /**
     * TEMPLATES_CREATED: the WhatsApp templates the engine(s) proposed in the period (the report's
     * newTemplates). %s = the filter AND the search.
     */
    static final String TEMPLATES_FROM = """
            FROM engagement_template_proposal p
            JOIN engagement_engine e ON e.id = p.engine_id
            WHERE p.institute_id = :instituteId AND p.engine_id IN (:engineIds)
              AND p.created_at >= :from AND p.created_at < :to
              AND (%s)
            """;

    static final String TEMPLATES_COUNT = "SELECT COUNT(*) " + TEMPLATES_FROM;

    static final String TEMPLATES_PAGE = """
            SELECT p.id, p.engine_id, e.name AS engine_name, p.name, p.language,
                   UPPER(p.proposed_category) AS proposed_category, UPPER(p.meta_category) AS meta_category,
                   p.status, p.rejection_reason, p.created_at, p.submitted_at
            """ + TEMPLATES_FROM + """
            ORDER BY p.created_at DESC, p.id
            LIMIT :limit OFFSET :offset
            """;
}
