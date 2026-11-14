package vacademy.io.admin_core_service.features.telephony.queue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallLane;

import java.time.Instant;

@Repository
public interface AiCallLaneRepository extends JpaRepository<AiCallLane, String> {

    /**
     * Stamp the rotation cursor without loading the entity. Written on every dispatch
     * and never read today — see {@link AiCallLane#getLastDispatchedAt()}. Silently a
     * no-op for an institute with no override row, which is most of them.
     */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE ai_call_lane SET last_dispatched_at = :at, updated_at = NOW()
             WHERE institute_id = :instituteId
            """, nativeQuery = true)
    int touchDispatched(@Param("instituteId") String instituteId, @Param("at") Instant at);
}
