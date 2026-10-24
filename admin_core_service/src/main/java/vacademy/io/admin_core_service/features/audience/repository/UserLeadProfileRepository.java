package vacademy.io.admin_core_service.features.audience.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.audience.entity.UserLeadProfile;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserLeadProfileRepository extends JpaRepository<UserLeadProfile, String> {

    Optional<UserLeadProfile> findByUserId(String userId);

    /**
     * Any profile this person is the counsellor on, used only to read the
     * denormalized {@code assigned_counselor_name}: admin_core cannot see
     * auth_service's users table, so this is the one place inside its own
     * database where a staff member's name is written down.
     */
    Optional<UserLeadProfile> findFirstByAssignedCounselorIdAndAssignedCounselorNameIsNotNull(
            String assignedCounselorId);

    Optional<UserLeadProfile> findByUserIdAndInstituteId(String userId, String instituteId);

    List<UserLeadProfile> findByUserIdIn(List<String> userIds);

    List<UserLeadProfile> findByUserIdInAndInstituteId(List<String> userIds, String instituteId);

    Page<UserLeadProfile> findByInstituteId(String instituteId, Pageable pageable);

    /** Find profiles by institute + tier (HOT, WARM, COLD). */
    Page<UserLeadProfile> findByInstituteIdAndLeadTier(String instituteId, String leadTier, Pageable pageable);

    /** Find profiles by institute + conversion status. */
    Page<UserLeadProfile> findByInstituteIdAndConversionStatus(
            String instituteId, String conversionStatus, Pageable pageable);

    /**
     * Open profiles for a specific counsellor. "Open" = conversion_status is
     * NULL or anything other than 'CONVERTED' — same canonical predicate
     * used by AudienceResponseRepository and WorkbenchLeadRepository. Used
     * by the reassign flow so it doesn't silently skip leads whose
     * conversion_status is NULL (which is the bulk of real data).
     */
    @Query("SELECT p FROM UserLeadProfile p " +
           "WHERE p.instituteId = :instituteId " +
           "  AND p.assignedCounselorId = :counsellorUserId " +
           "  AND (p.conversionStatus IS NULL OR p.conversionStatus <> 'CONVERTED')")
    List<UserLeadProfile> findOpenByInstituteAndCounsellor(
            @Param("instituteId") String instituteId,
            @Param("counsellorUserId") String counsellorUserId);

    /** Count profiles per tier for a given institute. */
    @Query("SELECT p.leadTier, COUNT(p) FROM UserLeadProfile p WHERE p.instituteId = :instituteId GROUP BY p.leadTier")
    List<Object[]> countByTierForInstitute(@Param("instituteId") String instituteId);

    /**
     * Fetch all user IDs for a given institute so the batch rebuild can process them.
     */
    @Query("SELECT p.userId FROM UserLeadProfile p WHERE p.instituteId = :instituteId")
    List<String> findUserIdsByInstituteId(@Param("instituteId") String instituteId);

    /**
     * Find the user_ids of OPEN leads (conversion_status = 'LEAD') currently
     * assigned to {@code fromCounselorId} within a pool's scope. A lead is
     * "in this pool" if its user has any audience_response row whose audience
     * belongs to the pool — so a counselor inactivated in pool A doesn't
     * touch leads tied only to pool B's audiences.
     *
     * Returns user_ids rather than profiles because the caller loops and
     * routes each one through UserLeadProfileService.assignCounselor — that
     * keeps the workflow trigger emission + timeline-event logging
     * consistent with the manual reassign endpoint instead of bypassing
     * them with a bulk UPDATE.
     *
     * Native SQL because the scoping join goes through two tables
     * (audience_response, counselor_pool_audience) that aren't worth
     * modeling as JPA associations for this one query.
     */
    @Query(value = "SELECT ulp.user_id FROM user_lead_profile ulp " +
                   " WHERE ulp.assigned_counselor_id = :fromCounselorId " +
                   "   AND ulp.institute_id = :instituteId " +
                   "   AND ulp.conversion_status = 'LEAD' " +
                   "   AND EXISTS (" +
                   "       SELECT 1 FROM audience_response ar " +
                   "         JOIN counselor_pool_audience cpa ON cpa.audience_id = ar.audience_id " +
                   "        WHERE ar.user_id = ulp.user_id " +
                   "          AND cpa.pool_id = :poolId" +
                   "   )",
           nativeQuery = true)
    List<String> findOpenLeadUserIdsForCounselorInPool(@Param("poolId") String poolId,
                                                       @Param("fromCounselorId") String fromCounselorId,
                                                       @Param("instituteId") String instituteId);
}
