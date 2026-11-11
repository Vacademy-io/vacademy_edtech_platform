package vacademy.io.admin_core_service.features.audience.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

/**
 * SQL behind merging one person's leads into another person in the same institute
 * ({@code LeadMergeService}). Every statement is pinned to one institute: an enquiry
 * belongs to the institute of its lead list, a lead profile carries its own institute.
 */
@Repository
@RequiredArgsConstructor
public class LeadMergeDao {

    private final JdbcTemplate jdbc;

    /** One person's lead profile in one institute. */
    public record Profile(String id, String userId, String conversionStatus, String leadTier,
                          String counsellorName, Timestamp createdAt, String mergedIntoUserId,
                          Timestamp mergedAt) {
    }

    /** One enquiry (audience_response row) of a person, as the merge screen shows it. */
    public record Enquiry(String id, String userId, String studentUserId, String listId, String listName,
                          String name, String phone, String email, String sourceType, String statusKey,
                          String audienceStatus, Timestamp submittedAt) {
    }

    /** A person merged into another one. */
    public record MergedPerson(String userId, String profileId, Timestamp mergedAt, String mergedByUserId,
                               String name, int enquiries) {
    }

    /** A live enquiry whose name looks like the one being added. */
    public record NameMatch(String responseId, String userId, String name, String phone, String email,
                            String listName, String statusKey, String counsellorId, Timestamp submittedAt,
                            boolean exact) {
    }

    /** The person's name on an enquiry: the name column, else the form's full-name answer. */
    static final String NAME_SQL = """
            COALESCE(NULLIF(btrim(ar.parent_name), ''), (
                SELECT v.value FROM custom_field_values v
                JOIN custom_fields cf ON cf.id = v.custom_field_id
                WHERE v.source_type = 'AUDIENCE_RESPONSE' AND v.source_id = ar.id
                  AND left(cf.field_key, 9) = 'full_name'
                  AND NULLIF(btrim(v.value), '') IS NOT NULL
                ORDER BY v.updated_at DESC NULLS LAST
                LIMIT 1))""";

    /** A name lower-cased with everything but letters turned into single spaces. */
    static String normalised(String column) {
        return "btrim(regexp_replace(lower(" + column + "), '[\\W\\d_]+', ' ', 'g'))";
    }

    static final String PROFILE_SQL = """
            SELECT p.id, p.user_id, p.conversion_status, p.lead_tier, p.assigned_counselor_name,
                   p.created_at, p.merged_into_user_id, p.merged_at
            FROM user_lead_profile p
            WHERE p.institute_id = ? AND p.user_id = ?
            """;

    public Optional<Profile> findProfile(String instituteId, String userId) {
        return jdbc.query(PROFILE_SQL, (rs, i) -> new Profile(rs.getString("id"), rs.getString("user_id"),
                rs.getString("conversion_status"), rs.getString("lead_tier"),
                rs.getString("assigned_counselor_name"), rs.getTimestamp("created_at"),
                rs.getString("merged_into_user_id"), rs.getTimestamp("merged_at")),
                instituteId, userId).stream().findFirst();
    }

    static final String ENQUIRIES_SQL = """
            SELECT ar.id, ar.user_id, ar.student_user_id, ar.audience_id, a.campaign_name,
            """
            + NAME_SQL
            + """
             AS person_name,
                   ar.parent_mobile, ar.parent_email, ar.source_type,
                   (SELECT ls.status_key FROM lead_status ls WHERE ls.id = ar.lead_status_id) AS status_key,
                   ar.audience_status, ar.submitted_at
            FROM audience_response ar
            JOIN audience a ON a.id = ar.audience_id AND a.institute_id = ?
            WHERE ar.user_id = ?
            ORDER BY ar.submitted_at DESC NULLS LAST, ar.id
            LIMIT 200
            """;

    /** The person's own enquiries in this institute (where they are the lead), newest first. */
    public List<Enquiry> enquiriesOf(String instituteId, String userId) {
        return jdbc.query(ENQUIRIES_SQL, (rs, i) -> new Enquiry(rs.getString("id"), rs.getString("user_id"),
                rs.getString("student_user_id"), rs.getString("audience_id"), rs.getString("campaign_name"),
                rs.getString("person_name"), rs.getString("parent_mobile"), rs.getString("parent_email"),
                rs.getString("source_type"), rs.getString("status_key"), rs.getString("audience_status"),
                rs.getTimestamp("submitted_at")), instituteId, userId);
    }

    static final String HAS_ENROLMENT_SQL = """
            SELECT EXISTS (SELECT 1 FROM student_session_institute_group_mapping s
                           WHERE s.institute_id = ? AND s.user_id = ?)
            """;

    /** Any enrolment row in this institute, whatever its status. */
    public boolean hasEnrolment(String instituteId, String userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(HAS_ENROLMENT_SQL, Boolean.class, instituteId, userId));
    }

    static final String HAS_PLAN_SQL = """
            SELECT EXISTS (SELECT 1 FROM user_plan up
                           JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                           WHERE ei.institute_id = ? AND up.user_id = ?)
            """;

    /** Any user plan bought through one of this institute's invites, whatever its status. */
    public boolean hasPlan(String instituteId, String userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(HAS_PLAN_SQL, Boolean.class, instituteId, userId));
    }

    static final String HAS_PAYMENT_SQL = """
            SELECT EXISTS (SELECT 1 FROM student_fee_payment f
                           WHERE f.institute_id = ? AND f.user_id = ?)
                OR EXISTS (SELECT 1 FROM payment_log l
                           JOIN user_plan up ON up.id = l.user_plan_id
                           JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                           WHERE ei.institute_id = ? AND l.user_id = ?)
            """;

    /** Any fee line or payment record in this institute. */
    public boolean hasPayment(String instituteId, String userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(HAS_PAYMENT_SQL, Boolean.class,
                instituteId, userId, instituteId, userId));
    }

    static final String LINKED_ELSEWHERE_SQL = """
            SELECT EXISTS (SELECT 1 FROM audience_response ar
                           JOIN audience a ON a.id = ar.audience_id AND a.institute_id = ?
                           WHERE ar.student_user_id = ? AND ar.user_id IS NOT NULL AND ar.user_id <> ?)
                OR EXISTS (SELECT 1 FROM linked_users lu
                           JOIN audience_response ar ON ar.enquiry_id = lu.source_id
                           JOIN audience a ON a.id = ar.audience_id AND a.institute_id = ?
                           WHERE lu.source = 'ENQUIRY' AND lu.user_id = ?)
            """;

    /** The person is the linked student on another person's enquiry, or linked to an enquiry, here. */
    public boolean isLinkedOnOtherEnquiry(String instituteId, String userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(LINKED_ELSEWHERE_SQL, Boolean.class,
                instituteId, userId, userId, instituteId, userId));
    }

    static final String PEOPLE_LINKED_SQL = """
            SELECT EXISTS (SELECT 1 FROM audience_response ar
                           JOIN audience a ON a.id = ar.audience_id AND a.institute_id = ?
                           WHERE (ar.user_id = ? AND ar.student_user_id = ?)
                              OR (ar.user_id = ? AND ar.student_user_id = ?))
            """;

    /** One of the two is recorded as the other's student on an enquiry here. */
    public boolean areLinked(String instituteId, String a, String b) {
        return Boolean.TRUE.equals(jdbc.queryForObject(PEOPLE_LINKED_SQL, Boolean.class,
                instituteId, a, b, b, a));
    }

    static final String OPTED_OUT_SQL = """
            SELECT EXISTS (SELECT 1 FROM audience_response o
                           JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = ?
                           WHERE o.user_id = ?
                             AND (o.overall_status = 'OPTED_OUT'
                                  OR COALESCE(o.source_type, '') = 'OPT_OUT'
                                  OR COALESCE(oa.campaign_type, '') LIKE '%OPT_OUT%'))
            """;

    /** The person has an enquiry here that is marked opted out or sits on an opt-out list. */
    public boolean hasOptedOut(String instituteId, String userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(OPTED_OUT_SQL, Boolean.class, instituteId, userId));
    }

    static final String MERGED_INTO_SQL = """
            SELECT p.user_id, p.id, p.merged_at, p.merged_by_user_id,
                   (SELECT
            """
            + NAME_SQL
            + """

                    FROM audience_response ar
                    JOIN audience a ON a.id = ar.audience_id AND a.institute_id = p.institute_id
                    WHERE ar.merged_from_user_id = p.user_id AND ar.user_id = p.merged_into_user_id
                    ORDER BY ar.submitted_at DESC NULLS LAST LIMIT 1) AS person_name,
                   (SELECT COUNT(*) FROM audience_response ar
                    JOIN audience a ON a.id = ar.audience_id AND a.institute_id = p.institute_id
                    WHERE ar.merged_from_user_id = p.user_id AND ar.user_id = p.merged_into_user_id) AS enquiries
            FROM user_lead_profile p
            WHERE p.institute_id = ? AND p.merged_into_user_id = ?
            ORDER BY p.merged_at DESC NULLS LAST
            LIMIT 50
            """;

    /** The people merged into this one here, latest first. */
    public List<MergedPerson> mergedInto(String instituteId, String userId) {
        return jdbc.query(MERGED_INTO_SQL, (rs, i) -> new MergedPerson(rs.getString("user_id"), rs.getString("id"),
                rs.getTimestamp("merged_at"), rs.getString("merged_by_user_id"), rs.getString("person_name"),
                rs.getInt("enquiries")), instituteId, userId);
    }

    static final String LOCK_SQL = """
            SELECT p.id FROM user_lead_profile p
            WHERE p.institute_id = ? AND p.user_id IN (?, ?)
            ORDER BY p.id
            FOR UPDATE
            """;

    /** Locks both profiles (in id order, so two merges of the same pair cannot deadlock). */
    public void lockProfiles(String instituteId, String a, String b) {
        jdbc.queryForList(LOCK_SQL, String.class, instituteId, a, b);
    }

    static final String MOVE_SQL = """
            UPDATE audience_response ar
            SET merged_from_user_id = ar.user_id,
                user_id = ?,
                student_user_id = CASE WHEN ar.student_user_id = ? THEN ? ELSE ar.student_user_id END,
                updated_at = now()
            FROM audience a
            WHERE a.id = ar.audience_id AND a.institute_id = ?
              AND ar.user_id = ?
            """;

    /** Moves the duplicate's enquiries here to the kept person, remembering whose they were. */
    public int moveEnquiries(String instituteId, String duplicateUserId, String keepUserId) {
        return jdbc.update(MOVE_SQL, keepUserId, duplicateUserId, keepUserId, instituteId, duplicateUserId);
    }

    static final String MOVE_BACK_SQL = """
            UPDATE audience_response ar
            SET user_id = ar.merged_from_user_id,
                student_user_id = CASE WHEN ar.student_user_id = ? THEN ar.merged_from_user_id
                                       ELSE ar.student_user_id END,
                merged_from_user_id = NULL,
                updated_at = now()
            FROM audience a
            WHERE a.id = ar.audience_id AND a.institute_id = ?
              AND ar.user_id = ? AND ar.merged_from_user_id = ?
            """;

    /** Moves back every enquiry a merge took from the duplicate and that the kept person still holds here. */
    public int moveEnquiriesBack(String instituteId, String duplicateUserId, String keepUserId) {
        return jdbc.update(MOVE_BACK_SQL, keepUserId, instituteId, keepUserId, duplicateUserId);
    }

    static final String MARK_MERGED_SQL = """
            UPDATE user_lead_profile
            SET merged_into_user_id = ?, merged_at = now(), merged_by_user_id = ?, updated_at = now()
            WHERE id = ? AND institute_id = ? AND merged_into_user_id IS NULL
            """;

    public int markMerged(String instituteId, String profileId, String keepUserId, String actorUserId) {
        return jdbc.update(MARK_MERGED_SQL, keepUserId, actorUserId, profileId, instituteId);
    }

    static final String CLEAR_MERGED_SQL = """
            UPDATE user_lead_profile
            SET merged_into_user_id = NULL, merged_at = NULL, merged_by_user_id = NULL, updated_at = now()
            WHERE id = ? AND institute_id = ? AND merged_into_user_id = ?
            """;

    public int clearMerged(String instituteId, String profileId, String keepUserId) {
        return jdbc.update(CLEAR_MERGED_SQL, profileId, instituteId, keepUserId);
    }

    /** How far back a lead counts when looking for a similar name. */
    public static final int SIMILAR_NAME_DAYS = 180;

    /** The name check is a hint: it gives up rather than hold up adding a lead. */
    static final int SIMILAR_NAME_TIMEOUT_SECONDS = 5;

    static final String SIMILAR_NAMES_SQL = """
            WITH q AS (
                SELECT
            """
            + normalised("CAST(? AS text)")
            + """
             AS n
            ), qp AS (
                SELECT n, split_part(n, ' ', 1) AS f, regexp_replace(n, '^.* ', '') AS l,
                       position(' ' in n) > 0 AS multi
                FROM q
            ), nf AS MATERIALIZED (
                SELECT cf.id FROM custom_fields cf
                WHERE left(cf.field_key, 9) = 'full_name'
                  AND cf.id IN (SELECT icf.custom_field_id FROM institute_custom_fields icf
                                WHERE icf.institute_id = ?)
            ), cand AS MATERIALIZED (
                SELECT ar.id, ar.user_id, ar.submitted_at, ar.parent_mobile, ar.parent_email, ar.lead_status_id,
                       a.campaign_name,
                       COALESCE(NULLIF(btrim(ar.parent_name), ''), (
                           SELECT v.value FROM custom_field_values v
                           WHERE v.source_type = 'AUDIENCE_RESPONSE' AND v.source_id = ar.id
                             AND v.custom_field_id IN (SELECT nf.id FROM nf)
                             AND NULLIF(btrim(v.value), '') IS NOT NULL
                           ORDER BY v.updated_at DESC NULLS LAST
                           LIMIT 1)) AS nm
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id AND a.institute_id = ?
                WHERE ar.audience_status = 'ACTIVE'
                  AND (ar.overall_status IS NULL OR ar.overall_status <> 'OPTED_OUT')
                  AND COALESCE(ar.source_type, '') <> 'OPT_OUT'
                  AND COALESCE(a.campaign_type, '') NOT LIKE '%OPT_OUT%'
                  AND ar.user_id IS NOT NULL
                  AND ar.submitted_at >= now() - make_interval(days => ?)
            ), norm AS (
                SELECT c.*,
            """
            + normalised("c.nm")
            + """
             AS n
                FROM cand c
                WHERE c.nm IS NOT NULL
            ), hit AS (
                SELECT DISTINCT ON (x.user_id) x.*, (x.n = qp.n) AS exact
                FROM norm x CROSS JOIN qp
                WHERE qp.n <> ''
                  AND (x.n = qp.n
                       OR (qp.multi AND position(' ' in x.n) > 0
                           AND ((split_part(x.n, ' ', 1) = qp.f AND regexp_replace(x.n, '^.* ', '') = qp.l)
                             OR (split_part(x.n, ' ', 1) = qp.l AND regexp_replace(x.n, '^.* ', '') = qp.f))))
                ORDER BY x.user_id, (x.n = qp.n) DESC, x.submitted_at DESC
            )
            SELECT h.id, h.user_id, h.nm, h.parent_mobile, h.parent_email, h.campaign_name, h.submitted_at, h.exact,
                   (SELECT ls.status_key FROM lead_status ls WHERE ls.id = h.lead_status_id) AS status_key,
                   ulp.assigned_counselor_id
            FROM hit h
            LEFT JOIN user_lead_profile ulp ON ulp.user_id = h.user_id AND ulp.institute_id = ?
            WHERE ulp.merged_into_user_id IS NULL
            ORDER BY h.exact DESC, h.submitted_at DESC
            LIMIT ?
            """;

    /**
     * Live enquiries here, submitted in the last {@link #SIMILAR_NAME_DAYS} days, whose name is the same
     * once normalised, or has the same first and last word (in either order). One row per person.
     */
    public List<NameMatch> similarNames(String instituteId, String name, int limit) {
        Object[] args = {name, instituteId, instituteId, SIMILAR_NAME_DAYS, instituteId, limit};
        return jdbc.query(con -> {
            PreparedStatement ps = con.prepareStatement(SIMILAR_NAMES_SQL);
            ps.setQueryTimeout(SIMILAR_NAME_TIMEOUT_SECONDS);
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            return ps;
        }, (rs, i) -> new NameMatch(rs.getString("id"), rs.getString("user_id"),
                rs.getString("nm"), rs.getString("parent_mobile"), rs.getString("parent_email"),
                rs.getString("campaign_name"), rs.getString("status_key"), rs.getString("assigned_counselor_id"),
                rs.getTimestamp("submitted_at"), rs.getBoolean("exact")));
    }
}
