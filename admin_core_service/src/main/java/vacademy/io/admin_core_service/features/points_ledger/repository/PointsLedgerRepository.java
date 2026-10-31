package vacademy.io.admin_core_service.features.points_ledger.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsLedger;

import java.sql.Timestamp;
import java.util.List;

@Repository
public interface PointsLedgerRepository extends JpaRepository<PointsLedger, String> {

    boolean existsByIdempotencyKey(String idempotencyKey);

    /** Awards of one source for one learner since an instant (daily caps). */
    long countByInstituteIdAndUserIdAndSourceTypeAndAwardedAtGreaterThanEqual(
            String instituteId, String userId, String sourceType, java.sql.Timestamp since);

    /** Total points for one learner in one institute (all sources, all time). */
    @Query("SELECT COALESCE(SUM(p.points), 0) FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.userId = :userId")
    long sumForUser(@Param("instituteId") String instituteId, @Param("userId") String userId);

    /** Total points for one learner since an instant — the "this week" figure. */
    @Query("SELECT COALESCE(SUM(p.points), 0) FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.userId = :userId AND p.awardedAt >= :since")
    long sumForUserSince(@Param("instituteId") String instituteId,
                         @Param("userId") String userId,
                         @Param("since") Timestamp since);

    /** Rows: [sourceType, sum] — the learner-facing "where did my points come from" breakdown. */
    @Query("SELECT p.sourceType, COALESCE(SUM(p.points), 0) FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.userId = :userId GROUP BY p.sourceType")
    List<Object[]> breakdownForUser(@Param("instituteId") String instituteId,
                                    @Param("userId") String userId);

    /**
     * Rows: [userId, totalPoints] for one batch, ordered high to low — the ledger-backed
     * batch leaderboard.
     *
     * Deliberately split into all-time and windowed variants rather than one query with
     * "(:since IS NULL OR ...)": an untyped null comparison in JPQL is a bootstrap-time
     * risk, and a bad @Query fails the whole service at startup, not at test time.
     */
    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.packageSessionId = :packageSessionId " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> leaderboardForPackageSession(@Param("packageSessionId") String packageSessionId);

    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.packageSessionId = :packageSessionId AND p.awardedAt >= :since " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> leaderboardForPackageSessionSince(@Param("packageSessionId") String packageSessionId,
                                                     @Param("since") Timestamp since);

    /** Rows: [userId, totalPoints] across the whole institute, ordered high to low. */
    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> leaderboardForInstitute(@Param("instituteId") String instituteId);

    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.awardedAt >= :since " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> leaderboardForInstituteSince(@Param("instituteId") String instituteId,
                                                @Param("since") Timestamp since);

    /**
     * Rows: [userId, totalPoints] for a specific set of learners, institute-scoped.
     *
     * This is what a BATCH leaderboard uses, rather than filtering on
     * package_session_id: engagement points are batch-attributed, but learner-level
     * awards (ACTIVITY, streaks) carry no batch and would be invisible to a
     * package-session filter. Scoping by the batch roster counts both.
     */
    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.userId IN :userIds " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> sumByUsers(@Param("instituteId") String instituteId,
                              @Param("userIds") List<String> userIds);

    @Query("SELECT p.userId, COALESCE(SUM(p.points), 0) AS total FROM PointsLedger p " +
            "WHERE p.instituteId = :instituteId AND p.userId IN :userIds AND p.awardedAt >= :since " +
            "GROUP BY p.userId ORDER BY total DESC")
    List<Object[]> sumByUsersSince(@Param("instituteId") String instituteId,
                                   @Param("userIds") List<String> userIds,
                                   @Param("since") Timestamp since);

    /** Every award tied to one source row — used when reversing an item's points. */
    List<PointsLedger> findBySourceTypeAndSourceId(String sourceType, String sourceId);
}
