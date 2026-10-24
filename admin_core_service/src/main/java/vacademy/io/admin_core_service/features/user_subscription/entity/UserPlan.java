package vacademy.io.admin_core_service.features.user_subscription.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "user_plan")
public class UserPlan {    @Id
@UuidGenerator
private String id;

    /**
     * User ID - ALWAYS required and preserved for data integrity
     * - For source=USER: The individual user who enrolled
     * - For source=SUB_ORG: The individual learner within the sub-organization
     *
     * This field is NEVER null, even for SUB_ORG enrollments.
     * It ensures we can always track which user a plan belongs to.
     */
    @Column(name = "user_id", nullable = false)
    private String userId;

    // Foreign key + lazy mapping for PaymentPlan
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "plan_id", insertable = false, updatable = false)
    private PaymentPlan paymentPlan;

    @Column(name = "plan_id")
    private String paymentPlanId;

    @Column(name = "plan_json", columnDefinition = "TEXT")
    private String planJson;

    @Column(name = "applied_coupon_discount_id")
    private String appliedCouponDiscountId;

    @Column(name = "applied_coupon_discount_json", columnDefinition = "TEXT")
    private String appliedCouponDiscountJson;

    // Assuming you want to map coupon discount entity (optional)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "applied_coupon_discount_id", insertable = false, updatable = false)
    private AppliedCouponDiscount appliedCouponDiscount;

    /**
     * Admin who attached the discount (V557) — set for ad-hoc admin discounts AND for
     * an existing coupon an admin picked, since the coupon's rule row is shared.
     */
    @Column(name = "discount_granted_by_user_id")
    private String discountGrantedByUserId;

    @Column(name = "discount_granted_at")
    private Date discountGrantedAt;

    /** Charges (first payment + renewals) the attached discount has reduced so far. */
    @Column(name = "discount_cycles_applied")
    private Integer discountCyclesApplied = 0;

    @Column(name = "enroll_invite_id")
    private String enrollInviteId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "enroll_invite_id", insertable = false, updatable = false)
    private EnrollInvite enrollInvite;

    @Column(name = "payment_option_id")
    private String paymentOptionId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "payment_option_id", insertable = false, updatable = false)
    private PaymentOption paymentOption;

    @Column(name = "payment_option_json", columnDefinition = "TEXT")
    private String paymentOptionJson;

    @Column(name = "status")
    private String status;    @Column(name = "json_payment_details", columnDefinition = "TEXT")
    private String jsonPaymentDetails;

    /**
     * Source of the UserPlan enrollment
     * - USER: Individual user enrollment (direct purchase)
     * - SUB_ORG: Sub-organization enrollment (organization manages the plan)
     */
    @Column(name = "source", length = 50)
    private String source;

    /**
     * Sub-organization ID
     * - Only populated when source=SUB_ORG
     * - Represents the sub-organization that manages this plan
     * - Used in conjunction with userId to track individual learners within organizations
     */
    @Column(name = "sub_org_id", length = 255)
    private String subOrgId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "userPlan", cascade = CascadeType.ALL, fetch = FetchType.LAZY)
    private List<PaymentLog> paymentLogs;

    @Column(name = "start_date")
    private Date startDate;

    @Column(name = "end_date")
    private Date endDate;

    // ── Autopay / recurring-mandate (V369) ────────────────────────────────
    // The mandate itself (token id, max_amount, status) lives in
    // user_institute_payment_gateway_mapping.payment_gateway_customer_data
    // JSON, keyed by this plan's id. These columns only drive the scheduler.

    /**
     * Only plans with this true are picked up by the auto-charge scheduler.
     * Initialised to false so the NOT NULL column is never sent an explicit NULL
     * on insert (Hibernate includes mapped columns even when the DB has a default).
     */
    @Column(name = "auto_renewal_enabled")
    private Boolean autoRenewalEnabled = false;

    /** Next date the scheduler should attempt a renewal charge (usually = endDate). */
    @Column(name = "next_charge_at")
    private Date nextChargeAt;

    /** True while in the free-trial window (access granted, no real charge yet). */
    @Column(name = "is_trial")
    private Boolean isTrial = false;

    /** Dunning: number of renewal charge attempts in the current cycle. */
    @Column(name = "renewal_attempt_count")
    private Integer renewalAttemptCount = 0;

    @Column(name = "last_renewal_attempt_at")
    private Date lastRenewalAttemptAt;

    /**
     * Regional price lock (V585). Set when the learner checked out under regional pricing:
     * the list price and currency they bought at, and the country it was resolved for.
     * Renewals, invoices and the ledger read these instead of the plan's base price so a
     * USD buyer keeps paying USD. Null = base price, as before.
     */
    @Column(name = "regional_price")
    private java.math.BigDecimal regionalPrice;

    @Column(name = "regional_currency", length = 3)
    private String regionalCurrency;

    @Column(name = "regional_country", length = 2)
    private String regionalCountry;
}
