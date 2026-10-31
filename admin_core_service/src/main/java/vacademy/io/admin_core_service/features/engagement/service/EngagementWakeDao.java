package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * B4 reads: who a piece of CRM activity is about, and which live engine members that person is.
 * Read-only native SQL; the wake itself is EngagementMemberRepository.wake.
 */
@Repository
public class EngagementWakeDao {

    @PersistenceContext
    private EntityManager em;

    /** A lead row: its institute (from its list), list, account ids and a usable phone. */
    public record LeadRow(String id, String instituteId, String audienceId, String userId,
                          String studentUserId, String phone10) {}

    /** The lead rows behind a timeline type id. Empty when the row does not exist (e.g. rolled back). */
    public List<LeadRow> leadRows(String leadRowId, String enquiryId) {
        if (leadRowId == null && enquiryId == null) return List.of();
        List<?> rows = em.createNativeQuery("""
                SELECT ar.id, a.institute_id, ar.audience_id, ar.user_id, ar.student_user_id,
                       CASE WHEN length(d.digits) >= 10 AND d.digits !~ '^(.)\\1*$'
                            THEN RIGHT(d.digits, 10) END
                FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(ar.parent_mobile, ''), '[^0-9]', '', 'g') AS digits) d
                WHERE ar.id = :leadRowId OR ar.enquiry_id = :enquiryId
                LIMIT 20
                """)
                .setParameter("leadRowId", leadRowId != null ? leadRowId : "")
                .setParameter("enquiryId", enquiryId != null ? enquiryId : "")
                .getResultList();
        List<LeadRow> out = new ArrayList<>();
        for (Object row : rows) {
            Object[] r = (Object[]) row;
            out.add(new LeadRow(str(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5])));
        }
        return out;
    }

    /** A lead profile's account and institute (USER_LEAD_PROFILE events: owner and status changes). */
    public String[] leadProfile(String profileId) {
        if (profileId == null) return null;
        List<?> rows = em.createNativeQuery("SELECT user_id, institute_id FROM user_lead_profile WHERE id = :id")
                .setParameter("id", profileId)
                .getResultList();
        if (rows.isEmpty()) return null;
        Object[] r = (Object[]) rows.get(0);
        return new String[]{str(r[0]), str(r[1])};
    }

    /** A call: lead row, account, institute and whether an AI agent (not a person) made it. */
    public record CallRow(String responseId, String userId, String instituteId, boolean aiAgent) {}

    public CallRow call(String callLogId) {
        if (callLogId == null) return null;
        List<?> rows = em.createNativeQuery("""
                SELECT response_id, user_id, institute_id, provider_type
                FROM telephony_call_log WHERE id = :id
                """)
                .setParameter("id", callLogId)
                .getResultList();
        if (rows.isEmpty()) return null;
        Object[] r = (Object[]) rows.get(0);
        return new CallRow(str(r[0]), str(r[1]), str(r[2]),
                r[3] != null && EngagementCrmReadDao.isAiProvider(r[3].toString()));
    }

    /**
     * Live members of the institute's running engines that are this person: by lead row, by
     * account (the member's own, or its lead row's), or by a lead row with the same phone, since a
     * lead without an account is one member per phone. Holdouts and the system AI-call engine are
     * left out. Bounded by the institute's members (idx_em_subject_lead / idx_em_subject_user).
     */
    public List<String> liveMemberIds(String instituteId, Collection<String> leadRowIds,
                                      Collection<String> userIds, Collection<String> phones) {
        if (instituteId == null || (leadRowIds.isEmpty() && userIds.isEmpty() && phones.isEmpty())) return List.of();
        List<?> rows = em.createNativeQuery("""
                SELECT m.id FROM engagement_member m
                JOIN engagement_engine e ON e.id = m.engine_id
                LEFT JOIN audience_response ar ON ar.id = m.audience_response_id
                WHERE m.institute_id = :instituteId AND m.status = 'ACTIVE' AND m.is_holdout = false
                  AND e.status IN ('ACTIVE', 'DRY_RUN')
                  AND COALESCE(e.created_by, '') <> :systemEngine
                  AND (m.audience_response_id IN (:leadRowIds)
                       OR m.user_id IN (:userIds)
                       OR ar.user_id IN (:userIds)
                       OR ar.student_user_id IN (:userIds)
                       OR (ar.parent_mobile IS NOT NULL
                           AND RIGHT(regexp_replace(ar.parent_mobile, '[^0-9]', '', 'g'), 10) IN (:phones)))
                LIMIT 200
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("systemEngine", EngagementEngine.CREATED_BY_SYSTEM_AI_CALL)
                // An empty IN () is a syntax error, so an unused list holds NO_MATCH. Not '': a member
                // with no lead row, or a lead row with no phone, reduces to '' and would match it.
                .setParameter("leadRowIds", orNoMatch(leadRowIds))
                .setParameter("userIds", orNoMatch(userIds))
                .setParameter("phones", orNoMatch(phones))
                .getResultList();
        List<String> out = new ArrayList<>();
        for (Object r : rows) out.add(r.toString());
        return out;
    }

    /** Matches no id (ids are UUIDs) and no phone (the phone expression is digits only). */
    static final String NO_MATCH = "-";

    /** Live members (ACTIVE or PAUSED) of this lead row in the institute's engines, any engine status. */
    public List<String> liveMemberIdsOfLeadRow(String instituteId, String leadRowId) {
        List<?> rows = em.createNativeQuery("""
                SELECT m.id FROM engagement_member m
                WHERE m.institute_id = :instituteId AND m.audience_response_id = :leadRowId
                  AND m.status IN ('ACTIVE', 'PAUSED')
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("leadRowId", leadRowId)
                .getResultList();
        List<String> out = new ArrayList<>();
        for (Object r : rows) out.add(r.toString());
        return out;
    }

    private static Collection<String> orNoMatch(Collection<String> c) {
        return c.isEmpty() ? List.of(NO_MATCH) : c;
    }

    private static String str(Object o) {
        return o != null ? o.toString() : null;
    }
}
