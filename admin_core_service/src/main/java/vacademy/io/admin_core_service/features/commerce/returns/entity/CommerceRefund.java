package vacademy.io.admin_core_service.features.commerce.returns.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;

/**
 * Money given back (V710). Inserted under the order row lock; its status moves only by the
 * compare-and-set updates of {@code CommerceRefundRepository} (PENDING to IN_PROGRESS, then
 * PROCESSED or FAILED), so two pods, the webhook and the poll can never move it twice.
 */
@Getter
@Setter
@NoArgsConstructor
@DynamicUpdate
@Entity
@Table(name = "commerce_refund")
public class CommerceRefund extends CommerceCatalogueEntity {

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "return_id", updatable = false, length = 36)
    private String returnId;

    @Column(name = "credit_note_id", updatable = false, length = 36)
    private String creditNoteId;

    @Column(name = "payment_log_id", updatable = false, length = 36)
    private String paymentLogId;

    @Column(name = "pos_session_id", updatable = false, length = 36)
    private String posSessionId;

    @Column(name = "kind", nullable = false, updatable = false, length = 16)
    private String kind;

    @Column(name = "source", nullable = false, updatable = false, length = 24)
    private String source;

    @Column(name = "method", nullable = false, updatable = false, length = 24)
    private String method;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false, length = 8)
    private String currency;

    @Column(name = "gateway_vendor", updatable = false, length = 32)
    private String gatewayVendor;

    @Column(name = "gateway_payment_id", updatable = false, length = 64)
    private String gatewayPaymentId;

    @Column(name = "gateway_refund_id", length = 64)
    private String gatewayRefundId;

    @Column(name = "gateway_status", length = 32)
    private String gatewayStatus;

    /** The payout reference staff typed (UTR, UPI ref), or the bank reference the gateway reports. */
    @Column(name = "reference", length = 100)
    private String reference;

    @Column(name = "applied_order_id", updatable = false, length = 36)
    private String appliedOrderId;

    @Column(name = "paid_on")
    private LocalDate paidOn;

    @Column(name = "reason", length = 500)
    private String reason;

    @Column(name = "failure_code", length = 64)
    private String failureCode;

    @Column(name = "failure_reason", length = 500)
    private String failureReason;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 100)
    private String idempotencyKey;

    @Column(name = "attempt_count", nullable = false)
    private Integer attemptCount = 0;

    @Column(name = "poll_count", nullable = false)
    private Integer pollCount = 0;

    @Column(name = "claimed_at")
    private Date claimedAt;

    @Column(name = "next_poll_at")
    private Date nextPollAt;

    @Column(name = "last_polled_at")
    private Date lastPolledAt;

    @Column(name = "stuck_alerted_at")
    private Date stuckAlertedAt;

    @Column(name = "processed_at")
    private Date processedAt;

    @Column(name = "failed_at")
    private Date failedAt;

    @Column(name = "created_by", updatable = false, length = 36)
    private String createdBy;

    @Column(name = "processed_by", length = 36)
    private String processedBy;

    @Column(name = "money_account_id", length = 36)
    private String moneyAccountId;
}
