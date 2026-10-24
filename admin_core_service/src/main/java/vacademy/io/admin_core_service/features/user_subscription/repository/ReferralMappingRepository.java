package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralMapping;

import java.util.List;
import java.util.Optional;

public interface ReferralMappingRepository extends JpaRepository<ReferralMapping,String> {
    @Query("SELECT COUNT(rm) FROM ReferralMapping rm WHERE rm.referrerUserId = :referrerUserId AND rm.status = 'ACTIVE'")
    long countActiveReferralsByReferrerUserId(@Param("referrerUserId") String referrerUserId);

    @Query("""
    SELECT rm
    FROM ReferralMapping rm
    WHERE rm.userPlan.id = :userPlanId
      AND rm.status IN :status
""")
    Optional<ReferralMapping> findByUserPlanIdAndStatusIn(@Param("userPlanId") String userPlanId,
                                                          @Param("status") List<String> status);

    /** Whether this person was already referred into the programme's institute (or other source). */
    @Query("""
    SELECT COUNT(rm) > 0
    FROM ReferralMapping rm
    WHERE rm.refereeUserId = :refereeUserId
      AND rm.referralOption.sourceId = :sourceId
      AND rm.status IN :status
""")
    boolean existsRefereeAtSource(@Param("refereeUserId") String refereeUserId,
                                  @Param("sourceId") String sourceId,
                                  @Param("status") List<String> status);

    List<ReferralMapping> findByRefereeUserIdAndStatusInOrderByCreatedAtDesc(
            String refereeUserId,
            List<String> statusList
    );

    List<ReferralMapping> findByReferrerUserIdAndStatusInOrderByCreatedAtDesc(
            String refereeUserId,
            List<String> statusList
    );

    @Query("SELECT COUNT(r) " +
            "FROM ReferralMapping r " +
            "WHERE r.referrerUserId = :referrerUserId " +
            "AND r.status IN :statusList")
    long countByReferrerUserIdAndStatusList(@Param("referrerUserId") String referrerUserId,
                                            @Param("statusList") List<String> statusList);

}
