package vacademy.io.admin_core_service.features.counselor_pool.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.counselor_pool.entity.CounselorPoolMember;

import java.util.List;

@Repository
public interface CounselorPoolMemberRepository extends JpaRepository<CounselorPoolMember, String> {

    /**
     * Ordered list of members for one audience inside a pool. The assignment
     * engine consumes this for round-robin / time-based routing. Returns ALL
     * members regardless of status; engine applies status + backup logic per row.
     */
    List<CounselorPoolMember> findByPoolIdAndAudienceIdOrderByDisplayOrderAsc(String poolId, String audienceId);

    /** All rows for a pool. Used by the "add audience" flow to seed default member rows for the new audience. */
    List<CounselorPoolMember> findByPoolId(String poolId);

    /** All rows for one counselor inside one pool. Powers the "mark inactive in this pool" admin action. */
    List<CounselorPoolMember> findByPoolIdAndCounselorUserId(String poolId, String counselorUserId);

    /** All audience rows for one counselor across an institute (used for "show me Amit's pool memberships"). */
    @Query("SELECT m FROM CounselorPoolMember m " +
           "  JOIN CounselorPool p ON p.id = m.poolId " +
           " WHERE p.instituteId = :instituteId AND m.counselorUserId = :counselorUserId")
    List<CounselorPoolMember> findByInstituteAndCounselor(@Param("instituteId") String instituteId,
                                                          @Param("counselorUserId") String counselorUserId);

    /**
     * Batched "is anyone here active?" probe — one query for N counsellors
     * instead of N round-trips. Returns the DISTINCT counsellor ids that have
     * at least one ACTIVE row in any pool for the institute. The workbench's
     * `is_active` rollup uses this (anyMatch semantics): a counsellor is
     * "active in the workbench" if they have ANY active membership, even when
     * paused on some audiences. NOT a substitute for
     * `listActiveMembershipsForCounselor` — that one's allMatch-per-pool by
     * design (used by the "mark inactive" UI to surface only pools where the
     * counsellor is still fully operational).
     */
    @Query("SELECT DISTINCT m.counselorUserId FROM CounselorPoolMember m " +
           "  JOIN CounselorPool p ON p.id = m.poolId " +
           " WHERE p.instituteId = :instituteId " +
           "   AND m.counselorUserId IN :counselorUserIds " +
           "   AND m.status = 'ACTIVE'")
    List<String> findCounselorsWithAnyActiveMembership(@Param("instituteId") String instituteId,
                                                       @Param("counselorUserIds") java.util.Collection<String> counselorUserIds);

    /** Flip all of a counselor's rows in a pool to a given status, optionally setting a backup. */
    @Modifying
    @Query("UPDATE CounselorPoolMember m " +
           "   SET m.status = :status, " +
           "       m.backupCounselorUserId = :backupUserId " +
           " WHERE m.poolId = :poolId AND m.counselorUserId = :counselorUserId")
    int bulkUpdateStatusForCounselorInPool(@Param("poolId") String poolId,
                                           @Param("counselorUserId") String counselorUserId,
                                           @Param("status") String status,
                                           @Param("backupUserId") String backupUserId);

    /**
     * Takes members out of lead rotation in every pool of one institute: their ACTIVE rows
     * become INACTIVE. Used when an admin disables, deletes or cancels a member in
     * Institute - Teams. The backup column is left as it is, and rows that are already
     * INACTIVE are not touched, so repeating the call changes nothing.
     */
    @Modifying(clearAutomatically = true)
    @Query("UPDATE CounselorPoolMember m " +
           "   SET m.status = 'INACTIVE', " +
           "       m.updatedAt = CURRENT_TIMESTAMP " +
           " WHERE m.counselorUserId IN :counselorUserIds " +
           "   AND m.status = 'ACTIVE' " +
           "   AND m.poolId IN (SELECT p.id FROM CounselorPool p WHERE p.instituteId = :instituteId)")
    int deactivateActiveMembershipsInInstitute(@Param("instituteId") String instituteId,
                                               @Param("counselorUserIds") java.util.Collection<String> counselorUserIds);

    /**
     * Set monthly_target for exactly one (pool, audience, counsellor) cell. A
     * null target clears the value. No-op (returns 0) if the row doesn't
     * exist — by design, the UI only ever sends valid combinations and direct
     * API hits with junk ids are harmless.
     */
    @Modifying
    @Query("UPDATE CounselorPoolMember m " +
           "   SET m.monthlyTarget = :monthlyTarget " +
           " WHERE m.poolId = :poolId " +
           "   AND m.audienceId = :audienceId " +
           "   AND m.counselorUserId = :counselorUserId")
    int updateMonthlyTarget(@Param("poolId") String poolId,
                            @Param("audienceId") String audienceId,
                            @Param("counselorUserId") String counselorUserId,
                            @Param("monthlyTarget") Integer monthlyTarget);

    boolean existsByPoolIdAndAudienceIdAndCounselorUserId(String poolId, String audienceId, String counselorUserId);

    void deleteByPoolId(String poolId);
}
