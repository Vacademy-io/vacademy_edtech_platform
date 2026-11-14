package vacademy.io.admin_core_service.features.live_session.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSessionInstructor;

import java.util.List;
import java.util.Optional;

@Repository
public interface LiveSessionInstructorRepository extends JpaRepository<LiveSessionInstructor, String> {

    List<LiveSessionInstructor> findBySessionIdAndStatus(String sessionId, String status);

    List<LiveSessionInstructor> findBySessionIdInAndStatus(List<String> sessionIds, String status);

    /** All rows for a session regardless of status — the sync path reactivates soft-deleted rows. */
    List<LiveSessionInstructor> findBySessionId(String sessionId);

    Optional<LiveSessionInstructor> findBySessionIdAndUserId(String sessionId, String userId);

    @Query(value = """
        SELECT i.user_id
        FROM live_session_instructors i
        WHERE i.session_id = :sessionId AND i.status = 'ACTIVE'
    """, nativeQuery = true)
    List<String> findActiveUserIdsBySessionId(@Param("sessionId") String sessionId);
}
