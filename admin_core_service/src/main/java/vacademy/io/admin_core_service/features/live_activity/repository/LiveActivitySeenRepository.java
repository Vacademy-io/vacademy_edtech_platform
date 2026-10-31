package vacademy.io.admin_core_service.features.live_activity.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_activity.entity.LiveActivitySeen;

import java.sql.Timestamp;
import java.util.Optional;

@Repository
public interface LiveActivitySeenRepository
        extends JpaRepository<LiveActivitySeen, LiveActivitySeen.Key> {

    Optional<LiveActivitySeen> findByUserIdAndInstituteId(String userId, String instituteId);

    /** Upsert -- the page marks itself seen on open, which races with itself across tabs. */
    @Modifying
    @Query(value = """
            INSERT INTO live_activity_seen (user_id, institute_id, last_seen_at)
            VALUES (:userId, :instituteId, :lastSeenAt)
            ON CONFLICT (user_id, institute_id)
            DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
            """, nativeQuery = true)
    void markSeen(@Param("userId") String userId,
                  @Param("instituteId") String instituteId,
                  @Param("lastSeenAt") Timestamp lastSeenAt);
}
