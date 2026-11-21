package vacademy.io.common.auth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.auth.entity.UserSession;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface UserSessionRepository extends JpaRepository<UserSession, String> {

       // Find active sessions - Cast UUID column to TEXT for comparison with VARCHAR
       // parameter
       @Query(value = "SELECT COUNT(DISTINCT u.user_id) FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.is_active = true AND u.last_activity_time >= :cutoffTime", nativeQuery = true)
       Long countActiveUsersInInstitute(@Param("instituteId") String instituteId,
                     @Param("cutoffTime") LocalDateTime cutoffTime);

       @Query(value = "SELECT * FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.is_active = true AND u.last_activity_time >= :cutoffTime", nativeQuery = true)
       List<UserSession> findActiveSessionsInInstitute(@Param("instituteId") String instituteId,
                     @Param("cutoffTime") LocalDateTime cutoffTime);

       // Find user's active sessions
       @Query("SELECT u FROM UserSession u WHERE u.userId = :userId AND u.isActive = true ORDER BY u.lastActivityTime DESC")
       List<UserSession> findActiveSessionsByUserId(@Param("userId") String userId);

       // Find session by token
       List<UserSession> findBySessionTokenAndIsActive(String sessionToken, Boolean isActive);

       // Update last activity time, at most once per staleBefore window. Every request
       // touched this row (twice), and last_activity_time sits in several indexes, so each
       // write was a non-HOT update through all of them and concurrent requests queued on
       // the row lock (4-5 s waits). Readers look at windows of 5 minutes or more.
       @Modifying
       @Transactional
       @Query("UPDATE UserSession u SET u.lastActivityTime = :activityTime WHERE u.sessionToken = :sessionToken AND u.isActive = true " +
                     "AND (u.lastActivityTime IS NULL OR u.lastActivityTime < :staleBefore)")
       void updateLastActivityTime(@Param("sessionToken") String sessionToken,
                     @Param("activityTime") LocalDateTime activityTime,
                     @Param("staleBefore") LocalDateTime staleBefore);

       // End session by token (existing — used by UserActivityTrackingService and
       // logout-by-token)
       @Modifying
       @Transactional
       @Query("UPDATE UserSession u SET u.isActive = false, u.logoutTime = :logoutTime WHERE u.sessionToken = :sessionToken")
       void endSession(@Param("sessionToken") String sessionToken, @Param("logoutTime") LocalDateTime logoutTime);

       // End inactive sessions — uses SKIP LOCKED so the bulk cleanup never deadlocks
       // with a concurrent endSession/endAllSessions call that holds a row lock.
       @Modifying
       @Transactional
       @Query(value = "UPDATE user_session SET is_active = false, logout_time = :logoutTime " +
                     "WHERE id IN (" +
                     "  SELECT id FROM user_session " +
                     "  WHERE is_active = true AND last_activity_time < :cutoffTime " +
                     "  FOR UPDATE SKIP LOCKED" +
                     ")", nativeQuery = true)
       void endInactiveSessions(@Param("cutoffTime") LocalDateTime cutoffTime,
                     @Param("logoutTime") LocalDateTime logoutTime);

       // Analytics queries - Cast UUID column to TEXT for comparison with VARCHAR
       // parameter
       @Query(value = "SELECT u.device_type, COUNT(u.*) FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.login_time >= :startTime GROUP BY u.device_type", nativeQuery = true)
       List<Object[]> getDeviceUsageStats(@Param("instituteId") String instituteId,
                     @Param("startTime") LocalDateTime startTime);

       @Query(value = "SELECT AVG(u.session_duration_minutes) FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.session_duration_minutes IS NOT NULL AND u.login_time >= :startTime", nativeQuery = true)
       Double getAverageSessionDuration(@Param("instituteId") String instituteId,
                     @Param("startTime") LocalDateTime startTime);

       @Query(value = "SELECT DATE(u.login_time), COUNT(DISTINCT u.user_id) FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.login_time >= :startTime GROUP BY DATE(u.login_time) ORDER BY DATE(u.login_time)", nativeQuery = true)
       List<Object[]> getDailyUniqueLogins(@Param("instituteId") String instituteId,
                     @Param("startTime") LocalDateTime startTime);

       // Real-time monitoring - Cast UUID column to TEXT for comparison with VARCHAR
       // parameter
       @Query(value = "SELECT COUNT(u.*) FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.is_active = true", nativeQuery = true)
       Long countCurrentlyActiveUsers(@Param("instituteId") String instituteId);

       @Query(value = "SELECT u.user_id, u.last_activity_time FROM user_session u WHERE CAST(u.institute_id AS TEXT) = :instituteId AND u.is_active = true ORDER BY u.last_activity_time DESC", nativeQuery = true)
       List<Object[]> getCurrentlyActiveUsersWithLastActivity(@Param("instituteId") String instituteId);

       // Session history for user
       List<UserSession> findByUserIdAndInstituteIdOrderByLoginTimeDesc(String userId, String instituteId);

       // Find sessions by login time range
       List<UserSession> findByLoginTimeBetween(LocalDateTime startTime, LocalDateTime endTime);

       // Student analysis queries - get login statistics for specific user and date
       // range
       @Query("SELECT COUNT(u) FROM UserSession u WHERE u.userId = :userId AND u.loginTime BETWEEN :startTime AND :endTime")
       Long countTotalLoginsByUserAndDateRange(@Param("userId") String userId,
                     @Param("startTime") LocalDateTime startTime,
                     @Param("endTime") LocalDateTime endTime);

       @Query("SELECT MAX(u.loginTime) FROM UserSession u WHERE u.userId = :userId AND u.loginTime BETWEEN :startTime AND :endTime")
       LocalDateTime findLastLoginTimeByUserAndDateRange(@Param("userId") String userId,
                     @Param("startTime") LocalDateTime startTime,
                     @Param("endTime") LocalDateTime endTime);

       @Query("SELECT AVG(u.sessionDurationMinutes) FROM UserSession u WHERE u.userId = :userId AND u.loginTime BETWEEN :startTime AND :endTime AND u.sessionDurationMinutes IS NOT NULL")
       Double findAvgSessionDurationByUserAndDateRange(@Param("userId") String userId,
                     @Param("startTime") LocalDateTime startTime,
                     @Param("endTime") LocalDateTime endTime);

       @Query("SELECT COALESCE(SUM(u.sessionDurationMinutes), 0) FROM UserSession u WHERE u.userId = :userId AND u.loginTime BETWEEN :startTime AND :endTime AND u.sessionDurationMinutes IS NOT NULL")
       Long findTotalActiveTimeByUserAndDateRange(@Param("userId") String userId,
                     @Param("startTime") LocalDateTime startTime,
                     @Param("endTime") LocalDateTime endTime);

       // ── NEW: Session limit enforcement queries ─────────────────────────────────

       /**
        * Returns all active sessions for a specific user within a specific institute.
        * Used by the session limit check before login.
        */
       @Query("SELECT u FROM UserSession u WHERE u.userId = :userId " +
                     "AND u.instituteId = :instituteId AND u.isActive = true " +
                     "ORDER BY u.lastActivityTime DESC")
       List<UserSession> findActiveSessionsByUserIdAndInstituteId(
                     @Param("userId") String userId,
                     @Param("instituteId") String instituteId);

       /**
        * Ends a session by its UUID (row ID), not by token.
        * Called from the popup "Log Out" button which passes session_id.
        */
       @Modifying
       @Transactional
       @Query("UPDATE UserSession u SET u.isActive = false, u.logoutTime = :logoutTime WHERE u.id = :sessionId")
       void endSessionById(
                     @Param("sessionId") String sessionId,
                     @Param("logoutTime") LocalDateTime logoutTime);

       /**
        * Ends ALL active sessions for a user+institute.
        * Called from the normal logout endpoint to clean up all sessions on user
        * logout.
        */
       @Modifying
       @Transactional
       @Query("UPDATE UserSession u SET u.isActive = false, u.logoutTime = :logoutTime " +
                     "WHERE u.userId = :userId AND u.instituteId = :instituteId AND u.isActive = true")
       void endAllSessionsByUserIdAndInstituteId(
                     @Param("userId") String userId,
                     @Param("instituteId") String instituteId,
                     @Param("logoutTime") LocalDateTime logoutTime);

       // ==================== Super Admin Queries ====================

       @Query(value = """
                     SELECT u.id, u.user_id, u.device_type, u.ip_address, u.is_active,
                            u.login_time, u.last_activity_time, u.logout_time, u.session_duration_minutes
                     FROM user_session u
                     WHERE CAST(u.institute_id AS TEXT) = :instituteId
                       AND (:startDate IS NULL OR u.login_time >= CAST(:startDate AS TIMESTAMP))
                       AND (:endDate IS NULL OR u.login_time <= CAST(:endDate AS TIMESTAMP))
                     ORDER BY u.login_time DESC
                     LIMIT :size OFFSET :offset
                     """, nativeQuery = true)
       List<Object[]> findSessionsByInstitutePaginated(@Param("instituteId") String instituteId,
                     @Param("startDate") LocalDateTime startDate, @Param("endDate") LocalDateTime endDate,
                     @Param("size") int size, @Param("offset") int offset);

       @Query(value = """
                     SELECT COUNT(*) FROM user_session u
                     WHERE CAST(u.institute_id AS TEXT) = :instituteId
                       AND (:startDate IS NULL OR u.login_time >= CAST(:startDate AS TIMESTAMP))
                       AND (:endDate IS NULL OR u.login_time <= CAST(:endDate AS TIMESTAMP))
                     """, nativeQuery = true)
       Long countSessionsByInstitute(@Param("instituteId") String instituteId,
                     @Param("startDate") LocalDateTime startDate, @Param("endDate") LocalDateTime endDate);

       @Query(value = "SELECT COUNT(DISTINCT u.user_id) FROM user_session u WHERE u.is_active = true", nativeQuery = true)
       Long countTotalCurrentlyActiveUsers();

       @Query(value = """
                     SELECT CAST(u.institute_id AS TEXT) AS institute_id, COUNT(DISTINCT u.user_id) AS active_count
                     FROM user_session u
                     WHERE u.is_active = true AND u.institute_id IS NOT NULL
                     GROUP BY u.institute_id
                     ORDER BY active_count DESC
                     """, nativeQuery = true)
       List<Object[]> getPerInstituteActiveCounts();

       // ── Session-limit enforcement (used by JwtAuthFilter cache) ──

       @Query(value = "SELECT COUNT(*) FROM institute_settings " +
                     "WHERE CAST(institute_id AS TEXT) = :instituteId " +
                     "AND settings_json LIKE '%max_active_sessions%'", nativeQuery = true)
       long countSessionLimitConfigured(@Param("instituteId") String instituteId);

       @Query(value = "SELECT COUNT(*) FROM user_session " +
                     "WHERE session_token = :sessionToken AND is_active = true " +
                     "AND institute_id IS NOT NULL", nativeQuery = true)
       long countActiveSession(@Param("sessionToken") String sessionToken);

       // Legacy boolean versions (used by AssessmentJwtAuthFilter — will silently fail
       // and cache false)
       default boolean hasSessionLimitConfigured(String instituteId) {
              return countSessionLimitConfigured(instituteId) > 0;
       }

       default boolean isSessionActive(String sessionToken) {
              return countActiveSession(sessionToken) > 0;
       }
}
