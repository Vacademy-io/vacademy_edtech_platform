package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UserPlanDTO {

    private String id;
    private String userId;
    private String paymentPlanId;
    private String planJson;

    private String appliedCouponDiscountId;
    private String appliedCouponDiscountJson;

    /**
     * Parsed projection of {@link #appliedCouponDiscountJson}. Surfaced as
     * {@code applied_coupon} on the wire so FE clients can read coupon info
     * structurally instead of JSON.parse-ing the blob field above. Null when
     * no coupon was applied at enrollment.
     */
    private CouponSnapshotDTO appliedCoupon;

    /** Admin who attached the discount (ad-hoc or a picked coupon); null for learner coupons. */
    private String discountGrantedByUserId;
    private Date discountGrantedAt;
    private Integer discountCyclesApplied;

    private String enrollInviteId;

    private String paymentOptionId;
    private String paymentOptionJson;

    private String status;
    private String source;

    private SubOrgDetailsDTO subOrgDetails;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // --- Added Date Fields ---
    private Date startDate;
    private Date endDate;
    // -------------------------

    private List<PaymentLogDTO> paymentLogs;

    private EnrollInviteDTO enrollInvite;

    private PaymentOptionDTO paymentOption;

    private PaymentPlanDTO paymentPlanDTO;

    /**
     * Policy details for each package session associated with this user plan.
     * Null if not requested or no policies configured.
     */
    private List<PackageSessionPolicyDetailsDTO> policyDetails;
}