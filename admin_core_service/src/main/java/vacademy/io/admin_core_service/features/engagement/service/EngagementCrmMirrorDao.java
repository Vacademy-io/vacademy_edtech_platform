package vacademy.io.admin_core_service.features.engagement.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The few CRM rows the engine writes or reads to mirror a lead's outcome (opted out, not
 * interested, converted). Native SQL by table contract, like {@link EngagementReadDao}, and kept
 * apart from it because these touch other features' tables for writing.
 */
@Repository
public class EngagementCrmMirrorDao {

    @PersistenceContext
    private EntityManager em;

    /**
     * Mark these lead rows opted out (overall_status), the store every CRM list and the engine's
     * consent check read. Only rows of this institute's lists, only rows not already opted out.
     */
    @Transactional
    public int markLeadsOptedOut(String instituteId, Collection<String> responseIds) {
        if (responseIds == null || responseIds.isEmpty()) return 0;
        return em.createNativeQuery("""
                UPDATE audience_response ar
                   SET overall_status = 'OPTED_OUT'
                  FROM audience a
                 WHERE a.id = ar.audience_id AND a.institute_id = :instituteId
                   AND ar.id IN (:ids)
                   AND (ar.overall_status IS NULL OR ar.overall_status <> 'OPTED_OUT')
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", responseIds)
                .executeUpdate();
    }

    /** Lead row id to its current pipeline status key (rows without a status are left out). */
    public Map<String, String> leadStatusKeys(String instituteId, Collection<String> responseIds) {
        Map<String, String> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createNativeQuery("""
                SELECT ar.id, ls.status_key
                  FROM audience_response ar
                  JOIN audience a ON a.id = ar.audience_id
                  JOIN lead_status ls ON ls.id = ar.lead_status_id
                 WHERE a.institute_id = :instituteId AND ar.id IN (:ids)
                """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", responseIds)
                .getResultList();
        for (Object[] r : rows) out.put((String) r[0], (String) r[1]);
        return out;
    }

    /**
     * Live members of engines set to stop on a booked meeting (channels.exitOnMeetingBooked) whose
     * lead, or the lead's account, got a meeting booked since {@code since}: a booking page, an AI
     * call that booked the slot, or an admin booking on the lead's behalf. Cancelled bookings don't
     * count. booking_instance.created_at is naive UTC, like the other timestamps here.
     */
    public List<String> membersOfLeadsWithMeetingBookedSince(Collection<String> instituteIds, Instant since) {
        if (instituteIds == null || instituteIds.isEmpty()) return List.of();
        @SuppressWarnings("unchecked")
        List<String> ids = em.createNativeQuery("""
                SELECT m.id
                  FROM booking_instance b
                  JOIN engagement_member m ON m.audience_response_id = b.audience_response_id
                                          AND m.institute_id = b.institute_id
                  JOIN engagement_engine e ON e.id = m.engine_id
                 WHERE b.institute_id IN (:institutes)
                   AND b.created_at >= :since
                   AND b.status <> 'CANCELLED'
                   AND m.status IN ('ACTIVE', 'PAUSED')
                   AND e.status IN ('ACTIVE', 'DRY_RUN')
                   AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                   AND COALESCE(e.channels ->> 'exitOnMeetingBooked', 'false') = 'true'
                UNION
                SELECT m.id
                  FROM booking_instance b
                  JOIN engagement_member m ON m.user_id = b.invitee_user_id
                                          AND m.institute_id = b.institute_id
                  JOIN engagement_engine e ON e.id = m.engine_id
                 WHERE b.institute_id IN (:institutes)
                   AND b.created_at >= :since
                   AND b.invitee_user_id IS NOT NULL
                   AND b.status <> 'CANCELLED'
                   AND m.status IN ('ACTIVE', 'PAUSED')
                   AND e.status IN ('ACTIVE', 'DRY_RUN')
                   AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                   AND COALESCE(e.channels ->> 'exitOnMeetingBooked', 'false') = 'true'
                """)
                .setParameter("institutes", instituteIds)
                .setParameter("since", since)
                .getResultList();
        return ids;
    }

    /**
     * Members of live engines whose lead was marked Converted since the cursor: its lead row moved
     * to the Converted status (status history, indexed on institute and target status), or to Lost
     * / Not interested (L2: the pipeline ended the other way), or the
     * person's lead profile was converted (enrolment; indexed on institute and conversion status).
     * A run reads only the recent conversions, never every member. The AI-call engine is left out:
     * its members are held on purpose and a promise made on a call still goes out.
     */
    public List<String> membersOfLeadsConvertedSince(Collection<String> instituteIds, Instant since) {
        if (instituteIds == null || instituteIds.isEmpty()) return List.of();
        @SuppressWarnings("unchecked")
        List<String> ids = em.createNativeQuery("""
                SELECT m.id
                  FROM lead_status_history h
                  JOIN engagement_member m ON m.audience_response_id = h.audience_response_id
                                          AND m.institute_id = h.institute_id
                  JOIN engagement_engine e ON e.id = m.engine_id
                 WHERE h.institute_id IN (:institutes)
                   AND h.to_status_id IN (SELECT ls.id FROM lead_status ls
                                           WHERE ls.institute_id IN (:institutes)
                                             AND ls.status_key IN ('CONVERTED', 'LOST', 'NOT_INTERESTED'))
                   AND h.changed_at >= :since
                   AND m.status IN ('ACTIVE', 'PAUSED')
                   AND e.status IN ('ACTIVE', 'DRY_RUN')
                   AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                UNION
                SELECT m.id
                  FROM user_lead_profile ulp
                  JOIN engagement_member m ON m.user_id = ulp.user_id AND m.institute_id = ulp.institute_id
                  JOIN engagement_engine e ON e.id = m.engine_id
                 WHERE ulp.institute_id IN (:institutes)
                   AND ulp.conversion_status = 'CONVERTED'
                   AND ulp.converted_at >= :since
                   AND m.audience_response_id IS NOT NULL
                   AND m.status IN ('ACTIVE', 'PAUSED')
                   AND e.status IN ('ACTIVE', 'DRY_RUN')
                   AND (e.created_by IS NULL OR e.created_by <> 'SYSTEM_AI_CALL')
                """)
                .setParameter("institutes", instituteIds)
                .setParameter("since", since)
                .getResultList();
        return ids;
    }
}
