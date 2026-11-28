package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralRewardCredit;

import java.util.List;
import java.util.Optional;

public interface ReferralRewardCreditRepository extends JpaRepository<ReferralRewardCredit, String> {

    boolean existsByReferralMappingIdAndBeneficiary(String referralMappingId, String beneficiary);

    /**
     * The credit a renewal of this plan should spend: one this plan already reserved (a
     * dunning retry, or the replica that lost the plan claim reserved it first), else the
     * member's oldest AVAILABLE credit at the institute.
     */
    @Query(value = """
            SELECT * FROM referral_reward_credit c
            WHERE c.user_id = :userId
              AND c.institute_id = :instituteId
              AND (c.status = 'AVAILABLE'
                   OR (c.status = 'RESERVED' AND c.user_plan_id = :userPlanId))
            ORDER BY CASE WHEN c.status = 'RESERVED' THEN 0 ELSE 1 END, c.created_at, c.id
            LIMIT 1
            """, nativeQuery = true)
    Optional<ReferralRewardCredit> findUsableForPlan(@Param("userId") String userId,
                                                     @Param("instituteId") String instituteId,
                                                     @Param("userPlanId") String userPlanId);

    /** AVAILABLE → RESERVED for this plan, exactly once. 0 rows = someone else took it. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE referral_reward_credit
            SET status = 'RESERVED', user_plan_id = :userPlanId, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'AVAILABLE'
            """, nativeQuery = true)
    int reserve(@Param("id") String id, @Param("userPlanId") String userPlanId);

    /** Spends the credits this plan reserved whose discount line is on the PAID log. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE referral_reward_credit c
            SET status = 'CONSUMED', consumed_payment_log_id = :paymentLogId,
                consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE c.status = 'RESERVED'
              AND c.user_plan_id = :userPlanId
              AND EXISTS (SELECT 1 FROM payment_log_line_item li
                          WHERE li.payment_log_id = :paymentLogId
                            AND li.source_id = c.applied_coupon_discount_id)
            """, nativeQuery = true)
    int consumeForPaidLog(@Param("userPlanId") String userPlanId, @Param("paymentLogId") String paymentLogId);

    /** PENDING → AVAILABLE once the referee has converted. */
    @Modifying
    @Transactional
    @Query(value = """
            UPDATE referral_reward_credit
            SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
            WHERE referral_mapping_id = :referralMappingId AND status = 'PENDING'
            """, nativeQuery = true)
    int releaseForMapping(@Param("referralMappingId") String referralMappingId);

    List<ReferralRewardCredit> findByUserIdAndInstituteIdOrderByCreatedAtDesc(String userId, String instituteId);
}
