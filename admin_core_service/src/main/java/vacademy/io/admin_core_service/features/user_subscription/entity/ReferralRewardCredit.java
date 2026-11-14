package vacademy.io.admin_core_service.features.user_subscription.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/**
 * A referral discount earned now and spent on a later charge (V611). See
 * {@link vacademy.io.admin_core_service.features.user_subscription.service.ReferralRewardService}.
 */
@Entity
@Table(name = "referral_reward_credit")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReferralRewardCredit {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_AVAILABLE = "AVAILABLE";
    public static final String STATUS_RESERVED = "RESERVED";
    public static final String STATUS_CONSUMED = "CONSUMED";

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** The member who gets the discount. */
    @Column(name = "user_id", nullable = false)
    private String userId;

    /** REFERRER (the only beneficiary that holds credits today). */
    @Column(name = "beneficiary", nullable = false)
    private String beneficiary;

    @Column(name = "referral_mapping_id", nullable = false)
    private String referralMappingId;

    /** The discount rule (discount_source = REFERRAL) the charge applies. */
    @Column(name = "applied_coupon_discount_id", nullable = false)
    private String appliedCouponDiscountId;

    /** Set once a renewal of this plan reserves the credit. */
    @Column(name = "user_plan_id")
    private String userPlanId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "consumed_payment_log_id")
    private String consumedPaymentLogId;

    @Column(name = "consumed_at")
    private LocalDateTime consumedAt;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    /** Maintained by the repository's status UPDATEs, never written from the entity. */
    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}
