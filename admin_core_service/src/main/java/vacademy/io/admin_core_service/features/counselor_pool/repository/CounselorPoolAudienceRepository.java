package vacademy.io.admin_core_service.features.counselor_pool.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolAudience;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

@Repository
public interface CounselorPoolAudienceRepository extends JpaRepository<CounselorPoolAudience, String> {

    /** Resolve the owning pool for an audience. Used by the assignment engine. */
    Optional<CounselorPoolAudience> findByAudienceId(String audienceId);

    /** List campaigns linked to a pool. */
    List<CounselorPoolAudience> findByPoolId(String poolId);

    /**
     * Pool memberships for a whole page of audiences in one query — the lead-list
     * header shows which pool a list feeds, and doing that per row would be an
     * N+1 across every campaign on screen.
     */
    List<CounselorPoolAudience> findByAudienceIdIn(List<String> audienceIds);

    /** Used during pool create/update to block adding an audience that already belongs to another pool. */
    boolean existsByAudienceId(String audienceId);

    /** Used at delete time to ensure pool is empty before removal. */
    boolean existsByPoolId(String poolId);

    /**
     * Pessimistic write lock on the audience's pool row. The assignment engine
     * calls this inside a transaction so two concurrent leads for the same
     * audience serialize on the round-robin pointer update.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT cpa FROM CounselorPoolAudience cpa WHERE cpa.audienceId = :audienceId")
    Optional<CounselorPoolAudience> findByAudienceIdForUpdate(@Param("audienceId") String audienceId);

    /**
     * The pool's most recent assignment across ALL its lists — the pool-wide
     * round-robin pointer. Without it every low-volume list rotates on its own
     * and each list's first lead lands on the same top-of-order counselor.
     */
    Optional<CounselorPoolAudience> findFirstByPoolIdAndLastAssignedAtIsNotNullOrderByLastAssignedAtDesc(String poolId);

    /** Cleanly update the rotation pointer after picking a counselor. */
    @Modifying
    @Query("UPDATE CounselorPoolAudience cpa " +
           "   SET cpa.lastAssignedCounselorId = :counselorUserId, " +
           "       cpa.lastAssignedAt = :now " +
           " WHERE cpa.id = :id")
    void updateLastAssigned(@Param("id") String id,
                            @Param("counselorUserId") String counselorUserId,
                            @Param("now") Timestamp now);
}
