package vacademy.io.admin_core_service.features.platform_billing.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;

import java.time.Instant;
import java.time.LocalDateTime;

/**
 * One row per Razorpay order placed against the platform's account
 * (institute -> Vacademy direction). Distinct from {@code payment_log} which
 * records institute -> learner payments.
 *
 * <p>V590 adds the order-time snapshot the invoice and credit note are built from
 * (buyer identity, place of supply, tax head, brand mode; the amounts snapshot is
 * {@link #baseAmountMinor} / {@link #taxAmountMinor} / {@link #totalAmountMinor}),
 * plus {@link #disposition}, {@link #refundRequestedAt}, {@link #refundedAmountMinor}
 * and {@link #linkExpiresAt}. The NOT NULL ones are initialised here so existing
 * code that never sets them keeps inserting valid rows.
 */
@Entity
@Table(name = "platform_payment")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PlatformPayment {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "institute_id", nullable = false, length = 255)
    private String instituteId;

    @Column(name = "buyer_user_id", length = 255)
    private String buyerUserId;

    @Column(name = "vendor", nullable = false, length = 32)
    private String vendor;

    @Column(name = "vendor_order_id", unique = true, length = 64)
    private String vendorOrderId;

    @Column(name = "vendor_payment_id", length = 64)
    private String vendorPaymentId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "base_amount_minor", nullable = false)
    private Long baseAmountMinor;

    @Column(name = "tax_amount_minor", nullable = false)
    private Long taxAmountMinor;

    @Column(name = "total_amount_minor", nullable = false)
    private Long totalAmountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private PlatformPaymentStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status", nullable = false, length = 32)
    private PlatformPaymentResult paymentStatus;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payment_specific_data", columnDefinition = "jsonb")
    private String paymentSpecificData;

    // ── V590: buyer + tax snapshot taken at order time (never re-read from institutes) ──
    @Column(name = "buyer_legal_name", length = 255)
    private String buyerLegalName;

    @Column(name = "buyer_gstin", length = 15)
    private String buyerGstin;

    @Column(name = "buyer_state_code", length = 2)
    private String buyerStateCode;

    @Column(name = "buyer_address", columnDefinition = "TEXT")
    private String buyerAddress;

    /** GST place of supply (state code); NULL on rows created before V590. */
    @Column(name = "place_of_supply", length = 2)
    private String placeOfSupply;

    /** {@link vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead} name; NULL before V590. */
    @Column(name = "tax_head", length = 12)
    private String taxHead;

    /** {@link vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode} name frozen at order time; NULL = legacy. */
    @Column(name = "brand_mode", length = 10)
    private String brandMode;

    /** NORMAL, or DUPLICATE / LATE for a payment that must be refunded and never invoiced. */
    @Enumerated(EnumType.STRING)
    @Column(name = "disposition", nullable = false, length = 12)
    private PlatformPaymentDisposition disposition = PlatformPaymentDisposition.NORMAL;

    /** Set before an automatic refund is requested from Razorpay (refund idempotency guard). */
    @Column(name = "refund_requested_at")
    private Instant refundRequestedAt;

    /** Sum of all processed refunds on this payment (cumulative, F10). */
    @Column(name = "refunded_amount_minor", nullable = false)
    private Long refundedAmountMinor = 0L;

    /** Payment Link {@code expire_by}, when this payment was raised through a link (F7). */
    @Column(name = "link_expires_at")
    private Instant linkExpiresAt;

    /**
     * When the row became PAID (V590; {@code updated_at} is never written after INSERT). Set once
     * by the webhook's fulfil step; the invoice reconcile measures its grace from here.
     */
    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}
