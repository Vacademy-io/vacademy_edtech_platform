package vacademy.io.admin_core_service.features.fee_management.entity;

import jakarta.persistence.*;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Date;

@AllArgsConstructor
@NoArgsConstructor
@Getter
@Setter
@Entity
@Table(name = "student_fee_payment")
public class StudentFeePayment {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "user_plan_id", nullable = false)
    private String userPlanId;

    @Column(name = "package_session_ids")
    private String packageSessionIds;

    @Column(name = "cpo_id", nullable = false)
    private String cpoId;

    // Read-only join used by admin fee roster Specification for institute filtering
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cpo_id", insertable = false, updatable = false)
    private ComplexPaymentOption complexPaymentOption;

    @Column(name = "asv_id", nullable = false)
    private String asvId;

    // Nullable since V452: a one-off fee type (has_installment = false) has no
    // AftInstallment to point at. Hibernate enforces nullable = false itself and
    // rejects the insert before it reaches the database, so dropping the DB
    // constraint alone was not enough. asv_id still links the row to its fee value.
    @Column(name = "i_id")
    private String iId;

    /**
     * Position in the learner's schedule. Set on bills generated from an installment
     * schedule (V575), which have no aft_installments row to take a number from.
     * Null on template-generated bills; readers fall back to the template's number.
     */
    @Column(name = "installment_number")
    private Integer installmentNumber;

    @Column(name = "amount_expected", nullable = false)
    private BigDecimal amountExpected;

    /**
     * Template face value snapshotted at SFP generation. Never mutated after.
     * amount_expected reflects the *net* (post-discount, post-edit) value FIFO
     * targets; original_amount is the "before" figure the side-view shows.
     */
    @Column(name = "original_amount")
    private BigDecimal originalAmount;

    @Column(name = "current_adjustment_history_id")
    private String currentAdjustmentHistoryId;

    @Column(name = "amount_paid")
    private BigDecimal amountPaid = BigDecimal.ZERO;

    @Column(name = "start_date")
    private Date startDate;

    @Column(name = "due_date")
    private Date dueDate;

    @Column(name = "status", nullable = false)
    private String status; // e.g., PENDING, PARTIAL_PAID, PAID, WAIVED, OVERDUE

    @Column(name = "is_skippable")
    private Boolean isSkippable = false;

    @Column(name = "fee_type_id")
    private String feeTypeId;

    /**
     * The institute this fee payment belongs to.
     * Nullable for backward compatibility with existing rows.
     * Populated at enrollment time so the fee reminder workflow
     * can resolve the correct workflow_trigger by institute_id.
     */
    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
        if (updatedAt == null) {
            updatedAt = LocalDateTime.now();
        }
        if (amountPaid == null) {
            amountPaid = BigDecimal.ZERO;
        }
        if (originalAmount == null) {
            originalAmount = amountExpected;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        if (updatedAt == null) {
            updatedAt = LocalDateTime.now();
        }
    }
}
