package vacademy.io.admin_core_service.features.user_subscription.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Builder
public class AppliedCouponDiscountDTO {
    private String id;
    private String name;
    private String discountType; // percentage, amount, media
    private String mediaIds; // comma-separated or JSON string
    private String status;
    private Integer validityInDays;
    private String discountSource; // referral, coupon code
    private String currency;
    private Double maxDiscountPoint;
    private Double discountPoint;
    private Integer maxApplicableTimes;
    private Date redeemStartDate;
    private Date redeemEndDate;
    private CouponCodeDTO couponCode;
    private String grantedByUserId;
    private Date grantedAt;
    private String grantReason;
    private String instituteId;
    private Integer applyForCycles;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
