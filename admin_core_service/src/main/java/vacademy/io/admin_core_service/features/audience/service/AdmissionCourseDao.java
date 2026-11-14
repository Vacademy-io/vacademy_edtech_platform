package vacademy.io.admin_core_service.features.audience.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Whether the person behind a lead has a course at the institute: an open plan
 * through one of the institute's enrol invites, or an enrolment that counts in one
 * of its batches. The person is the lead's user and the student linked to them on
 * any of their leads in the institute.
 *
 * <p>The plan and enrolment rules are the admissions report's own
 * ({@code _ENDED_PLAN} and {@code _COUNTED} in ai_service crm_admissions.py), so
 * the conversion check and that report agree on who has a course.</p>
 */
@Repository
public class AdmissionCourseDao {

    /** Plan statuses that mean the plan has ended. */
    static final String ENDED_PLAN =
            "('TERMINATED', 'CANCELED', 'CANCELLED', 'DELETED', 'EXPIRED', 'PAYMENT_FAILED')";

    /** IN-list size per statement. */
    static final int CHUNK = 1000;

    @PersistenceContext
    private EntityManager em;

    /**
     * SQL that is true when {@code person} (a column of the enclosing query) has a
     * course at {@code :instituteId}.
     */
    static String hasCourse(String person) {
        return "(EXISTS (SELECT 1 FROM user_plan up"
                + " JOIN enroll_invite ei ON ei.id = up.enroll_invite_id AND ei.institute_id = :instituteId"
                + " WHERE up.user_id = " + person
                + " AND up.status NOT IN " + ENDED_PLAN + ")"
                + " OR EXISTS (SELECT 1 FROM student_session_institute_group_mapping s"
                + " JOIN package_session ps ON ps.id = s.package_session_id"
                + " JOIN package p ON p.id = ps.package_id"
                + " WHERE s.user_id = " + person
                + " AND s.institute_id = :instituteId"
                + " AND s.status IN ('ACTIVE', 'COMPLETED', 'INVITED')"
                + " AND NOT (s.status = 'INVITED' AND COALESCE(s.source, '') = 'TERMINATED')))";
    }

    /** The lead's user, the student on the lead, and the other side of any link on the person's leads here. */
    static final String BY_RESPONSE_SQL = "WITH target AS ("
            + " SELECT ar.id AS rid, ar.user_id, ar.student_user_id"
            + " FROM audience_response ar"
            + " JOIN audience a ON a.id = ar.audience_id"
            + " WHERE ar.id IN (:responseIds) AND a.institute_id = :instituteId"
            + "), people AS ("
            + " SELECT t.rid, t.user_id AS pid FROM target t WHERE t.user_id IS NOT NULL"
            + " UNION SELECT t.rid, t.student_user_id FROM target t WHERE t.student_user_id IS NOT NULL"
            + " UNION SELECT t.rid, o.student_user_id FROM target t"
            + " JOIN audience_response o ON o.user_id = t.user_id"
            + " JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :instituteId"
            + " WHERE o.student_user_id IS NOT NULL"
            + " UNION SELECT t.rid, o.user_id FROM target t"
            + " JOIN audience_response o ON o.student_user_id = t.user_id"
            + " JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :instituteId"
            + " WHERE o.user_id IS NOT NULL"
            + ")"
            + " SELECT t.rid, EXISTS (SELECT 1 FROM people pe WHERE pe.rid = t.rid AND "
            + hasCourse("pe.pid")
            + ") AS has_course"
            + " FROM target t";

    /** The same person rule, starting from a user id instead of a lead. */
    static final String BY_USER_SQL = "WITH people AS ("
            + " SELECT CAST(:userId AS varchar) AS pid"
            + " UNION SELECT o.student_user_id FROM audience_response o"
            + " JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :instituteId"
            + " WHERE o.user_id = :userId AND o.student_user_id IS NOT NULL"
            + " UNION SELECT o.user_id FROM audience_response o"
            + " JOIN audience oa ON oa.id = o.audience_id AND oa.institute_id = :instituteId"
            + " WHERE o.student_user_id = :userId AND o.user_id IS NOT NULL"
            + ")"
            + " SELECT EXISTS (SELECT 1 FROM people pe WHERE "
            + hasCourse("pe.pid")
            + ")";

    /**
     * Lead id to whether its person has a course here, for the given leads that belong
     * to the institute. Leads of another institute, and unknown ids, are left out.
     */
    public Map<String, Boolean> courseByResponse(String instituteId, Collection<String> responseIds) {
        Map<String, Boolean> out = new LinkedHashMap<>();
        if (instituteId == null || responseIds == null || responseIds.isEmpty()) return out;
        List<String> ids = new ArrayList<>(new LinkedHashSet<>(responseIds));
        for (int i = 0; i < ids.size(); i += CHUNK) {
            List<?> rows = em.createNativeQuery(BY_RESPONSE_SQL)
                    .setParameter("instituteId", instituteId)
                    .setParameter("responseIds", ids.subList(i, Math.min(ids.size(), i + CHUNK)))
                    .getResultList();
            for (Object r : rows) {
                Object[] c = (Object[]) r;
                out.put(String.valueOf(c[0]), Boolean.TRUE.equals(c[1]));
            }
        }
        return out;
    }

    /** Whether the person (or a student linked to them on a lead here) has a course at the institute. */
    public boolean personHasCourse(String instituteId, String userId) {
        if (instituteId == null || userId == null || userId.isBlank()) return false;
        Object result = em.createNativeQuery(BY_USER_SQL)
                .setParameter("instituteId", instituteId)
                .setParameter("userId", userId)
                .getSingleResult();
        return Boolean.TRUE.equals(result);
    }
}
