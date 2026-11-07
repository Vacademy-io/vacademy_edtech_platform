package vacademy.io.admin_core_service.features.user_subscription.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.user_subscription.dto.AppliedCouponDiscountDTO;

import java.time.LocalDateTime;
import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "applied_coupon_discount")
public class AppliedCouponDiscount {
    @Id
    @UuidGenerator
    private String id;

    @Column(name = "name")
    private String name;

    @Column(name = "discount_type") // percentage, amount, media
    private String discountType;

    @Column(name = "media_ids", columnDefinition = "TEXT") // Mapped to TEXT in DB
    private String mediaIds; // Can be a comma-separated string or JSON string

    @Column(name = "status")
    private String status;

    @Column(name = "validity_in_days")
    private Integer validityInDays;

    @Column(name = "discount_source") // referral, coupon code
    private String discountSource;

    @Column(name = "currency")
    private String currency;

    @Column(name = "max_discount_point")
    private Double maxDiscountPoint;

    @Column(name = "discount_point")
    private Double discountPoint;

    @Column(name = "max_applicable_times")
    private Integer maxApplicableTimes;

    @Column(name = "redeem_start_date")
    private Date redeemStartDate;

    @Column(name = "redeem_end_date")
    private Date redeemEndDate;

    @ManyToOne
    @JoinColumn(name = "coupon_code_id") // Foreign key to CouponCode
    private CouponCode couponCode;

    // ── Admin-granted discounts (V557, discount_source = 'ADMIN') ─────────

    /** Admin who created this discount. */
    @Column(name = "granted_by_user_id")
    private String grantedByUserId;

    @Column(name = "granted_at")
    private Date grantedAt;

    @Column(name = "grant_reason", columnDefinition = "TEXT")
    private String grantReason;

    @Column(name = "institute_id")
    private String instituteId;

    /** Charges this discount reduces: null = every cycle (ADMIN only), 1 = first payment only. */
    @Column(name = "apply_for_cycles")
    private Integer applyForCycles;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;

        public AppliedCouponDiscountDTO mapToDTO() {
            return AppliedCouponDiscountDTO.builder()
                .id(this.id)
                .name(this.name)
                .discountType(this.discountType)
                .mediaIds(this.mediaIds)
                .status(this.status)
                .validityInDays(this.validityInDays)
                .discountSource(this.discountSource)
                .currency(this.currency)
                .maxDiscountPoint(this.maxDiscountPoint)
                .discountPoint(this.discountPoint)
                .maxApplicableTimes(this.maxApplicableTimes)
                .redeemStartDate(this.redeemStartDate)
                .redeemEndDate(this.redeemEndDate)
                .couponCode(this.couponCode != null ? this.couponCode.toDTO() : null) // nested DTO
                .grantedByUserId(this.grantedByUserId)
                .grantedAt(this.grantedAt)
                .grantReason(this.grantReason)
                .instituteId(this.instituteId)
                .applyForCycles(this.applyForCycles)
                .createdAt(this.createdAt)
                .updatedAt(this.updatedAt)
                .build();
        }
}
