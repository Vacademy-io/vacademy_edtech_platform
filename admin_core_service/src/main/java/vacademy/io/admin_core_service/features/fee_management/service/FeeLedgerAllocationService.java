package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import vacademy.io.admin_core_service.features.fee_management.enums.AllocationScope;

import java.math.BigDecimal;
import java.util.Date;
import java.util.List;
import java.util.stream.Collectors;

@Service
@Slf4j
public class FeeLedgerAllocationService {

    @Autowired
    private vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService offlinePaymentDetailsService;

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private StudentFeeAllocationLedgerRepository studentFeeAllocationLedgerRepository;

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private FeeAllocationEngine feeAllocationEngine;

    @Autowired
    @Lazy
    private SchoolFeeReceiptService schoolFeeReceiptService;

    @Autowired
    private AdjustmentResolver adjustmentResolver;

    private BigDecimal computeAmountDue(StudentFeePayment bill) {
        BigDecimal expected = bill.getAmountExpected() != null ? bill.getAmountExpected() : BigDecimal.ZERO;
        BigDecimal paid = bill.getAmountPaid() != null ? bill.getAmountPaid() : BigDecimal.ZERO;
        BigDecimal adjustment = adjustmentResolver.computeAdjustmentEffect(bill);
        return expected.add(adjustment).subtract(paid);
    }

    /**
     * Treat a bill as "settled via adjustment" when:
     * - an approved concession exists
     * - and remaining due <= 0
     */
    private boolean isAdjustmentSettled(StudentFeePayment bill) {
        BigDecimal concession = adjustmentResolver.computeConcession(bill);
        if (concession.compareTo(BigDecimal.ZERO) <= 0) return false;
        return computeAmountDue(bill).compareTo(BigDecimal.ZERO) <= 0;
    }

    /**
     * Whether oldest-first allocation may put money on this bill: something is still owed on it
     * and it has not been written off. Without this a waived installment was paid (and turned
     * PAID), an installment a discount took to zero was stamped PAID by a ₹0 allocation, and one
     * already paid beyond its amount got a negative allocation that took money off it and moved
     * it to the next installment.
     */
    static boolean takesPayment(StudentFeePayment bill) {
        String status = bill.getStatus();
        if ("PAID".equalsIgnoreCase(status) || "WAIVED".equalsIgnoreCase(status)
                || "CANCELLED".equalsIgnoreCase(status) || "DELETED".equalsIgnoreCase(status)) {
            return false;
        }
        BigDecimal expected = bill.getAmountExpected() != null ? bill.getAmountExpected() : BigDecimal.ZERO;
        BigDecimal paid = bill.getAmountPaid() != null ? bill.getAmountPaid() : BigDecimal.ZERO;
        return expected.compareTo(paid) > 0;
    }

    @Transactional
    public void allocatePayment(String paymentLogId, BigDecimal totalPaymentAmount, String userPlanId) {
        log.info("Starting ledger allocation for PaymentLog: {}, Amount: {}, UserPlan: {}", paymentLogId,
                totalPaymentAmount, userPlanId);

        // Fetch unpaid bills ordered by due date ascending (FIFO)
        List<StudentFeePayment> unpaidBills = studentFeePaymentRepository
                .findByUserPlanIdAndStatusNotOrderByDueDateAsc(userPlanId, "PAID");

        BigDecimal remainingAmount = totalPaymentAmount;

        for (StudentFeePayment bill : unpaidBills) {
            if (remainingAmount.compareTo(BigDecimal.ZERO) <= 0) {
                break; // No more money to allocate
            }
            if (!takesPayment(bill)) {
                continue;
            }

            BigDecimal amountToPayOnThisBill = bill.getAmountExpected().subtract(bill.getAmountPaid());
            BigDecimal allocatedAmount;

            if (remainingAmount.compareTo(amountToPayOnThisBill) >= 0) {
                // We can fully pay this bill
                allocatedAmount = amountToPayOnThisBill;
                bill.setAmountPaid(bill.getAmountExpected());
                bill.setStatus("PAID");
            } else {
                // We can partially pay this bill
                allocatedAmount = remainingAmount;
                bill.setAmountPaid(bill.getAmountPaid().add(allocatedAmount));
                bill.setStatus("PARTIAL_PAID");
            }

            remainingAmount = remainingAmount.subtract(allocatedAmount);
            studentFeePaymentRepository.save(bill);

            // Record this allocation in the Ledger
            StudentFeeAllocationLedger ledger = new StudentFeeAllocationLedger();
            ledger.setUserId(bill.getUserId());
            ledger.setPaymentLogId(paymentLogId);
            ledger.setStudentFeePaymentId(bill.getId());
            ledger.setAmountAllocated(allocatedAmount);
            ledger.setAllocationType("PAYMENT");
            ledger.setRemarks("Auto-allocated via FIFO");
            studentFeeAllocationLedgerRepository.save(ledger);

            log.info("Allocated {} to Bill {}, New Status: {}", allocatedAmount, bill.getId(), bill.getStatus());
        }

        if (remainingAmount.compareTo(BigDecimal.ZERO) > 0) {
            log.warn("Payment Log {} had excess amount {} after paying all bills for UserPlan {}", paymentLogId,
                    remainingAmount, userPlanId);
            final BigDecimal excessAmount = remainingAmount;
            paymentLogRepository.findById(paymentLogId).ifPresent(pl -> {
                pl.setUnallocatedAmount(excessAmount.doubleValue());
                paymentLogRepository.save(pl);
            });
        }
    }

    /**
     * Offline/admin flow using the existing controller endpoint:
     * - Fetches an existing PaymentLog by ID (template/source record)
     * - Creates a NEW PaymentLog row representing this concrete payment with status
     * PAID
     * - Allocates that new payment across unpaid installments
     * - Writes separate ledger rows per student_fee_payment_id pointing to the NEW
     * PaymentLog
     *
     * The original {@link #allocatePayment(String, BigDecimal, String)} method is
     * left
     * unchanged; this method no longer calls it.
     */
    @Transactional
    public void allocatePaymentForLog(String paymentLogId) {
        PaymentLog sourceLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new IllegalArgumentException("PaymentLog not found for id: " + paymentLogId));

        if (sourceLog.getUserPlan() == null) {
            throw new IllegalStateException("PaymentLog has no associated user plan for id: " + paymentLogId);
        }

        Double rawAmount = sourceLog.getPaymentAmount();
        if (rawAmount == null || rawAmount <= 0) {
            throw new IllegalStateException("Payment amount must be positive for PaymentLog id: " + paymentLogId);
        }

        BigDecimal totalPaymentAmount = BigDecimal.valueOf(rawAmount);

        // Create a fresh PaymentLog row representing this concrete payment event
        PaymentLog actualPaymentLog = new PaymentLog();
        actualPaymentLog.setStatus("ACTIVE");
        actualPaymentLog.setPaymentStatus("PAID");
        actualPaymentLog.setUserId(sourceLog.getUserId());
        actualPaymentLog.setVendor(sourceLog.getVendor());
        actualPaymentLog.setVendorId(sourceLog.getVendorId());
        actualPaymentLog.setDate(new Date());
        actualPaymentLog.setCurrency(sourceLog.getCurrency());
        actualPaymentLog.setUserPlan(sourceLog.getUserPlan());
        actualPaymentLog.setPaymentAmount(rawAmount);
        actualPaymentLog.setPaymentSpecificData(sourceLog.getPaymentSpecificData());

        actualPaymentLog = paymentLogRepository.save(actualPaymentLog);

        // Allocate this new payment across unpaid installments; all ledger rows will
        // reference ONLY the new PaymentLog's ID.
        allocatePaymentForNewLog(actualPaymentLog.getId(), totalPaymentAmount, sourceLog.getUserPlan().getId());
    }

    /**
     * Internal helper for the new flow. Duplicates the allocation logic so that
     * the existing allocatePayment(...) method remains untouched.
     */
    @Transactional
    public void allocatePaymentForNewLog(String paymentLogId, BigDecimal totalPaymentAmount, String userPlanId) {
        log.info("[NEW FLOW] Starting ledger allocation for PaymentLog: {}, Amount: {}, UserPlan: {}", paymentLogId,
                totalPaymentAmount, userPlanId);

        List<StudentFeePayment> unpaidBills = studentFeePaymentRepository
                .findByUserPlanIdAndStatusNotOrderByDueDateAsc(userPlanId, "PAID");

        BigDecimal remainingAmount = totalPaymentAmount;

        for (StudentFeePayment bill : unpaidBills) {
            if (remainingAmount.compareTo(BigDecimal.ZERO) <= 0) {
                break;
            }
            if (!takesPayment(bill)) {
                continue;
            }

            BigDecimal amountToPayOnThisBill = bill.getAmountExpected().subtract(bill.getAmountPaid());
            BigDecimal allocatedAmount;

            if (remainingAmount.compareTo(amountToPayOnThisBill) >= 0) {
                allocatedAmount = amountToPayOnThisBill;
                bill.setAmountPaid(bill.getAmountExpected());
                bill.setStatus("PAID");
            } else {
                allocatedAmount = remainingAmount;
                bill.setAmountPaid(bill.getAmountPaid().add(allocatedAmount));
                bill.setStatus("PARTIAL_PAID");
            }

            remainingAmount = remainingAmount.subtract(allocatedAmount);
            studentFeePaymentRepository.save(bill);

            StudentFeeAllocationLedger ledger = new StudentFeeAllocationLedger();
            ledger.setUserId(bill.getUserId());
            ledger.setPaymentLogId(paymentLogId);
            ledger.setStudentFeePaymentId(bill.getId());
            ledger.setAmountAllocated(allocatedAmount);
            ledger.setAllocationType("PAYMENT");
            ledger.setRemarks("[NEW FLOW] Auto-allocated via FIFO");
            studentFeeAllocationLedgerRepository.save(ledger);

            log.info("[NEW FLOW] Allocated {} to Bill {}, New Status: {}", allocatedAmount, bill.getId(),
                    bill.getStatus());
        }

        if (remainingAmount.compareTo(BigDecimal.ZERO) > 0) {
            log.warn("[NEW FLOW] Payment Log {} had excess amount {} after paying all bills for UserPlan {}",
                    paymentLogId, remainingAmount, userPlanId);
            final BigDecimal excessAmount = remainingAmount;
            paymentLogRepository.findById(paymentLogId).ifPresent(pl -> {
                pl.setUnallocatedAmount(excessAmount.doubleValue());
                paymentLogRepository.save(pl);
            });
        }
    }

    @Transactional
    public String allocatePaymentForSelectedInstallments(String userId, String instituteId,
            List<String> studentFeePaymentIds,
            BigDecimal amount, String remarks) {
        return allocatePaymentForSelectedInstallments(userId, instituteId, studentFeePaymentIds, amount, remarks,
                null, null);
    }

    /**
     * Records an offline payment against the chosen installments (admin "Pay installments").
     * {@code paymentDetails} says how it was paid (mode, sub-option, reference), validated
     * against the institute's offline payment modes before anything is written.
     */
    @Transactional
    public String allocatePaymentForSelectedInstallments(String userId, String instituteId,
            List<String> studentFeePaymentIds,
            BigDecimal amount, String remarks,
            vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails,
            String recordedByUserId) {
        if (studentFeePaymentIds == null || studentFeePaymentIds.isEmpty()) {
            throw new IllegalArgumentException("At least one installment must be selected");
        }
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Payment amount must be positive");
        }

        // Fetch selected bills
        List<StudentFeePayment> selectedBills = studentFeePaymentRepository.findAllById(studentFeePaymentIds);

        if (selectedBills.size() != studentFeePaymentIds.size()) {
            List<String> foundIds = selectedBills.stream().map(StudentFeePayment::getId).collect(Collectors.toList());
            List<String> missing = studentFeePaymentIds.stream()
                    .filter(id -> !foundIds.contains(id)).collect(Collectors.toList());
            throw new IllegalArgumentException("Installments not found: " + missing);
        }

        // Validate all belong to user and are not fully paid
        for (StudentFeePayment bill : selectedBills) {
            if (!bill.getUserId().equals(userId)) {
                throw new IllegalArgumentException("Installment " + bill.getId()
                        + " does not belong to user " + userId);
            }
            if ("PAID".equals(bill.getStatus())) {
                throw new IllegalArgumentException("Installment " + bill.getId() + " is already fully paid");
            }
        }

        vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService.Resolved details =
                offlinePaymentDetailsService.resolve(instituteId, paymentDetails, null);
        // First payment of an enrolment: pin the numbering-series field picked in the dialog.
        for (String planId : selectedBills.stream().map(StudentFeePayment::getUserPlanId)
                .filter(id -> id != null && !id.isBlank()).distinct().toList()) {
            offlinePaymentDetailsService.pinNumberingValue(instituteId, planId, userId, paymentDetails);
        }

        // Create PaymentLog
        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setStatus("ACTIVE");
        paymentLog.setPaymentStatus("PAID");
        paymentLog.setUserId(userId);
        paymentLog.setVendor("OFFLINE");
        paymentLog.setDate(details != null && details.paymentDate() != null
                ? java.sql.Date.valueOf(details.paymentDate()) : new Date());
        paymentLog.setCurrency("INR");
        paymentLog.setPaymentAmount(amount.doubleValue());
        paymentLog = paymentLogRepository.save(paymentLog);
        offlinePaymentDetailsService.apply(paymentLog.getId(), details, recordedByUserId);

        // Use FeeAllocationEngine to distribute across ONLY selected bills using
        // priority
        BigDecimal remaining = feeAllocationEngine.allocate(
                selectedBills, amount, paymentLog.getId(), instituteId, AllocationScope.ALL_DUES);

        if (remaining.compareTo(BigDecimal.ZERO) > 0) {
            paymentLog.setUnallocatedAmount(remaining.doubleValue());
            paymentLogRepository.save(paymentLog);
            log.warn("Payment {} had excess amount {} after allocating to selected installments for user {}",
                    paymentLog.getId(), remaining, userId);
        }

        // Update ledger entries with admin remarks
        List<StudentFeeAllocationLedger> ledgerEntries = studentFeeAllocationLedgerRepository
                .findByPaymentLogId(paymentLog.getId());
        if (remarks != null && !remarks.isBlank()) {
            for (StudentFeeAllocationLedger entry : ledgerEntries) {
                entry.setRemarks(remarks);
            }
            studentFeeAllocationLedgerRepository.saveAll(ledgerEntries);
        }

        // Generate receipt
        BigDecimal allocatedAmount = amount.subtract(remaining);
        List<String> paidInstallmentIds = ledgerEntries.stream()
                .map(StudentFeeAllocationLedger::getStudentFeePaymentId)
                .distinct()
                .collect(Collectors.toList());

        // Include installments that are "settled via discount" even if allocation
        // created no ledger rows for them.
        for (StudentFeePayment bill : selectedBills) {
            if (isAdjustmentSettled(bill) && !"PAID".equalsIgnoreCase(bill.getStatus())) {
                bill.setStatus("PAID");
                studentFeePaymentRepository.save(bill);
                if (!paidInstallmentIds.contains(bill.getId())) {
                    paidInstallmentIds.add(bill.getId());
                }
            }
        }

        if (!paidInstallmentIds.isEmpty()) {
            return schoolFeeReceiptService.generateAndSendReceipt(
                    userId,
                    paymentLog.getId(),
                    instituteId,
                    allocatedAmount,
                    details != null && details.reference() != null ? details.reference() : paymentLog.getId(),
                    details != null && details.describe() != null ? details.describe() : "Cash",
                    paidInstallmentIds);
        }
        return null;
    }

    /**
     * Backward-compatible wrapper that defaults to ALL_DUES with no institute
     * priority.
     */
    @Transactional
    public void allocatePaymentForUser(String userId, BigDecimal amount) {
        allocatePaymentForUser(userId, amount, null, AllocationScope.ALL_DUES);
    }

    /**
     * Entry point for the user-based offline/admin API with priority support.
     * <p>
     * Multi-pass allocation strategy:
     * <ul>
     * <li>OVERDUE_ONLY → 1st pass: overdue with priority, 2nd pass: ALL_DUES
     * (fallback) on remaining</li>
     * <li>UPCOMING_ONLY → 1st pass: upcoming with priority, 2nd pass: ALL_DUES
     * (fallback) on remaining</li>
     * <li>ALL_DUES → single pass: overdue-first + upcoming, using priority if
     * configured</li>
     * </ul>
     * The final ALL_DUES pass ensures no money is left unallocated when there are
     * still unpaid bills, even if the institute only configured priority for one
     * scope.
     *
     * @param userId      the student whose installments are to be updated
     * @param amount      payment amount (must be &gt; 0)
     * @param instituteId institute whose fee-type priority config to apply
     *                    (nullable → fallback)
     * @param scope       OVERDUE_ONLY, UPCOMING_ONLY, or ALL_DUES
     */
    @Transactional
    public void allocatePaymentForUser(String userId, BigDecimal amount,
            String instituteId, AllocationScope scope) {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Payment amount must be positive");
        }
        if (scope == null) {
            scope = AllocationScope.ALL_DUES;
        }

        List<StudentFeePayment> unpaidBills = studentFeePaymentRepository
                .findByUserIdAndStatusNot(userId, "PAID");

        if (unpaidBills.isEmpty()) {
            log.info("No unpaid bills found for user {}", userId);
            return;
        }

        if (instituteId == null || instituteId.isBlank()) {
            instituteId = unpaidBills.stream()
                    .map(StudentFeePayment::getIId)
                    .filter(id -> id != null && !id.isBlank())
                    .findFirst()
                    .orElse(null);
        }

        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setStatus("ACTIVE");
        paymentLog.setPaymentStatus("PAID");
        paymentLog.setUserId(userId);
        paymentLog.setVendor("OFFLINE");
        paymentLog.setVendorId(null);
        paymentLog.setDate(new Date());
        paymentLog.setCurrency("INR");
        paymentLog.setUserPlan(null);
        paymentLog.setPaymentAmount(amount.doubleValue());
        paymentLog.setPaymentSpecificData(null);
        paymentLog = paymentLogRepository.save(paymentLog);

        BigDecimal remaining = amount;

        // Pass 1: focused allocation (OVERDUE_ONLY or UPCOMING_ONLY)
        if (scope == AllocationScope.OVERDUE_ONLY || scope == AllocationScope.UPCOMING_ONLY) {
            remaining = feeAllocationEngine.allocate(
                    unpaidBills, remaining, paymentLog.getId(), instituteId, scope);
        }

        // Pass 2 (always runs): ALL_DUES on whatever is left
        // - If scope was ALL_DUES, this is the only pass.
        // - If scope was OVERDUE_ONLY / UPCOMING_ONLY, this catches any leftover
        // amount and applies it to remaining unpaid bills (overdue-first, then
        // upcoming).
        // - Bills already paid in Pass 1 will have amountDue=0 and are skipped
        // automatically.
        if (remaining.compareTo(BigDecimal.ZERO) > 0) {
            remaining = feeAllocationEngine.allocate(
                    unpaidBills, remaining, paymentLog.getId(), instituteId, AllocationScope.ALL_DUES);
        }

        if (remaining.compareTo(BigDecimal.ZERO) > 0) {
            log.warn("Payment Log {} had excess amount {} after allocation for user {}",
                    paymentLog.getId(), remaining, userId);
        }

        // Generate receipt and send email using SchoolFeeReceiptService
        BigDecimal allocatedAmount = amount.subtract(remaining);
        List<StudentFeeAllocationLedger> allocations = studentFeeAllocationLedgerRepository
                .findByPaymentLogId(paymentLog.getId());

        List<String> paidInstallmentIds = allocations.stream()
                .map(StudentFeeAllocationLedger::getStudentFeePaymentId)
                .distinct()
                .collect(Collectors.toList());

        // Include installments that are "settled via discount" even if allocation
        // created no ledger rows for them.
        for (StudentFeePayment bill : unpaidBills) {
            if (isAdjustmentSettled(bill) && !"PAID".equalsIgnoreCase(bill.getStatus())) {
                bill.setStatus("PAID");
                studentFeePaymentRepository.save(bill);
                if (!paidInstallmentIds.contains(bill.getId())) {
                    paidInstallmentIds.add(bill.getId());
                }
            }
        }

        if (!paidInstallmentIds.isEmpty()) {
            schoolFeeReceiptService.generateAndSendReceipt(
                    userId,
                    paymentLog.getId(),
                    instituteId,
                    allocatedAmount,
                    paymentLog.getId(),
                    "Cash",
                    paidInstallmentIds);
        }
    }
}
