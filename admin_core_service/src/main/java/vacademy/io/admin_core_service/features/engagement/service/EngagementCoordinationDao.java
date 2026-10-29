package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * B5 reads (and the one write) for coordinating with the rest of the CRM: AI calls placed to a
 * lead, follow-ups due today, and the per-lead "do not automate" flag. Batch queries, one per
 * cohort, keyed by lead row.
 */
@Repository
public class EngagementCoordinationDao {

    @PersistenceContext
    private EntityManager em;

    /** Outbound AI-agent calls per lead row since :since, from whichever system placed them. */
    public Map<String, Long> aiCallCounts(String instituteId, Collection<String> leadRowIds, Instant since) {
        Map<String, Long> out = new HashMap<>();
        if (leadRowIds == null || leadRowIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT l.response_id, count(*)
                FROM telephony_call_log l
                WHERE l.institute_id = :instituteId
                  AND l.response_id IN (:ids)
                  AND l.provider_type IN (:aiProviders)
                  AND UPPER(COALESCE(l.direction, '')) <> 'INBOUND'
                  AND COALESCE(l.start_time, l.created_at) >= :since
                GROUP BY l.response_id
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadRowIds)
                .setParameter("aiProviders", EngagementCrmReadDao.AI_CALL_PROVIDERS)
                .setParameter("since", since)
                .getResultList();
        for (Object row : rows) {
            Object[] r = (Object[]) row;
            out.put((String) r[0], ((Number) r[1]).longValue());
        }
        return out;
    }

    /** Lead rows with an open follow-up due in [from, to): the counsellor has it in hand today (F-1). */
    public Set<String> leadsWithFollowupDue(String instituteId, Collection<String> leadRowIds, Instant from, Instant to) {
        Set<String> out = new HashSet<>();
        if (leadRowIds == null || leadRowIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT DISTINCT f.audience_response_id
                FROM lead_followup f
                WHERE f.institute_id = :instituteId
                  AND f.audience_response_id IN (:ids)
                  AND NOT (COALESCE(f.is_closed, false) OR f.status = 'COMPLETED')
                  AND f.schedule_time >= :fromTime AND f.schedule_time < :toTime
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadRowIds)
                .setParameter("fromTime", from)
                .setParameter("toTime", to)
                .getResultList();
        for (Object r : rows) out.add(r.toString());
        return out;
    }

    /** Lead rows a counsellor marked "do not automate". */
    public Set<String> doNotAutomate(String instituteId, Collection<String> leadRowIds) {
        Set<String> out = new HashSet<>();
        if (leadRowIds == null || leadRowIds.isEmpty()) return out;
        List<?> rows = em.createNativeQuery("""
                SELECT audience_response_id FROM engagement_lead_flag
                WHERE institute_id = :instituteId AND audience_response_id IN (:ids) AND do_not_automate
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", leadRowIds)
                .getResultList();
        for (Object r : rows) out.add(r.toString());
        return out;
    }

    /** Open (not closed, not completed) follow-ups on a lead row: F-4, never a second one. */
    public long openFollowups(String instituteId, String leadRowId) {
        Object n = em.createNativeQuery("""
                SELECT count(*) FROM lead_followup f
                WHERE f.institute_id = :instituteId AND f.audience_response_id = :leadRowId
                  AND NOT (COALESCE(f.is_closed, false) OR f.status = 'COMPLETED')
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("leadRowId", leadRowId)
                .getSingleResult();
        return n instanceof Number num ? num.longValue() : 0;
    }

    /**
     * A call to this lead ended as wrong number or do-not-disturb (C-2, C-3): no more AI calls.
     * The disposition is what the counsellor or the AI agent recorded on the call.
     */
    public boolean doNotCall(String instituteId, String leadRowId) {
        Object n = em.createNativeQuery("""
                SELECT count(*) FROM telephony_call_log l
                WHERE l.institute_id = :instituteId AND l.response_id = :leadRowId
                  AND l.disposition_key IN ('WRONG_NUMBER', 'DND')
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("leadRowId", leadRowId)
                .getSingleResult();
        return n instanceof Number num && num.longValue() > 0;
    }

    /** True when the lead row belongs to a list of this institute (the flag endpoint's scope check). */
    public boolean leadInInstitute(String instituteId, String leadRowId) {
        Object n = em.createNativeQuery("""
                SELECT count(*) FROM audience_response ar
                JOIN audience a ON a.id = ar.audience_id
                WHERE ar.id = :leadRowId AND a.institute_id = :instituteId
                """)
                .setParameter("leadRowId", leadRowId)
                .setParameter("instituteId", instituteId)
                .getSingleResult();
        return n instanceof Number num && num.longValue() > 0;
    }

    @Transactional
    public void setDoNotAutomate(String instituteId, String leadRowId, boolean value, String setBy, Instant now) {
        em.createNativeQuery("""
                INSERT INTO engagement_lead_flag (institute_id, audience_response_id, do_not_automate, set_by, set_at)
                VALUES (:instituteId, :leadRowId, :value, CAST(:setBy AS varchar), :now)
                ON CONFLICT (institute_id, audience_response_id)
                DO UPDATE SET do_not_automate = EXCLUDED.do_not_automate, set_by = EXCLUDED.set_by,
                              set_at = EXCLUDED.set_at
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("leadRowId", leadRowId)
                .setParameter("value", value)
                .setParameter("setBy", setBy)
                .setParameter("now", now)
                .executeUpdate();
    }
}
