package vacademy.io.admin_core_service.features.fee_management.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * An installment an admin stopped (Stop dues): what the bill was before it became CANCELLED, so
 * it can be reopened. Open while {@code reopenedAt} is null.
 */
@Entity
@Table(name = "fee_bill_cancellation")
@Getter
@Setter
@NoArgsConstructor
public class FeeBillCancellation {

    @Id
    @Column(name = "id")
    private String id;

    /** Installments stopped together share it, and are reopened together. */
    @Column(name = "batch_id", nullable = false)
    private String batchId;

    @Column(name = "student_fee_payment_id", nullable = false)
    private String studentFeePaymentId;

    @Column(name = "user_plan_id")
    private String userPlanId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "previous_status", nullable = false)
    private String previousStatus;

    @Column(name = "amount_expected_before", nullable = false)
    private BigDecimal amountExpectedBefore;

    @Column(name = "amount_paid", nullable = false)
    private BigDecimal amountPaid;

    @Column(name = "ledger_reversed", nullable = false)
    private BigDecimal ledgerReversed;

    @Column(name = "reason")
    private String reason;

    @Column(name = "cancelled_by_user_id")
    private String cancelledByUserId;

    @Column(name = "cancelled_at", nullable = false, updatable = false)
    private LocalDateTime cancelledAt;

    @Column(name = "reopened_by_user_id")
    private String reopenedByUserId;

    @Column(name = "reopened_at")
    private LocalDateTime reopenedAt;

    @PrePersist
    void onCreate() {
        if (id == null) id = java.util.UUID.randomUUID().toString();
        if (cancelledAt == null) cancelledAt = LocalDateTime.now();
    }

    /** What the cancellation dropped: the part of the bill that was still owed. */
    public BigDecimal cancelledAmount() {
        BigDecimal before = amountExpectedBefore == null ? BigDecimal.ZERO : amountExpectedBefore;
        BigDecimal paid = amountPaid == null ? BigDecimal.ZERO : amountPaid;
        return before.subtract(paid).max(BigDecimal.ZERO);
    }
}
