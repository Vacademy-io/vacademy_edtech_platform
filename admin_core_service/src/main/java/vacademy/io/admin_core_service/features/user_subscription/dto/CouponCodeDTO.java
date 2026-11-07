package vacademy.io.admin_core_service.features.user_subscription.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.sql.Timestamp;
import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Builder
public class CouponCodeDTO {
    private String id;
    private String code; // Actual coupon code shown to users
    private String status; // ACTIVE, EXPIRED, REDEEMED
    private String sourceType; // ADMIN, SYSTEM
    private String sourceId; // ID of source entity
    private boolean emailRestricted; // applicable only to listed emails
    private String allowedEmailIds; // JSON string or comma-separated emails
    private String tag;
    private Date generationDate;
    private Date redeemStartDate;
    private Date redeemEndDate;
    private Long usageLimit;

    /** Smallest basket this coupon may be used on. Null = no minimum. */
    private Integer minItems;
    private Timestamp createdAt;
    private Timestamp updatedAt;
    private boolean canBeAdded;
    private String shortUrl;
    private String shortReferralLink;
}
