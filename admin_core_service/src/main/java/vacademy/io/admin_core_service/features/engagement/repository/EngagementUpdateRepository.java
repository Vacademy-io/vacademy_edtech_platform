package vacademy.io.admin_core_service.features.engagement.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementUpdate;

import java.time.Instant;
import java.util.List;

@Repository
public interface EngagementUpdateRepository extends JpaRepository<EngagementUpdate, String> {

    List<EngagementUpdate> findByEngineIdOrderByCreatedAtDesc(String engineId);

    /** Started and not ended, on an engine that is running, and nobody has been asked to look yet. */
    @Query(value = """
            SELECT u.* FROM engagement_update u
            JOIN engagement_engine e ON e.id = u.engine_id
            WHERE u.status = 'ACTIVE' AND u.announced_at IS NULL
              AND u.starts_at <= :now AND u.ends_at > :now
              AND e.status IN ('ACTIVE', 'DRY_RUN')
            """, nativeQuery = true)
    List<EngagementUpdate> findDueToAnnounce(@Param("now") Instant now);

    @Query(value = "SELECT * FROM engagement_update WHERE status = 'ACTIVE' AND ends_at <= :now", nativeQuery = true)
    List<EngagementUpdate> findPastTheirEnd(@Param("now") Instant now);

    /** One replica announces an update, once. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_update SET announced_at = :now, updated_at = :now
            WHERE id = :id AND announced_at IS NULL
            """, nativeQuery = true)
    int markAnnounced(@Param("id") String id, @Param("now") Instant now);

    @Modifying
    @Transactional
    @Query(value = """
            UPDATE engagement_update SET status = 'ENDED', updated_at = :now
            WHERE id = :id AND status = 'ACTIVE'
            """, nativeQuery = true)
    int markEnded(@Param("id") String id, @Param("now") Instant now);
}
