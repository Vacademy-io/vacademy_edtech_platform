package vacademy.io.admin_core_service.features.fee_management.controller;

import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import vacademy.io.admin_core_service.features.fee_management.dto.FeeSearchFilterDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.ReceiptDetailsDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.SelectiveAllocationRequest;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeeAllocationLedgerDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeePaymentDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeePaymentRowDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CollectionDashboardResponseDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CollectionDashboardRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InstituteFeeTypePriorityDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InvoiceReceiptDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.SetPriorityRequest;
import vacademy.io.admin_core_service.features.fee_management.entity.InstituteFeeTypePriority;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.enums.AllocationScope;
import vacademy.io.admin_core_service.features.fee_management.repository.InstituteFeeTypePriorityRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.service.FeeAccessGuard;
import vacademy.io.admin_core_service.features.fee_management.service.FeeLedgerAllocationService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeTrackingService;
import vacademy.io.admin_core_service.features.fee_management.service.StudentFeeAdjustmentService;
import vacademy.io.admin_core_service.features.fee_management.enums.AdjustmentType;
import vacademy.io.admin_core_service.features.fee_management.enums.AdjustmentStatus;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.time.ZoneId;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/admin-core-service/v1/admin/student-fee")
public class FeeTrackingAdminController {

    @Autowired
    private FeeTrackingService feeTrackingService;

    @Autowired
    private FeeLedgerAllocationService feeLedgerAllocationService;

    @Autowired
    private InstituteFeeTypePriorityRepository priorityRepository;

    @Autowired
    private InvoiceRepository invoiceRepository;

    @Autowired
    private InvoiceLineItemRepository invoiceLineItemRepository;

    @Autowired
    private MediaService mediaService;

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.service.SchoolFeeReceiptService schoolFeeReceiptService;

    @Autowired
    private StudentFeeAdjustmentService studentFeeAdjustmentService;

    @Autowired
    private vacademy.io.admin_core_service.features.fee_management.service.AdjustmentHistoryQueryService adjustmentHistoryQueryService;

    // Every route checks the caller first (see FeeAccessGuard for the rule): staff of the
    // institute that owns the data; the three parent-portal reads also admit the learner
    // and a linked guardian. Entity-only routes resolve the institute from the entity.
    @Autowired
    private FeeAccessGuard feeAccessGuard;

    @Autowired
    private StudentFeePaymentRepository studentFeePaymentRepository;

    @PostMapping("/{userId}/dues")
    public ResponseEntity<StudentDuesPageResponse> getStudentDues(
            @PathVariable("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) DuesFilterRequest filter,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaffOrLearnerSide(user, userId, instituteId);

        List<StudentFeePaymentDTO> dues = feeTrackingService.getStudentDues(userId, instituteId);

        boolean fetchAll = false;
        int page = 0;
        int size = 10;

        if (filter != null) {
            // Optional status filter: OVERDUE is client-defined (is_overdue flag), rest match status field
            if (filter.getStatus() != null && !filter.getStatus().isBlank()) {
                String statusFilter = filter.getStatus().trim().toUpperCase();
                if ("OVERDUE".equals(statusFilter)) {
                    dues = dues.stream()
                            .filter(d -> Boolean.TRUE.equals(d.getIsOverdue()))
                            .collect(Collectors.toList());
                } else {
                    dues = dues.stream()
                            .filter(d -> d.getStatus() != null
                                    && d.getStatus().toUpperCase().equals(statusFilter))
                            .collect(Collectors.toList());
                }
            }

            // Optional due date range filter
            LocalDate start = filter.getStartDueDate();
            LocalDate end = filter.getEndDueDate();
            if (start != null || end != null) {
                dues = dues.stream()
                        .filter(d -> {
                            if (d.getDueDate() == null) {
                                return false;
                            }
                            LocalDate due = d.getDueDate().toInstant()
                                    .atZone(ZoneId.systemDefault())
                                    .toLocalDate();
                            if (start != null && due.isBefore(start)) {
                                return false;
                            }
                            if (end != null && due.isAfter(end)) {
                                return false;
                            }
                            return true;
                        })
                        .collect(Collectors.toList());
            }

            if (Boolean.TRUE.equals(filter.getFetchAll())) {
                fetchAll = true;
            }
            if (filter.getPage() != null && filter.getPage() >= 0) {
                page = filter.getPage();
            }
            if (filter.getSize() != null && filter.getSize() > 0) {
                size = filter.getSize();
            }
        }

        BigDecimal totalFee = BigDecimal.ZERO;
        BigDecimal totalPaid = BigDecimal.ZERO;
        BigDecimal totalDue = BigDecimal.ZERO;
        for (StudentFeePaymentDTO d : dues) {
            if (d.getAmountExpected() != null) totalFee = totalFee.add(d.getAmountExpected());
            if (d.getAmountPaid() != null) totalPaid = totalPaid.add(d.getAmountPaid());
            if (d.getAmountDue() != null) totalDue = totalDue.add(d.getAmountDue());
        }

        long totalElements = dues.size();
        int totalPages = size > 0 ? (int) Math.ceil((double) totalElements / size) : 1;

        List<StudentFeePaymentDTO> content;
        if (fetchAll) {
            content = dues;
        } else {
            int from = Math.min(page * size, dues.size());
            int to = Math.min(from + size, dues.size());
            content = dues.subList(from, to);
        }

        StudentDuesPageResponse response = new StudentDuesPageResponse();
        response.setContent(content);
        response.setPageNumber(fetchAll ? 0 : page);
        response.setPageSize(fetchAll ? content.size() : size);
        response.setTotalElements(totalElements);
        response.setTotalPages(fetchAll ? 1 : totalPages);
        response.setTotalFee(totalFee);
        response.setTotalPaid(totalPaid);
        response.setTotalDue(totalDue);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{userId}/receipts")
    public ResponseEntity<List<StudentFeeAllocationLedgerDTO>> getStudentReceipts(
            @PathVariable("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);
        return ResponseEntity.ok(feeTrackingService.getStudentReceipts(userId, instituteId));
    }

    @GetMapping("/{userId}/invoice-receipts")
    public ResponseEntity<List<InvoiceReceiptDTO>> getStudentInvoiceReceipts(
            @PathVariable("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaffOrLearnerSide(user, userId, instituteId);
        return ResponseEntity.ok(feeTrackingService.getStudentInvoiceReceipts(userId, instituteId));
    }

    /**
     * Allocate an offline/admin payment for a user across their unpaid installments
     * with overdue-first + institute fee-type priority ordering.
     *
     * @param userId      the student whose installments are to be updated
     * @param amount      the payment amount
     * @param instituteId optional – derived from bills when absent
     * @param scope       OVERDUE_ONLY or ALL_DUES (defaults to ALL_DUES)
     */
    @PostMapping("/{userId}/allocate")
    public ResponseEntity<Void> allocatePaymentForUser(
            @PathVariable("userId") String userId,
            @RequestParam("amount") java.math.BigDecimal amount,
            @RequestParam(value = "instituteId", required = false) String instituteId,
            @RequestParam(value = "scope", required = false, defaultValue = "ALL_DUES") String scope,
            @RequestAttribute("user") CustomUserDetails user) {

        AllocationScope allocationScope;
        try {
            allocationScope = AllocationScope.valueOf(scope.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }

        // The allocation touches every unpaid bill of the user, so the caller must be staff
        // of the institute that owns all of them (and of the named institute, if any).
        feeAccessGuard.requireStaffOfBillsInstitute(user,
                studentFeePaymentRepository.findByUserIdAndStatusNot(userId, "PAID"), instituteId);

        feeLedgerAllocationService.allocatePaymentForUser(userId, amount, instituteId, allocationScope);
        return ResponseEntity.noContent().build();
    }

    /**
     * Allocate payment to admin-selected installments.
     * The admin picks specific installments and the amount to pay on each.
     */
    @PostMapping("/{userId}/allocate-selected")
    public ResponseEntity<?> allocatePaymentForSelectedInstallments(
            @PathVariable("userId") String userId,
            @RequestBody SelectiveAllocationRequest request,
            @RequestAttribute("user") CustomUserDetails user) {

        if (request.getInstituteId() == null || request.getInstituteId().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        if (request.getStudentFeePaymentIds() == null || request.getStudentFeePaymentIds().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        if (request.getAmount() == null || request.getAmount().compareTo(java.math.BigDecimal.ZERO) <= 0) {
            return ResponseEntity.badRequest().build();
        }
        feeAccessGuard.requireStaffForBills(user, request.getInstituteId(),
                studentFeePaymentRepository.findAllById(request.getStudentFeePaymentIds()));

        String invoiceId = feeLedgerAllocationService.allocatePaymentForSelectedInstallments(
                userId, request.getInstituteId(), request.getStudentFeePaymentIds(),
                request.getAmount(), request.getRemarks(),
                request.getPaymentDetails(), user != null ? user.getUserId() : null);

        if (invoiceId == null) {
            return ResponseEntity.ok(new java.util.HashMap<>());
        }

        ReceiptDetailsDTO receipt = feeTrackingService.buildReceiptDetails(invoiceId);
        if (receipt != null) {
            Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
            if (invoice != null && invoice.getPdfFileId() != null) {
                receipt.setDownloadUrl(mediaService.getFilePublicUrlById(invoice.getPdfFileId()));
            }
        }
        return ResponseEntity.ok(receipt);
    }

    /**
     * Submit an adjustment (penalty or concession) on a specific installment.
     * Penalty is auto-approved. Concession goes to PENDING_FOR_APPROVAL.
     */
    @PatchMapping("/adjustment/submit")
    public ResponseEntity<?> submitAdjustment(
            @RequestBody AdjustmentSubmitRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails adminUser
    ) {
        requireStaffForBill(adminUser, instituteId, request.getStudentFeePaymentId());
        AdjustmentType type = AdjustmentType.valueOf(request.getAdjustmentType().toUpperCase());

        StudentFeeAdjustmentService.AdjustmentResult result = studentFeeAdjustmentService.submitAdjustment(
                request.getStudentFeePaymentId(),
                request.getUserId(),
                request.getAdjustmentAmount(),
                type,
                request.getAdjustmentReason(),
                instituteId,
                adminUser
        );

        return ResponseEntity.ok(buildAdjustmentResponse(result.bill(), result.event()));
    }

    /**
     * Approve or reject a pending concession adjustment.
     * Only users with configured approval roles can call this.
     */
    @PatchMapping("/adjustment/review")
    public ResponseEntity<?> reviewAdjustment(
            @RequestBody AdjustmentReviewRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails adminUser
    ) {
        // Staff here; the service then requires one of the institute's configured
        // FEE_ADJUSTMENT_SETTINGS.approvalRoles (which may name non-admin roles).
        requireStaffForBill(adminUser, instituteId, request.getStudentFeePaymentId());
        AdjustmentStatus action = AdjustmentStatus.valueOf(request.getAction().toUpperCase());

        StudentFeeAdjustmentService.AdjustmentResult result = studentFeeAdjustmentService.reviewAdjustment(
                request.getStudentFeePaymentId(),
                action,
                instituteId,
                adminUser
        );

        return ResponseEntity.ok(buildAdjustmentResponse(result.bill(), result.event()));
    }

    /**
     * Retract an adjustment (pending, rejected, or approved).
     * Appends a RETRACTED event to the history; the installment's FK still
     * points to the RETRACTED row so the audit trail remains intact.
     */
    @PatchMapping("/adjustment/retract")
    public ResponseEntity<?> retractAdjustment(
            @RequestBody AdjustmentRetractRequest request,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails adminUser
    ) {
        requireStaffForBill(adminUser, instituteId, request.getStudentFeePaymentId());
        StudentFeeAdjustmentService.AdjustmentResult result = studentFeeAdjustmentService.retractAdjustment(
                request.getStudentFeePaymentId(),
                instituteId,
                adminUser
        );

        return ResponseEntity.ok(buildAdjustmentResponse(result.bill(), result.event()));
    }

    /**
     * Paginated adjustment history for a single installment. Powers the
     * "History" section in the AdjustmentDialog on the Pay Installments page.
     * DB-level pagination — default 20 per page.
     */
    @GetMapping("/installment/{installmentId}/adjustment-history")
    public ResponseEntity<Page<vacademy.io.admin_core_service.features.fee_management.dto.AdjustmentHistoryDTO>> getAdjustmentHistory(
            @PathVariable("installmentId") String installmentId,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size,
            @RequestAttribute("user") CustomUserDetails user) {
        StudentFeePayment bill = studentFeePaymentRepository.findById(installmentId).orElse(null);
        if (bill == null) {
            return ResponseEntity.notFound().build();
        }
        feeAccessGuard.requireStaffOfBillsInstitute(user, List.of(bill), null);
        if (size <= 0 || size > 100) size = 20;
        if (page < 0) page = 0;
        return ResponseEntity.ok(
                adjustmentHistoryQueryService.getHistoryForInstallment(installmentId, page, size));
    }

    /**
     * Institute-wide adjustment history. Powers the Adjustment Approvals page
     * with tabs (Pending / Approved / Rejected / All) plus optional filters
     * (actor, date range, adjustment types, student search).
     *
     * Filter is in the request body (POST) so multi-valued fields stay clean.
     * Pagination is DB-level via Spring {@code Pageable} (default 20/page).
     */
    @PostMapping("/adjustment/history")
    public ResponseEntity<Page<vacademy.io.admin_core_service.features.fee_management.dto.EnrichedAdjustmentHistoryDTO>> getInstituteAdjustmentHistory(
            @RequestBody(required = false) vacademy.io.admin_core_service.features.fee_management.dto.InstituteAdjustmentHistoryFilterDTO filter,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);
        return ResponseEntity.ok(
                adjustmentHistoryQueryService.getInstituteHistory(instituteId, filter));
    }

    /**
     * Get all installments with pending adjustment approvals for an institute.
     */
    @PostMapping("/adjustment/pending")
    public ResponseEntity<?> getPendingAdjustments(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails adminUser
    ) {
        feeAccessGuard.requireStaff(adminUser, instituteId);
        List<StudentFeePaymentDTO> pending = feeTrackingService.getPendingAdjustments(instituteId);
        return ResponseEntity.ok(pending);
    }

    /**
     * Staff of {@code instituteId}, and the bill (when it exists) belongs to that institute. A
     * missing bill is left to the service, which reports it as not found.
     */
    private void requireStaffForBill(CustomUserDetails user, String instituteId, String studentFeePaymentId) {
        List<StudentFeePayment> bills = StringUtils.hasText(studentFeePaymentId)
                ? studentFeePaymentRepository.findById(studentFeePaymentId).map(List::of).orElse(List.of())
                : List.of();
        feeAccessGuard.requireStaffForBills(user, instituteId, bills);
    }

    private Map<String, Object> buildAdjustmentResponse(
            StudentFeePayment bill,
            vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAdjustmentHistory event
    ) {
        BigDecimal amountExpected = bill.getAmountExpected() != null ? bill.getAmountExpected() : BigDecimal.ZERO;
        BigDecimal amountPaid = bill.getAmountPaid() != null ? bill.getAmountPaid() : BigDecimal.ZERO;

        String eventType = event != null ? event.getEventType() : null;
        String resultingStatus = event != null ? event.getResultingStatus() : null;
        String adjustmentType = event != null ? event.getAdjustmentType() : null;
        BigDecimal adjustmentAmount = (event != null && event.getAmount() != null)
                ? event.getAmount() : BigDecimal.ZERO;

        // A RETRACTED event means "no effective adjustment" — callers expect null fields.
        boolean isRetracted = "RETRACTED".equals(eventType);

        BigDecimal amountDue = amountExpected.subtract(amountPaid);
        if (!isRetracted && "APPROVED".equals(resultingStatus)) {
            if ("PENALTY".equals(adjustmentType)) {
                amountDue = amountDue.add(adjustmentAmount);
            } else if ("CONCESSION".equals(adjustmentType)) {
                amountDue = amountDue.subtract(adjustmentAmount);
            }
        }

        Map<String, Object> resp = new java.util.HashMap<>();
        resp.put("student_fee_payment_id", bill.getId());
        resp.put("user_id", bill.getUserId());
        resp.put("adjustment_amount", isRetracted ? BigDecimal.ZERO : adjustmentAmount);
        resp.put("adjustment_type", isRetracted ? null : adjustmentType);
        resp.put("adjustment_status", isRetracted ? null : resultingStatus);
        resp.put("adjustment_reason", isRetracted || event == null ? null : event.getReason());
        resp.put("status", bill.getStatus());
        resp.put("amount_due", amountDue);

        return resp;
    }

    /**
     * Admin fee roster search — powers the "Manage Finances" table in the frontend.
     *
     * POST
     * /admin-core-service/v1/admin/student-fee/search?instituteId={instituteId}
     *
     * Accepts a rich filter payload and returns a paginated list of student fee
     * payment records enriched with student name/email and fee type context.
     */
    @PostMapping("/search")
    public ResponseEntity<Page<StudentFeePaymentRowDTO>> searchStudentFeePayments(
            @RequestParam("instituteId") String instituteId,
            @RequestBody FeeSearchFilterDTO filter,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);
        Page<StudentFeePaymentRowDTO> results = feeTrackingService.searchFeePayments(instituteId, filter);
        return ResponseEntity.ok(results);
    }

    @PostMapping("/dashboard/collection")
    public ResponseEntity<CollectionDashboardResponseDTO> getCollectionDashboard(
            @RequestBody CollectionDashboardRequestDTO request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, request.getInstituteId());
        return ResponseEntity.ok(feeTrackingService.getCollectionDashboard(request));
    }

    @GetMapping("/payment-details")
    public ResponseEntity<List<vacademy.io.admin_core_service.features.fee_management.dto.InstallmentDetailsDTO>> getPaymentDetails(
            @RequestParam("studentId") String studentId,
            @RequestParam("cpoId") String cpoId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaffOfPaymentOption(user, cpoId);
        return ResponseEntity.ok(feeTrackingService.getPaymentDetails(studentId, cpoId));
    }
    @GetMapping("/fee-types")
    public ResponseEntity<List<Map<String, String>>> getFeeTypesForInstitute(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);
        return ResponseEntity.ok(feeTrackingService.getFeeTypesForInstitute(instituteId));
    }

    // ---- Fee-type priority configuration endpoints ----

    @PutMapping("/priority")
    @Transactional
    public ResponseEntity<Void> setFeeTypePriority(
            @RequestParam("instituteId") String instituteId,
            @RequestBody SetPriorityRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);

        if (request.getScope() == null || request.getPriorities() == null) {
            return ResponseEntity.badRequest().build();
        }

        String scopeStr;
        try {
            scopeStr = AllocationScope.valueOf(request.getScope().trim().toUpperCase()).name();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }

        priorityRepository.deleteByInstituteIdAndScope(instituteId, scopeStr);

        for (InstituteFeeTypePriorityDTO dto : request.getPriorities()) {
            InstituteFeeTypePriority entity = new InstituteFeeTypePriority();
            entity.setInstituteId(instituteId);
            entity.setScope(scopeStr);
            entity.setFeeTypeId(dto.getFeeTypeId());
            entity.setPriorityOrder(dto.getPriorityOrder());
            priorityRepository.save(entity);
        }

        return ResponseEntity.noContent().build();
    }

    @GetMapping("/priority")
    public ResponseEntity<List<InstituteFeeTypePriorityDTO>> getFeeTypePriority(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("scope") String scope,
            @RequestAttribute("user") CustomUserDetails user) {
        feeAccessGuard.requireStaff(user, instituteId);

        String scopeStr;
        try {
            scopeStr = AllocationScope.valueOf(scope.trim().toUpperCase()).name();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }

        List<InstituteFeeTypePriorityDTO> result = priorityRepository
                .findByInstituteIdAndScopeOrderByPriorityOrderAsc(instituteId, scopeStr)
                .stream()
                .map(e -> InstituteFeeTypePriorityDTO.builder()
                        .feeTypeId(e.getFeeTypeId())
                        .priorityOrder(e.getPriorityOrder())
                        .build())
                .collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    // ---- Receipt PDF Download ----

    /**
     * Get download URL for receipt PDF.
     * Frontend should use the returned URL with &lt;a download&gt; to trigger download.
     *
     * @param invoiceId the invoice/receipt ID
     * @return JSON with download_url, invoice_number, file_name
     */
    @GetMapping("/receipt/{invoiceId}/download-url")
    public ResponseEntity<?> downloadReceiptPdf(@PathVariable("invoiceId") String invoiceId,
                                                @RequestAttribute("user") CustomUserDetails user) {
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null) {
            return ResponseEntity.notFound().build();
        }
        feeAccessGuard.requireStaffOrLearnerSide(user, invoice.getUserId(), invoice.getInstituteId());

        String pdfFileId = invoice.getPdfFileId();
        if (!StringUtils.hasText(pdfFileId)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "PDF not available for this receipt"));
        }

        String signedUrl = mediaService.getFilePublicUrlById(pdfFileId);
        if (!StringUtils.hasText(signedUrl)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to generate download URL"));
        }

        return ResponseEntity.ok(Map.of(
                "download_url", signedUrl,
                "invoice_number", invoice.getInvoiceNumber(),
                "file_name", "receipt_" + invoice.getInvoiceNumber() + ".pdf"
        ));
    }

    /**
     * Get receipt download URL for a specific paid installment.
     * Looks up the InvoiceLineItem where source_id = installmentId,
     * then returns the PDF download URL for the parent invoice.
     */
    @GetMapping("/installment/{installmentId}/receipt-url")
    public ResponseEntity<?> getReceiptUrlForInstallment(
            @PathVariable("installmentId") String installmentId,
            @RequestAttribute("user") CustomUserDetails user) {
        List<InvoiceLineItem> lineItems = invoiceLineItemRepository.findBySourceId(installmentId);
        if (lineItems.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Invoice invoice = lineItems.get(0).getInvoice();
        if (invoice != null) {
            feeAccessGuard.requireStaff(user, invoice.getInstituteId());
        }
        if (invoice == null || !StringUtils.hasText(invoice.getPdfFileId())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "No receipt PDF found for this installment"));
        }

        String downloadUrl = mediaService.getFilePublicUrlById(invoice.getPdfFileId());
        if (!StringUtils.hasText(downloadUrl)) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to generate download URL"));
        }

        return ResponseEntity.ok(Map.of(
                "invoice_id", invoice.getId(),
                "receipt_number", invoice.getInvoiceNumber(),
                "download_url", downloadUrl
        ));
    }

    /**
     * Generate an invoice/statement PDF for selected installments.
     * Returns the S3 file ID and download URL for the generated PDF.
     * Shows current status of each installment (PAID, PENDING, PARTIAL_PAID, etc.).
     */
    @PostMapping("/{userId}/generate-invoice")
    public ResponseEntity<?> generateInvoiceForInstallments(
            @PathVariable("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody Map<String, Object> request,
            @RequestAttribute("user") CustomUserDetails user) {

        @SuppressWarnings("unchecked")
        List<String> installmentIds = (List<String>) request.get("installment_ids");
        if (installmentIds == null || installmentIds.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "installment_ids is required"));
        }
        feeAccessGuard.requireStaffForBills(user, instituteId,
                studentFeePaymentRepository.findAllById(installmentIds));

        String pdfFileId = schoolFeeReceiptService.generateInvoiceForInstallments(
                userId, instituteId, installmentIds);

        String downloadUrl = mediaService.getFilePublicUrlById(pdfFileId);

        return ResponseEntity.ok(Map.of(
                "file_id", pdfFileId,
                "download_url", downloadUrl != null ? downloadUrl : ""
        ));
    }

    /**
     * Request body for filtering dues.
     * - status: optional status filter (e.g. "PENDING", "PARTIAL_PAID").
     * - startDueDate / endDueDate: optional due date range (yyyy-MM-dd).
     * - page / size: optional pagination. Defaults to page=0, size=10.
     * - fetchAll: when true, returns the full filtered list (no pagination). Used by "Select all filtered".
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @Getter
    @Setter
    public static class DuesFilterRequest {
        private String status;
        private LocalDate startDueDate;
        private LocalDate endDueDate;
        private Integer page;
        private Integer size;
        private Boolean fetchAll;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @Getter
    @Setter
    public static class StudentDuesPageResponse {
        private List<StudentFeePaymentDTO> content;
        private int pageNumber;
        private int pageSize;
        private long totalElements;
        private int totalPages;
        private BigDecimal totalFee;
        private BigDecimal totalPaid;
        private BigDecimal totalDue;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @Getter
    @Setter
    public static class AdjustmentSubmitRequest {
        private String studentFeePaymentId;
        private String userId;
        private BigDecimal adjustmentAmount;
        private String adjustmentType; // CONCESSION or PENALTY
        private String adjustmentReason;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @Getter
    @Setter
    public static class AdjustmentReviewRequest {
        private String studentFeePaymentId;
        private String action; // APPROVED or REJECTED
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @Getter
    @Setter
    public static class AdjustmentRetractRequest {
        private String studentFeePaymentId;
    }

}
