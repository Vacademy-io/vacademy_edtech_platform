package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;

import java.util.List;

/**
 * Member lookups the reply path needs beyond auto-reply candidates. Kept apart from
 * EngagementMemberRepository so the reply path can grow its own queries.
 */
public interface EngagementReplyMemberQueries extends Repository<EngagementMember, String> {

    /** A member of a live engine reached at this phone, whatever the engine's auto-reply setting. */
    interface LiveMember {
        String getMemberId();
        String getEngineId();
        Integer getCadenceHours();
    }

    /**
     * Every ACTIVE or PAUSED member of a live (ACTIVE or DRY_RUN) engine of the institute whose
     * learner or lead phone matches these last 10 digits. Unlike findAutoReplyCandidates this ignores
     * auto-reply, the kill switch and the holdout flag: it serves requests to stop, which must be
     * honoured on every engine. Admin engines come before the system AI-call engine, then the most
     * recently engaged first, so a note lands on the engine the person most plausibly answered.
     */
    @Query(value = """
            SELECT m.id AS memberId, m.engine_id AS engineId, e.cadence_hours AS cadenceHours
            FROM engagement_member m
            JOIN engagement_engine e ON e.id = m.engine_id
            WHERE m.institute_id = :instituteId AND m.status IN ('ACTIVE', 'PAUSED')
              AND e.status IN ('ACTIVE', 'DRY_RUN')
              AND (
                   m.user_id IN (
                       SELECT s.user_id FROM student s
                       WHERE RIGHT(regexp_replace(COALESCE(s.mobile_number,''),'[^0-9]','','g'),10) = :phone10)
                OR m.audience_response_id IN (
                       SELECT ar.id FROM audience_response ar
                       WHERE RIGHT(regexp_replace(COALESCE(ar.parent_mobile,''),'[^0-9]','','g'),10) = :phone10)
              )
            ORDER BY CASE WHEN e.created_by = 'SYSTEM_AI_CALL' THEN 1 ELSE 0 END,
                     m.last_decided_at DESC NULLS LAST
            """, nativeQuery = true)
    List<LiveMember> findLiveMembersByPhone(@Param("instituteId") String instituteId,
                                            @Param("phone10") String phone10);

    /** Of these inbound message ids, the ones a sweep already handled (engagement_handled_reply). */
    @Query(value = """
            SELECT wamid FROM engagement_handled_reply
             WHERE institute_id = :instituteId AND wamid IN (:wamids)
            """, nativeQuery = true)
    List<String> handledWamids(@Param("instituteId") String instituteId, @Param("wamids") List<String> wamids);
}
