package vacademy.io.admin_core_service.features.fee_management.service;

import vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.fee_management.dto.ApplyCpoDiscountRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoDiscountPreviewDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoInstallmentRowDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoSideViewInstallmentsResponseDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CpoUserPlanSummaryDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.ModifyInstallmentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.RecordOfflinePaymentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.SplitInstallmentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.invoice.dto.ManualInvoicePaymentRequestDTO;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDiscountJson;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.util.PaymentOptionJsonDiscountAccessor;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Backs the admin side-view "payment history" tab for CPO UserPlans.
 *
 * <p>Composes the installment list + discount snapshot, dispatches the
 * single-installment / CPO-level discount edits to {@link CpoDiscountService},
 * and owns the offline-payment recording path (mirrors the bulk-assign
 * side-effect helper but isolated to a single UserPlan).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class CpoSideViewService {

    private final UserPlanRepository userPlanRepository;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final CpoDiscountService cpoDiscountService;
    private final PaymentLogService paymentLogService;
    private final vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;
    private final PaymentLogRepository paymentLogRepository;
    private final FeeLedgerAllocationService feeLedgerAllocationService;
    private final InvoiceService invoiceService;
    private final InvoiceRepository invoiceRepository;
    private final OfflinePaymentDetailsService offlinePaymentDetailsService;
    private final ComplexPaymentOptionRepository complexPaymentOptionRepository;
    private final FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    private final vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository admissionPackageCourseRepository;
    private final vacademy.io.admin_core_service.features.fee_management.repository.FeeBillCancellationRepository feeBillCancellationRepository;

    // -------------------------------------------------------------------- read

    /**
     * One row per CPO UserPlan the user is enrolled in (each row a compact
     * totals view). Drives the side-view listing before drilling in.
     *
     * <p>Derived from {@code student_fee_payment.findByUserId} → group by
     * userPlanId → load each UserPlan + its CPO. Skips UserPlans whose
     * PaymentOption is not a CPO mirror.
     */
    public List<CpoUserPlanSummaryDTO> listForUser(String userId) {
        List<StudentFeePayment> all = studentFeePaymentRepository.findByUserId(userId);
        if (all.isEmpty()) return List.of();

        Map<String, List<StudentFeePayment>> byPlan = new java.util.LinkedHashMap<>();
        for (StudentFeePayment sfp : all) {
            if (sfp.getUserPlanId() == null) continue;
            byPlan.computeIfAbsent(sfp.getUserPlanId(), k -> new ArrayList<>()).add(sfp);
        }

        Map<String, String> packageByPlan = new HashMap<>();
        for (var course : admissionPackageCourseRepository.findByUserPlanIdIn(byPlan.keySet())) {
            packageByPlan.put(course.getUserPlanId(), course.getAdmissionPackageId());
        }

        List<CpoUserPlanSummaryDTO> out = new ArrayList<>(byPlan.size());
        for (Map.Entry<String, List<StudentFeePayment>> entry : byPlan.entrySet()) {
            UserPlan plan = userPlanRepository.findById(entry.getKey()).orElse(null);
            if (plan == null) continue;

            List<StudentFeePayment> rows = entry.getValue();
            BigDecimal gross = BigDecimal.ZERO, net = BigDecimal.ZERO, paid = BigDecimal.ZERO;
            String cpoId = null;
            for (StudentFeePayment sfp : rows) {
                gross = gross.add(nz(sfp.getOriginalAmount()));
                net = net.add(nz(sfp.getAmountExpected()));
                paid = paid.add(nz(sfp.getAmountPaid()));
                if (cpoId == null) cpoId = sfp.getCpoId();
            }

            String cpoName = null;
            if (cpoId != null) {
                ComplexPaymentOption cpo = complexPaymentOptionRepository.findById(cpoId).orElse(null);
                if (cpo != null) cpoName = cpo.getName();
            }

            out.add(CpoUserPlanSummaryDTO.builder()
                    .userPlanId(plan.getId())
                    .cpoId(cpoId)
                    .cpoName(cpoName)
                    .paymentOptionId(plan.getPaymentOptionId())
                    .paymentOptionName(plan.getPaymentOption() != null ? plan.getPaymentOption().getName() : null)
                    .status(plan.getStatus())
                    // Same lazy walk as getPaymentOption() above -- open-in-view keeps the
                    // session alive for the request, which is what that line already relies on.
                    .currency(plan.getPaymentPlan() != null ? plan.getPaymentPlan().getCurrency() : null)
                    .grossTotal(gross)
                    .netTotal(net)
                    .paidTotal(paid)
                    .outstandingTotal(net.subtract(paid))
                    .installmentCount(rows.size())
                    .startDate(plan.getStartDate())
                    .endDate(plan.getEndDate())
                    .admissionPackageId(packageByPlan.get(plan.getId()))
                    .build());
        }
        return out;
    }

    public CpoSideViewInstallmentsResponseDTO list(String userPlanId) {
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("UserPlan not found: " + userPlanId));

        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(userPlanId);
        // Render in chronological order so the side-view shows installment 1
        // first, then 2, etc. due_date is the natural sort key; rows with no
        // due_date sort last; ids break ties so the order is stable across reloads.
        sfps.sort((a, b) -> {
            java.util.Date da = a.getDueDate();
            java.util.Date db = b.getDueDate();
            if (da == null && db == null) return a.getId().compareTo(b.getId());
            if (da == null) return 1;
            if (db == null) return -1;
            int cmp = da.compareTo(db);
            return cmp != 0 ? cmp : a.getId().compareTo(b.getId());
        });
        UserPlanDiscountJson snapshot = parseSnapshot(plan);
        Map<String, BigDecimal> planShares = cpoDiscountService.currentPlanDiscountShares(sfps, snapshot);
        Map<String, vacademy.io.admin_core_service.features.fee_management.entity.FeeBillCancellation> stopped =
                new java.util.HashMap<>();
        List<String> cancelledIds = sfps.stream()
                .filter(s -> FeeBillCancellationService.CANCELLED.equalsIgnoreCase(s.getStatus()))
                .map(StudentFeePayment::getId).toList();
        if (!cancelledIds.isEmpty()) {
            feeBillCancellationRepository.findByStudentFeePaymentIdInAndReopenedAtIsNull(cancelledIds)
                    .forEach(c -> stopped.put(c.getStudentFeePaymentId(), c));
        }

        BigDecimal gross = BigDecimal.ZERO;
        BigDecimal net = BigDecimal.ZERO;
        BigDecimal paid = BigDecimal.ZERO;
        List<CpoInstallmentRowDTO> rows = new ArrayList<>(sfps.size());

        for (StudentFeePayment sfp : sfps) {
            BigDecimal originalAmount = nz(sfp.getOriginalAmount());
            BigDecimal amountExpected = nz(sfp.getAmountExpected());
            BigDecimal amountPaid = nz(sfp.getAmountPaid());

            gross = gross.add(originalAmount);
            net = net.add(amountExpected);
            paid = paid.add(amountPaid);

            var stop = stopped.get(sfp.getId());
            rows.add(CpoInstallmentRowDTO.builder()
                    .stoppedReason(stop != null ? stop.getReason() : null)
                    .stoppedAmount(stop != null ? stop.cancelledAmount() : null)
                    .stoppedAt(stop != null ? stop.getCancelledAt() : null)
                    .id(sfp.getId())
                    .aftInstallmentId(sfp.getIId())
                    .installmentNumber(sfp.getInstallmentNumber())
                    .originalAmount(originalAmount)
                    .amountExpected(amountExpected)
                    .amountPaid(amountPaid)
                    .outstanding(amountExpected.subtract(amountPaid))
                    .startDate(sfp.getStartDate())
                    .dueDate(sfp.getDueDate())
                    .status(sfp.getStatus())
                    .planDiscountShare(planShares.get(sfp.getId()))
                    .installmentDiscount(snapshot.getInstallmentDiscounts() != null
                            ? snapshot.getInstallmentDiscounts().get(sfp.getId())
                            : null)
                    .manualAmountOverride(snapshot.getManualAmountOverrides() != null
                            ? snapshot.getManualAmountOverrides().get(sfp.getId())
                            : null)
                    .build());
        }

        String cpoId = sfps.isEmpty() ? null : sfps.get(0).getCpoId();
        return CpoSideViewInstallmentsResponseDTO.builder()
                .userPlanId(plan.getId())
                .userId(plan.getUserId())
                .cpoId(cpoId)
                .grossTotal(gross)
                .netTotal(net)
                .paidTotal(paid)
                .outstandingTotal(net.subtract(paid))
                .cpoDiscount(snapshot.getCpoDiscount())
                .installments(rows)
                .history(snapshot.getHistory())
                .build();
    }

    // ------------------------------------------------------------------- write

    @Transactional
    public CpoSideViewInstallmentsResponseDTO modifyInstallment(
            String sfpId, ModifyInstallmentRequestDTO req, String appliedBy) {

        assertNotSubOrgAdmin(appliedBy, "modify installment");

        StudentFeePayment sfp = studentFeePaymentRepository.findById(sfpId)
                .orElseThrow(() -> new VacademyException("StudentFeePayment not found: " + sfpId));

        if (req.getStartDate() != null || req.getDueDate() != null) {
            cpoDiscountService.setInstallmentDates(sfpId, req.getStartDate(), req.getDueDate(), appliedBy);
        }

        if (req.isClearAmountOverride()) {
            cpoDiscountService.clearInstallmentAmountOverride(sfpId, appliedBy);
        } else if (req.getAmount() != null) {
            cpoDiscountService.setInstallmentAmount(
                    sfpId, BigDecimal.valueOf(req.getAmount()),
                    req.getDiscount() != null ? req.getDiscount().getReason() : null,
                    appliedBy);
        }

        if (req.isClearDiscount()) {
            cpoDiscountService.setInstallmentDiscount(sfpId, null, appliedBy);
        } else if (req.getDiscount() != null && req.getAmount() == null) {
            // Discount is only applied as a discount when no explicit amount was supplied
            // (otherwise the amount override has already absorbed the reason).
            cpoDiscountService.setInstallmentDiscount(sfpId, req.getDiscount(), appliedBy);
        }

        return list(sfp.getUserPlanId());
    }

    /**
     * Moves part of an installment's unpaid balance onto a new installment with its own due
     * date. See {@link CpoDiscountService#splitInstallment} for how the amounts and the ledger
     * are carried.
     */
    @Transactional
    public CpoSideViewInstallmentsResponseDTO splitInstallment(
            String sfpId, SplitInstallmentRequestDTO req, String appliedBy) {

        assertNotSubOrgAdmin(appliedBy, "split an installment");

        if (req == null || req.getAmount() == null) {
            throw new VacademyException("Amount to move is required");
        }
        StudentFeePayment added = cpoDiscountService.splitInstallment(
                sfpId, BigDecimal.valueOf(req.getAmount()),
                req.getStartDate(), req.getDueDate(), appliedBy);
        return list(added.getUserPlanId());
    }

    @Transactional
    public CpoSideViewInstallmentsResponseDTO setCpoDiscount(
            String userPlanId, ApplyCpoDiscountRequestDTO req, String appliedBy) {

        assertNotSubOrgAdmin(appliedBy, "apply CPO discount");

        if (req.getDiscount() == null && !req.isRemove()) {
            throw new VacademyException("Either discount or remove=true must be supplied");
        }
        cpoDiscountService.setCpoDiscount(userPlanId, req.isRemove() ? null : req.getDiscount(),
                req.getAllocation(), req.getCustomShares(), appliedBy);
        return list(userPlanId);
    }

    /** What {@link #setCpoDiscount} would take off each installment; nothing is saved. */
    public CpoDiscountPreviewDTO previewCpoDiscount(String userPlanId, ApplyCpoDiscountRequestDTO req) {
        if (req == null || req.getDiscount() == null) {
            throw new VacademyException("Discount is required");
        }
        CpoDiscountService.CpoDiscountPlan planned = cpoDiscountService.previewCpoDiscount(
                userPlanId, req.getDiscount(), req.getAllocation(), req.getCustomShares());
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("UserPlan not found: " + userPlanId));
        UserPlanDiscountJson snapshot = parseSnapshot(plan);
        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(userPlanId);
        Map<String, BigDecimal> current = cpoDiscountService.currentPlanDiscountShares(sfps, snapshot);
        List<CpoDiscountPreviewDTO.Row> rows = new ArrayList<>(sfps.size());
        for (StudentFeePayment sfp : sfps) {
            BigDecimal share = nz(planned.shares().get(sfp.getId()));
            // Billed now + the plan discount it carries now = its value before any plan discount.
            BigDecimal before = nz(sfp.getAmountExpected()).add(nz(current.get(sfp.getId())));
            BigDecimal after = before.subtract(share);
            rows.add(CpoDiscountPreviewDTO.Row.builder()
                    .id(sfp.getId())
                    .share(share)
                    .amountAfter(after.signum() < 0 ? BigDecimal.ZERO : after)
                    .build());
        }
        return CpoDiscountPreviewDTO.builder()
                .allocation(planned.allocation())
                .requestedAmount(planned.requested())
                .resolvedAmount(planned.resolved())
                .installments(rows)
                .build();
    }

    @Transactional
    public CpoSideViewInstallmentsResponseDTO recordOfflinePayment(
            String userPlanId, RecordOfflinePaymentRequestDTO req, String appliedBy) {
        recordOfflinePaymentLog(userPlanId, req, appliedBy);
        return list(userPlanId);
    }

    /**
     * {@link #recordOfflinePayment} without the refreshed listing: records the payment and returns
     * its payment log id. An admission package records one per course and then issues a single
     * receipt for all of them.
     */
    @Transactional
    public String recordOfflinePaymentLog(String userPlanId, RecordOfflinePaymentRequestDTO req, String appliedBy) {

        assertNotSubOrgAdmin(appliedBy, "record offline payment");

        // Audit log up front. We had a prod incident where an offline payment
        // landed as ₹1 instead of the intended amount; logging the exact wire
        // payload lets us forensically distinguish "admin typed 1" from
        // "request was malformed" from "form state was wrong at submit time".
        log.info("recordOfflinePayment: userPlanId={}, amount={}, paymentDate={}, reference={}, "
                        + "currency={}, generateInvoice={}, appliedBy={}",
                userPlanId, req.getAmount(), req.getPaymentDate(), req.getReference(),
                req.getCurrency(), req.isGenerateInvoice(), appliedBy);

        if (req.getAmount() == null || req.getAmount() <= 0.0) {
            throw new VacademyException("Payment amount must be positive");
        }

        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("UserPlan not found: " + userPlanId));

        // Resolve institute_id from SFP rows — UserPlan has no instituteId column.
        String instituteId = studentFeePaymentRepository.findByUserPlanId(userPlanId).stream()
                .map(StudentFeePayment::getInstituteId)
                .filter(s -> s != null && !s.isBlank())
                .findFirst()
                // A plan with no fee bills (e.g. a sub-org admin plan): its invite knows the institute.
                .orElse(plan.getEnrollInvite() != null ? plan.getEnrollInvite().getInstituteId() : null);

        // Validate how it was paid before anything is written.
        OfflinePaymentDetailsService.Resolved paymentDetails =
                offlinePaymentDetailsService.resolve(instituteId, req.getPaymentDetails(), req.getReference());
        // First payment of this enrolment: pin the numbering-series field (e.g. branch) picked
        // in the dialog, so this and every later receipt of the course use its series.
        offlinePaymentDetailsService.pinNumberingValue(instituteId, userPlanId, plan.getUserId(),
                req.getPaymentDetails());

        String currency = req.getCurrency() != null
                ? req.getCurrency()
                : (plan.getPaymentPlan() != null && plan.getPaymentPlan().getCurrency() != null
                        ? plan.getPaymentPlan().getCurrency() : "INR");
        Date paymentDate = req.getPaymentDate() != null ? req.getPaymentDate()
                : paymentDetails != null && paymentDetails.paymentDate() != null
                        ? java.sql.Date.valueOf(paymentDetails.paymentDate())
                        : new Date();

        String paymentLogId = paymentLogService.createPaymentLog(
                plan.getUserId(),
                req.getAmount(),
                PaymentGateway.MANUAL.name(),
                PaymentGateway.MANUAL.name(),
                currency,
                plan,
                null,
                paymentDate);

        Map<String, Object> paymentSpecificData = new HashMap<>();
        if (req.getReference() != null && !req.getReference().isBlank()) {
            paymentSpecificData.put("transaction_id", req.getReference());
        }
        paymentSpecificData.put("source", "SIDE_VIEW_CPO");
        paymentSpecificData.put("recorded_by", appliedBy);
        paymentLogService.updatePaymentLogOnly(
                paymentLogId,
                PaymentLogStatusEnum.SUCCESS.name(),
                PaymentStatusEnum.PAID.name(),
                JsonUtil.toJson(paymentSpecificData));
        offlinePaymentDetailsService.apply(paymentLogId, paymentDetails, appliedBy);

        // Ledger: credit payment for CPO offline settlement
        if (instituteId != null) {
            userAccountLedgerService.recordCreditPayment(
                    plan.getUserId(), instituteId,
                    BigDecimal.valueOf(req.getAmount()), currency,
                    "USER_PLAN", userPlanId,
                    paymentLogId, null, "CPO offline payment recorded");
        }

        feeLedgerAllocationService.allocatePaymentForNewLog(
                paymentLogId, BigDecimal.valueOf(req.getAmount()), userPlanId);

        // Mirror the gateway/webhook success path (RazorpayWebHookService): a recorded
        // payment settles the pending balance, so lift the plan out of its awaiting-payment
        // state. Without this, the sub-org admin panel (and the learner CPO side-view) stays
        // stuck at PENDING_FOR_PAYMENT even after a full offline payment. Only transition from
        // a pending-payment state so a CANCELED/EXPIRED/TERMINATED plan is never reactivated.
        String planStatus = plan.getStatus();
        if (UserPlanStatusEnum.PENDING_FOR_PAYMENT.name().equalsIgnoreCase(planStatus)
                || UserPlanStatusEnum.PENDING.name().equalsIgnoreCase(planStatus)
                || UserPlanStatusEnum.PAYMENT_FAILED.name().equalsIgnoreCase(planStatus)) {
            plan.setStatus(UserPlanStatusEnum.ACTIVE.name());
            userPlanRepository.save(plan);
            log.info("Activated UserPlan {} (was {}) after offline payment log {}",
                    userPlanId, planStatus, paymentLogId);
        }

        // After filling CPO installments, mark any pending ADMIN_MANUAL invoices for
        // this user+institute as paid (oldest-first). These are ad-hoc invoices the
        // institute admin raised outside the CPO schedule; settling them here gives a
        // single "Record Offline Payment" action that clears all outstanding obligations.
        if (instituteId != null) {
            ManualInvoicePaymentRequestDTO invoicePayReq = new ManualInvoicePaymentRequestDTO();
            invoicePayReq.setNotes("Auto-settled via offline payment log " + paymentLogId
                    + (req.getReference() != null && !req.getReference().isBlank()
                       ? " (ref: " + req.getReference() + ")" : ""));
            // Same "how it was paid" as the payment that settles them. Without it, an institute
            // that requires a mode would reject this inner call, and because it joins this
            // transaction, the whole offline payment would roll back.
            invoicePayReq.setPaymentDetails(req.getPaymentDetails());
            invoicePayReq.setTransactionId(req.getReference());
            List<Invoice> pendingAdminInvoices =
                    invoiceRepository.findPendingAdminManualInvoices(plan.getUserId(), instituteId);
            for (Invoice inv : pendingAdminInvoices) {
                try {
                    invoiceService.markInvoicePaidManually(inv.getId(), invoicePayReq, null);
                } catch (Exception e) {
                    log.warn("Could not auto-settle admin invoice {} during offline payment {}: {}",
                            inv.getId(), paymentLogId, e.getMessage());
                }
            }
        }

        if (req.isGenerateInvoice()) {
            // Deferred to after this transaction commits. Generating inline killed the payment:
            // the invoice's REQUIRES_NEW transaction could not see this method's still-uncommitted
            // PaymentLog, so invoice_payment_log_mapping failed its FK — and because catching that
            // exception does not clear rollbackOnly, the commit died with "Transaction silently
            // rolled back", discarding the payment log, the ledger credit and the allocation.
            invoiceService.generateInvoiceAfterCommit(paymentLogId, instituteId);
        }

        return paymentLogId;
    }

    // ---------------------------------------------------------------- helpers

    private UserPlanDiscountJson parseSnapshot(UserPlan plan) {
        return PaymentOptionJsonDiscountAccessor.read(plan.getPaymentOptionJson());
    }

    private static BigDecimal nz(BigDecimal b) { return b == null ? BigDecimal.ZERO : b; }

    /**
     * Rejects ledger mutations by sub-org admins. Fingerprint mirrors
     * {@code SubOrgTeamService.ensureCallerCanAccessSubOrg}: presence of any active
     * SUB_ORG-linked FSPSSM row identifies the caller as a sub-org admin, regardless
     * of their JWT role string (sub-org admins are also given the ADMIN role on the
     * parent institute, so the role alone is unreliable).
     *
     * Why: CPO ledger edits (per-installment date/amount/discount, CPO-level discount,
     * offline payment recording) are an institute↔sub-org-admin finance agreement.
     * The sub-org admin must not be able to discount themselves or record their own
     * collections. Only the parent institute admin (no SUB_ORG linkages) can.
     */
    private void assertNotSubOrgAdmin(String userId, String action) {
        if (userId == null || userId.isBlank()) return; // anonymous internal call — let through
        try {
            List<String> subOrgLinks = facultyMappingRepository
                    .findDistinctSubOrgIdsByUserAndLinkage(userId, List.of("ACTIVE"));
            if (subOrgLinks != null && !subOrgLinks.isEmpty()) {
                log.warn("Blocked CPO ledger mutation '{}' by sub-org admin userId={} (subOrgs={})",
                        action, userId, subOrgLinks);
                throw new VacademyException(
                        "Only the parent institute admin can " + action
                                + " on a CPO ledger.");
            }
        } catch (VacademyException ve) {
            throw ve;
        } catch (Exception e) {
            // Fail open on infrastructure failures — we don't want a transient DB blip
            // to block legitimate institute-admin writes. Logged for visibility.
            log.warn("Could not verify sub-org-admin status for userId={} ({}); allowing the write.",
                    userId, e.getMessage());
        }
    }
}
