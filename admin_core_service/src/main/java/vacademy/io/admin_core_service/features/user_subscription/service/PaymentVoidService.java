package vacademy.io.admin_core_service.features.user_subscription.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentVoidResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Voids a payment an admin recorded by mistake — the "delete payment" institutes ask for.
 *
 * <p>Voiding does not delete the row: the payment has already fanned out into installment
 * allocations, the learner's account ledger, invoices and reports, and a bare row delete would
 * leave every one of those wrong (and is blocked by the allocation ledger's FK anyway). Voiding
 * undoes each effect and keeps the row for the audit trail. (Institutes that switch it on can
 * then remove the row too — see {@link PaymentDeletionService}, which voids first.)
 * <ol>
 *   <li>installments get back the amount this payment had allocated to them;</li>
 *   <li>invoices: a bill the payment settled is reopened, an invoice generated from the payment
 *       is voided (see {@link InvoiceService#unwindInvoicesForVoidedPayment});</li>
 *   <li>the ledger gets a CREDIT_REVERSAL, taking the money back out of "total paid";</li>
 *   <li>the payment log becomes payment_status VOIDED. Every revenue, Collected and cash-in query
 *       counts only {@code payment_status = 'PAID'}, so it drops out of all of them.</li>
 * </ol>
 *
 * <p>Only payments an admin typed in (vendor MANUAL / OFFLINE) can be voided. Money taken by a
 * gateway really moved; that is a refund, done in the gateway. The learner's enrolment status is
 * deliberately left alone — revoking access is a separate decision.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentVoidService {

    public static final String VOIDED = "VOIDED";

    /** Vendors whose payments were entered by an admin rather than captured by a gateway. */
    private static final Set<String> VOIDABLE_VENDORS = Set.of("MANUAL", "OFFLINE");

    private static final ObjectMapper JSON = new ObjectMapper();

    private final PaymentLogRepository paymentLogRepository;
    private final StudentFeeAllocationLedgerRepository allocationRepository;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;
    private final InvoiceService invoiceService;
    private final UserAccountLedgerService userAccountLedgerService;
    private final FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    private final UserAccountLedgerRepository userAccountLedgerRepository;

    @Transactional
    public PaymentVoidResultDTO voidPayment(String paymentLogId, String instituteId,
                                            String reason, String voidedBy) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        assertNotSubOrgAdmin(voidedBy);

        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new VacademyException("Payment not found: " + paymentLogId));

        String vendor = paymentLog.getVendor() != null ? paymentLog.getVendor().trim().toUpperCase() : "";
        if (!VOIDABLE_VENDORS.contains(vendor)) {
            throw new VacademyException("Only offline or manually recorded payments can be voided. "
                    + "An online payment has to be refunded through the payment gateway.");
        }
        if (VOIDED.equalsIgnoreCase(paymentLog.getPaymentStatus())) {
            throw new VacademyException("This payment has already been voided");
        }
        if (!"PAID".equalsIgnoreCase(paymentLog.getPaymentStatus())) {
            throw new VacademyException("Only a paid payment can be voided (status: "
                    + paymentLog.getPaymentStatus() + ")");
        }

        List<StudentFeeAllocationLedger> allocations = allocationRepository.findByPaymentLogId(paymentLogId);
        assertBelongsToInstitute(paymentLog, instituteId);

        String stamp = "Voided " + LocalDateTime.now().withNano(0)
                + (StringUtils.hasText(voidedBy) ? " by " + voidedBy : "")
                + (StringUtils.hasText(reason) ? ": " + reason.trim() : "");

        // 1. Give the installments back what this payment had paid on them.
        int installmentsReopened = 0;
        for (StudentFeeAllocationLedger allocation : allocations) {
            if (VOIDED.equals(allocation.getAllocationType())) continue;
            BigDecimal allocated = nz(allocation.getAmountAllocated());
            if (allocated.signum() != 0) {
                StudentFeePayment bill = studentFeePaymentRepository
                        .findById(allocation.getStudentFeePaymentId()).orElse(null);
                if (bill != null) {
                    BigDecimal paid = nz(bill.getAmountPaid()).subtract(allocated).max(BigDecimal.ZERO);
                    bill.setAmountPaid(paid);
                    bill.setStatus(statusAfterUnallocation(bill.getStatus(), paid, nz(bill.getAmountExpected())));
                    studentFeePaymentRepository.save(bill);
                    installmentsReopened++;
                }
            }
            // Kept, relabelled: the allocation history still shows where the money had gone.
            allocation.setAllocationType(VOIDED);
            allocation.setRemarks(allocation.getRemarks() != null
                    ? allocation.getRemarks() + " | " + stamp
                    : stamp);
            allocationRepository.save(allocation);
        }

        // 2. Invoices tied to the payment.
        int invoicesUpdated = invoiceService.unwindInvoicesForVoidedPayment(paymentLogId, reason, voidedBy);

        // 3. Ledger: out of "total paid".
        BigDecimal creditReversed = userAccountLedgerService.reverseCreditsForVoidedPayment(
                paymentLogId, "Payment voided" + (StringUtils.hasText(reason) ? ": " + reason.trim() : ""));

        // 4. The payment itself.
        String previousStatus = paymentLog.getStatus();
        paymentLog.setPaymentStatus(VOIDED);
        paymentLog.setStatus(VOIDED);
        paymentLog.setPaymentSpecificData(withVoidAudit(
                paymentLog.getPaymentSpecificData(), previousStatus, reason, voidedBy));
        paymentLogRepository.save(paymentLog);

        log.info("[PaymentVoid] paymentLog={} amount={} institute={} voidedBy={} installments={} invoices={} "
                        + "creditReversed={} reason={}",
                paymentLogId, paymentLog.getPaymentAmount(), instituteId, voidedBy,
                installmentsReopened, invoicesUpdated, creditReversed, reason);

        return PaymentVoidResultDTO.builder()
                .paymentLogId(paymentLogId)
                .amount(paymentLog.getPaymentAmount())
                .currency(paymentLog.getCurrency())
                .installmentsReopened(installmentsReopened)
                .invoicesUpdated(invoicesUpdated)
                .creditReversed(creditReversed)
                .build();
    }

    /** Refuses a payment that belongs to another institute. Shared with the permanent delete. */
    public void assertBelongsToInstitute(PaymentLog paymentLog, String instituteId) {
        List<StudentFeeAllocationLedger> allocations = allocationRepository.findByPaymentLogId(paymentLog.getId());
        List<InvoicePaymentLogMapping> invoiceMappings =
                invoicePaymentLogMappingRepository.findAllByPaymentLogId(paymentLog.getId());
        if (!StringUtils.hasText(instituteId)
                || !instituteId.equals(resolveInstituteId(paymentLog, allocations, invoiceMappings))) {
            throw new VacademyException("Payment does not belong to this institute");
        }
    }

    /**
     * The institute a payment belongs to. payment_log has no institute_id: a plan payment is
     * scoped by its enrol invite, an admin-invoice payment (no plan) by the invoice it settled,
     * and a fee-schedule payment by the installments it paid.
     */
    private String resolveInstituteId(PaymentLog paymentLog,
                                      List<StudentFeeAllocationLedger> allocations,
                                      List<InvoicePaymentLogMapping> invoiceMappings) {
        UserPlan plan = paymentLog.getUserPlan();
        if (plan != null && plan.getEnrollInvite() != null
                && StringUtils.hasText(plan.getEnrollInvite().getInstituteId())) {
            return plan.getEnrollInvite().getInstituteId();
        }
        for (InvoicePaymentLogMapping mapping : invoiceMappings) {
            if (mapping.getInvoice() != null && StringUtils.hasText(mapping.getInvoice().getInstituteId())) {
                return mapping.getInvoice().getInstituteId();
            }
        }
        for (StudentFeeAllocationLedger allocation : allocations) {
            StudentFeePayment bill = studentFeePaymentRepository
                    .findById(allocation.getStudentFeePaymentId()).orElse(null);
            if (bill != null && StringUtils.hasText(bill.getInstituteId())) {
                return bill.getInstituteId();
            }
        }
        // Last resort — the ledger credit booked for it. A voided admin-invoice payment has no
        // plan, no allocations and (after the void reopened the bill) no invoice link left, but
        // its credit row still names the institute.
        return userAccountLedgerRepository.findByReferenceIdAndEventType(paymentLog.getId(), "CREDIT_PAYMENT")
                .stream()
                .map(vacademy.io.admin_core_service.features.user_account.entity.UserAccountLedger::getInstituteId)
                .filter(StringUtils::hasText)
                .findFirst()
                .orElse(null);
    }

    /** Same rules as CpoDiscountService.recomputeStatus: WAIVED and OVERDUE are owned elsewhere. */
    private static String statusAfterUnallocation(String current, BigDecimal paid, BigDecimal expected) {
        if ("WAIVED".equals(current) || "OVERDUE".equals(current)) return current;
        if (expected.signum() == 0) return "PAID";
        if (paid.signum() == 0) return "PENDING";
        if (paid.compareTo(expected) >= 0) return "PAID";
        return "PARTIAL_PAID";
    }

    @SuppressWarnings("unchecked")
    private static String withVoidAudit(String existingJson, String previousStatus,
                                        String reason, String voidedBy) {
        Map<String, Object> data = new HashMap<>();
        try {
            if (StringUtils.hasText(existingJson)) {
                data.putAll(JSON.readValue(existingJson, Map.class));
            }
        } catch (Exception e) {
            // Not JSON we understand — keep it verbatim rather than lose it.
            data.put("original_payment_specific_data", existingJson);
        }
        data.put("voided_at", LocalDateTime.now().toString());
        data.put("voided_by", StringUtils.hasText(voidedBy) ? voidedBy : "system");
        data.put("status_before_void", previousStatus);
        if (StringUtils.hasText(reason)) {
            data.put("void_reason", reason.trim());
        }
        try {
            return JSON.writeValueAsString(data);
        } catch (Exception e) {
            return existingJson;
        }
    }

    /**
     * Sub-org admins cannot void collections — mirrors CpoSideViewService#assertNotSubOrgAdmin,
     * which blocks them from recording or editing CPO payments for the same reason: what a
     * sub-org has collected is part of its finance agreement with the parent institute.
     */
    public void assertNotSubOrgAdmin(String userId) {
        if (!StringUtils.hasText(userId)) return;
        try {
            List<String> subOrgLinks = facultyMappingRepository
                    .findDistinctSubOrgIdsByUserAndLinkage(userId, List.of("ACTIVE"));
            if (subOrgLinks != null && !subOrgLinks.isEmpty()) {
                log.warn("Blocked payment void by sub-org admin userId={} (subOrgs={})", userId, subOrgLinks);
                throw new VacademyException("Only the parent institute admin can void a payment.");
            }
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            log.warn("Could not verify sub-org-admin status for userId={} ({}); allowing the void.",
                    userId, e.getMessage());
        }
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }
}
