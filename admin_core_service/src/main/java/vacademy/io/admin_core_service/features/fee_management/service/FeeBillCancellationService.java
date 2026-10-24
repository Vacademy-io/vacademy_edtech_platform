package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeBillCancellation;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeBillCancellationRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

/**
 * When a learner's course is removed (the plan is TERMINATED), the installments still owed on it
 * stop being owed. They used to stay PENDING, so the payment history kept listing them as due
 * and the Fee Plan block kept the whole balance outstanding (I2CAN, 2026-10-21).
 *
 * <p>Each open bill becomes {@link #CANCELLED} with {@code amount_expected} cut to what was
 * actually paid on it, so money already received stays on record and nothing is left to collect.
 * The ledger gets the matching reversal (under {@link #LEDGER_SOURCE_TYPE}) bringing the bill's
 * ledger total down to that amount. It only ever reverses: a bill whose ledger rows are missing
 * or short (plans from before the ledger existed) gets nothing, rather than a new charge for
 * money that was in fact paid. Paid, waived and
 * already-cancelled bills are left alone. A soft cancel (access until the plan ends) does not
 * call this: the learner still owes for the time they keep.
 *
 * <p>An admin can also stop chosen installments while the learner stays enrolled (Stop dues — a
 * learner who dropped out or stopped paying). Those are cancelled the same way, and each one is
 * recorded in {@link FeeBillCancellation} so it can be reopened: amount, status and ledger back
 * to what they were.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FeeBillCancellationService {

    public static final String CANCELLED = "CANCELLED";
    public static final String LEDGER_SOURCE_TYPE = "PLAN_CANCELLED";
    public static final String REOPEN_LEDGER_SOURCE_TYPE = "PLAN_REOPENED";
    private static final Set<String> SETTLED = Set.of("PAID", "WAIVED", CANCELLED, "DELETED");

    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final UserAccountLedgerService userAccountLedgerService;
    private final UserAccountLedgerRepository userAccountLedgerRepository;
    private final FeeBillCancellationRepository feeBillCancellationRepository;

    /** @return how many bills were cancelled */
    @Transactional
    public int cancelOpenBills(String userPlanId, String reason) {
        List<StudentFeePayment> bills = studentFeePaymentRepository.findByUserPlanId(userPlanId);
        String remark = reason != null ? reason : "Course removed: installment cancelled";
        int cancelled = 0;
        for (StudentFeePayment bill : bills) {
            if (!isOpen(bill)) continue;
            cancel(bill, remark);
            cancelled++;
        }
        if (cancelled > 0) {
            log.info("Cancelled {} open fee bill(s) of user plan {}", cancelled, userPlanId);
        }
        return cancelled;
    }

    /** Whether the bill is still owed in some part: not paid, waived, cancelled or deleted. */
    public static boolean isOpen(StudentFeePayment bill) {
        String status = bill.getStatus() == null ? "" : bill.getStatus().toUpperCase();
        return !SETTLED.contains(status);
    }

    /**
     * Stops the given installments while the learner stays enrolled: each open one is cancelled
     * as above, and recorded so it can be reopened. Bills already closed are skipped.
     *
     * @return how many bills were cancelled
     */
    @Transactional
    public int stopDues(List<StudentFeePayment> bills, String reason, String adminUserId) {
        String remark = reason != null && !reason.isBlank()
                ? "Dues stopped: " + reason.trim() : "Dues stopped";
        String batchId = java.util.UUID.randomUUID().toString();
        int cancelled = 0;
        for (StudentFeePayment bill : bills) {
            if (!isOpen(bill)) continue;
            FeeBillCancellation record = new FeeBillCancellation();
            record.setBatchId(batchId);
            record.setStudentFeePaymentId(bill.getId());
            record.setUserPlanId(bill.getUserPlanId());
            record.setUserId(bill.getUserId());
            record.setPreviousStatus(bill.getStatus() == null ? "PENDING" : bill.getStatus());
            record.setAmountExpectedBefore(scale(bill.getAmountExpected()));
            record.setAmountPaid(scale(bill.getAmountPaid()));
            record.setReason(reason != null && !reason.isBlank() ? reason.trim() : null);
            record.setCancelledByUserId(adminUserId);
            record.setLedgerReversed(cancel(bill, remark));
            feeBillCancellationRepository.save(record);
            cancelled++;
        }
        log.info("Stopped dues on {} bill(s), by {}", cancelled, adminUserId);
        return cancelled;
    }

    /**
     * Undoes {@link #stopDues} on the given bills: each goes back to the amount and status it had,
    * and what the cancellation took off the ledger is charged again. Bills cancelled any other way
    * (with a course removal) have nothing to reopen and are skipped.
     *
     * @return how many bills were reopened
     */
    @Transactional
    public int reopen(List<StudentFeePayment> bills, String adminUserId) {
        int reopened = 0;
        for (StudentFeePayment bill : bills) {
            if (!CANCELLED.equalsIgnoreCase(bill.getStatus())) continue;
            FeeBillCancellation record = feeBillCancellationRepository
                    .findFirstByStudentFeePaymentIdAndReopenedAtIsNullOrderByCancelledAtDesc(bill.getId())
                    .orElse(null);
            if (record == null) continue;

            BigDecimal paid = scale(bill.getAmountPaid());
            BigDecimal expected = record.getAmountExpectedBefore().max(paid);
            bill.setAmountExpected(expected);
            bill.setStatus(paid.compareTo(expected) >= 0 ? "PAID"
                    : paid.signum() > 0 ? "PARTIAL_PAID"
                    : "PAID".equalsIgnoreCase(record.getPreviousStatus()) ? "PENDING"
                    : record.getPreviousStatus());
            studentFeePaymentRepository.save(bill);

            if (record.getLedgerReversed() != null && record.getLedgerReversed().signum() > 0
                    && bill.getInstituteId() != null && !bill.getInstituteId().isBlank()) {
                userAccountLedgerService.recordDebitAccrual(bill.getUserId(), bill.getInstituteId(),
                        record.getLedgerReversed(), "INR", dueDateOf(bill), REOPEN_LEDGER_SOURCE_TYPE,
                        bill.getId(), null, "Dues reopened");
            }
            record.setReopenedAt(LocalDateTime.now());
            record.setReopenedByUserId(adminUserId);
            feeBillCancellationRepository.save(record);
            reopened++;
        }
        log.info("Reopened {} stopped bill(s), by {}", reopened, adminUserId);
        return reopened;
    }

    /**
     * The installments stopped together with {@code bill} (one Stop dues), still cancelled — the
     * set a Reopen on it puts back. Empty when the bill was not stopped that way.
     */
    public List<StudentFeePayment> stoppedWith(StudentFeePayment bill) {
        FeeBillCancellation record = feeBillCancellationRepository
                .findFirstByStudentFeePaymentIdAndReopenedAtIsNullOrderByCancelledAtDesc(bill.getId())
                .orElse(null);
        if (record == null) return List.of();
        List<String> ids = feeBillCancellationRepository.findByBatchIdAndReopenedAtIsNull(record.getBatchId())
                .stream().map(FeeBillCancellation::getStudentFeePaymentId).distinct().toList();
        return studentFeePaymentRepository.findAllById(ids).stream()
                .filter(b -> CANCELLED.equalsIgnoreCase(b.getStatus())).toList();
    }

    /**
     * Cancels one open bill: amount cut to what was paid, status CANCELLED, and the ledger brought
     * down to match.
     *
     * @return what was reversed on the ledger (zero when its ledger rows are missing or short)
     */
    private BigDecimal cancel(StudentFeePayment bill, String remark) {
        BigDecimal paid = scale(bill.getAmountPaid());
        bill.setAmountExpected(paid);
        bill.setStatus(CANCELLED);
        studentFeePaymentRepository.save(bill);

        if (bill.getInstituteId() == null || bill.getInstituteId().isBlank()) return BigDecimal.ZERO;
        BigDecimal onLedger = scale(userAccountLedgerRepository.debitNetBySourceId(bill.getId()));
        BigDecimal delta = paid.subtract(onLedger);
        if (delta.signum() >= 0) return BigDecimal.ZERO;
        userAccountLedgerService.recordDebitReversal(bill.getUserId(), bill.getInstituteId(),
                delta.negate(), "INR", dueDateOf(bill), LEDGER_SOURCE_TYPE, bill.getId(), null, remark);
        return delta.negate();
    }

    /** java.sql.Date refuses toInstant(); re-wrap the millis (as CpoDiscountService does). */
    private static LocalDate dueDateOf(StudentFeePayment bill) {
        return bill.getDueDate() != null ? new java.sql.Date(bill.getDueDate().getTime()).toLocalDate() : null;
    }

    private static BigDecimal scale(BigDecimal v) {
        return (v == null ? BigDecimal.ZERO : v).setScale(2, RoundingMode.HALF_UP);
    }
}
