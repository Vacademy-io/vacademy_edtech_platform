package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.fee_management.entity.InstituteFeeTypePriority;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.enums.AllocationScope;
import vacademy.io.admin_core_service.features.fee_management.repository.InstituteFeeTypePriorityRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Reusable engine that sorts unpaid bills by overdue-first + institute fee-type
 * priority and allocates a given amount across them.
 * <p>
 * This class is intentionally stateless w.r.t. PaymentLog creation so that any
 * caller (admin/offline, automatic, online gateway callback) can create the
 * PaymentLog in its own way and then delegate the allocation here.
 */
@Service
@Slf4j
public class FeeAllocationEngine {

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @Autowired
    private StudentFeeAllocationLedgerRepository studentFeeAllocationLedgerRepository;

    @Autowired
    private InstituteFeeTypePriorityRepository priorityRepository;

    @Autowired
    private AdjustmentResolver adjustmentResolver;

    /**
     * Core allocation entry point.
     *
     * @param unpaidBills   all unpaid/partial bills for the user (unordered is fine)
     * @param amount        the total amount to allocate (must be &gt; 0)
     * @param paymentLogId  the PaymentLog row to reference in ledger entries
     * @param instituteId   institute whose priority config to use (nullable – falls back to FIFO)
     * @param scope         OVERDUE_ONLY or ALL_DUES
     * @return the remaining unallocated amount (0 when fully used, &gt;0 for excess)
     */
    public BigDecimal allocate(List<StudentFeePayment> unpaidBills,
                               BigDecimal amount,
                               String paymentLogId,
                               String instituteId,
                               AllocationScope scope) {

        if (unpaidBills == null || unpaidBills.isEmpty()) {
            log.info("No unpaid bills to allocate for paymentLog {}", paymentLogId);
            return amount;
        }

        Map<String, Integer> priorityMap = loadPriorityMap(instituteId, scope);
        boolean hasPriorityConfig = !priorityMap.isEmpty();

        List<BillWithDue> enriched = enrichBills(unpaidBills);

        List<BillWithDue> candidates;
        if (scope == AllocationScope.OVERDUE_ONLY) {
            candidates = enriched.stream()
                    .filter(b -> b.overdue)
                    .collect(Collectors.toList());
        } else if (scope == AllocationScope.UPCOMING_ONLY) {
            candidates = enriched.stream()
                    .filter(b -> !b.overdue)
                    .collect(Collectors.toList());
        } else {
            candidates = new ArrayList<>(enriched);
        }

        // Remove bills with nothing left to pay, and written-off ones
        candidates.removeIf(b -> b.amountDue.compareTo(BigDecimal.ZERO) <= 0
                || "WAIVED".equalsIgnoreCase(b.bill.getStatus())
                || "CANCELLED".equalsIgnoreCase(b.bill.getStatus())
                || "DELETED".equalsIgnoreCase(b.bill.getStatus()));

        if (candidates.isEmpty()) {
            log.info("No qualifying bills for scope {} and paymentLog {}", scope, paymentLogId);
            return amount;
        }

        List<BillWithDue> ordered = buildAllocationOrder(candidates, priorityMap, hasPriorityConfig, scope);

        BigDecimal remaining = amount;

        for (BillWithDue entry : ordered) {
            if (remaining.compareTo(BigDecimal.ZERO) <= 0) break;

            StudentFeePayment bill = entry.bill;

            // Recompute amountDue inside loop for safety against stale data
            BigDecimal currentDue = computeAmountDue(bill);
            if (currentDue.compareTo(BigDecimal.ZERO) <= 0) continue;

            BigDecimal allocated = remaining.min(currentDue);
            bill.setAmountPaid(bill.getAmountPaid().add(allocated));

            BigDecimal newDue = computeAmountDue(bill);
            bill.setStatus(newDue.compareTo(BigDecimal.ZERO) <= 0 ? "PAID" : "PARTIAL_PAID");

            remaining = remaining.subtract(allocated);
            studentFeePaymentRepository.save(bill);

            StudentFeeAllocationLedger ledger = new StudentFeeAllocationLedger();
            ledger.setUserId(bill.getUserId());
            ledger.setPaymentLogId(paymentLogId);
            ledger.setStudentFeePaymentId(bill.getId());
            ledger.setAmountAllocated(allocated);
            ledger.setAllocationType("PAYMENT");
            ledger.setRemarks(buildRemark(scope, hasPriorityConfig));
            studentFeeAllocationLedgerRepository.save(ledger);

            log.info("Allocated {} to Bill {} (feeType={}), status={}", allocated, bill.getId(),
                    bill.getFeeTypeId(), bill.getStatus());
        }

        return remaining;
    }

    // ------------------------------------------------------------------
    // Sorting
    // ------------------------------------------------------------------

    private List<BillWithDue> buildAllocationOrder(List<BillWithDue> candidates,
                                                    Map<String, Integer> priorityMap,
                                                    boolean hasPriorityConfig,
                                                    AllocationScope scope) {
        if (scope == AllocationScope.ALL_DUES) {
            List<BillWithDue> overdue = candidates.stream().filter(b -> b.overdue).collect(Collectors.toList());
            List<BillWithDue> upcoming = candidates.stream().filter(b -> !b.overdue).collect(Collectors.toList());

            sortPartition(overdue, priorityMap, hasPriorityConfig);
            sortPartition(upcoming, priorityMap, hasPriorityConfig);

            return Stream.concat(overdue.stream(), upcoming.stream()).collect(Collectors.toList());
        }

        // OVERDUE_ONLY or UPCOMING_ONLY – candidates are already filtered
        sortPartition(candidates, priorityMap, hasPriorityConfig);
        return candidates;
    }

    private void sortPartition(List<BillWithDue> list,
                               Map<String, Integer> priorityMap,
                               boolean hasPriorityConfig) {
        Comparator<BillWithDue> cmp;

        if (hasPriorityConfig) {
            // Priority order first, then due-date ASC, installment order on the same day, then id
            cmp = Comparator
                    .comparingInt((BillWithDue b) -> priorityMap.getOrDefault(b.bill.getFeeTypeId(), Integer.MAX_VALUE))
                    .thenComparing(b -> b.bill.getDueDate() != null ? b.bill.getDueDate().getTime() : Long.MAX_VALUE)
                    .thenComparing(FeeAllocationEngine::installmentOrder)
                    .thenComparing(b -> b.bill.getId());
        } else {
            // Fallback: due-date ASC; same date → installment 1 before 2 (a payment meant for
            // the first installment must not land on a bigger one due the same day), then
            // higher amountDue, then id
            cmp = Comparator
                    .comparing((BillWithDue b) -> b.bill.getDueDate() != null ? b.bill.getDueDate().getTime() : Long.MAX_VALUE)
                    .thenComparing(FeeAllocationEngine::installmentOrder)
                    .thenComparing((BillWithDue b) -> b.amountDue, Comparator.reverseOrder())
                    .thenComparing(b -> b.bill.getId());
        }

        list.sort(cmp);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Map<String, Integer> loadPriorityMap(String instituteId, AllocationScope scope) {
        if (instituteId == null || instituteId.isBlank()) return Collections.emptyMap();

        List<InstituteFeeTypePriority> rows =
                priorityRepository.findByInstituteIdAndScopeOrderByPriorityOrderAsc(instituteId, scope.name());

        if (rows == null || rows.isEmpty()) return Collections.emptyMap();

        Map<String, Integer> map = new HashMap<>();
        for (InstituteFeeTypePriority row : rows) {
            map.put(row.getFeeTypeId(), row.getPriorityOrder());
        }
        return map;
    }

    private List<BillWithDue> enrichBills(List<StudentFeePayment> bills) {
        LocalDate today = LocalDate.now(ZoneId.systemDefault());
        return bills.stream().map(bill -> {
            BigDecimal amountDue = computeAmountDue(bill);
            boolean overdue = false;
            if (bill.getDueDate() != null && amountDue.compareTo(BigDecimal.ZERO) > 0) {
                LocalDate due = bill.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                overdue = due.isBefore(today);
            }
            return new BillWithDue(bill, amountDue, overdue);
        }).collect(Collectors.toList());
    }

    private BigDecimal computeAmountDue(StudentFeePayment bill) {
        BigDecimal expected = bill.getAmountExpected() != null ? bill.getAmountExpected() : BigDecimal.ZERO;
        BigDecimal paid = bill.getAmountPaid() != null ? bill.getAmountPaid() : BigDecimal.ZERO;
        BigDecimal adjustment = adjustmentResolver.computeAdjustmentEffect(bill);
        return expected.add(adjustment).subtract(paid);
    }

    private String buildRemark(AllocationScope scope, boolean hasPriorityConfig) {
        String strategy = hasPriorityConfig ? "priority-based" : "FIFO(date-asc, high-amount-first)";
        return "Auto-allocated [" + scope.name() + ", " + strategy + "]";
    }

    /**
     * Internal wrapper that pairs a bill with its computed amountDue and overdue flag,
     * avoiding repeated computation during sorting.
     */
    private record BillWithDue(StudentFeePayment bill, BigDecimal amountDue, boolean overdue) {
    }

    /** Installment number, bills without one last. */
    private static int installmentOrder(BillWithDue b) {
        Integer n = b.bill.getInstallmentNumber();
        return n != null ? n : Integer.MAX_VALUE;
    }
}
