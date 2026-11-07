package vacademy.io.admin_core_service.features.fee_management.controller;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.fee_management.dto.CollectionDashboardRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.FeeSearchFilterDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.SelectiveAllocationRequest;
import vacademy.io.admin_core_service.features.fee_management.dto.SetPriorityRequest;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.InstituteFeeTypePriorityRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.service.AdjustmentHistoryQueryService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeAccessGuard;
import vacademy.io.admin_core_service.features.fee_management.service.FeeLedgerAllocationService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeTrackingService;
import vacademy.io.admin_core_service.features.fee_management.service.SchoolFeeReceiptService;
import vacademy.io.admin_core_service.features.fee_management.service.StudentFeeAdjustmentService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Every /v1/admin/student-fee route consults {@link FeeAccessGuard} before touching any service,
 * and entity-only routes check against the institute resolved from the entity (not the request).
 */
class FeeTrackingAdminControllerGuardTest {

    private static final String INSTITUTE = "inst-1";
    private static final String LEARNER = "learner-1";

    private final FeeTrackingService feeTrackingService = mock(FeeTrackingService.class);
    private final FeeLedgerAllocationService allocationService = mock(FeeLedgerAllocationService.class);
    private final InstituteFeeTypePriorityRepository priorityRepository = mock(InstituteFeeTypePriorityRepository.class);
    private final InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
    private final InvoiceLineItemRepository lineItemRepository = mock(InvoiceLineItemRepository.class);
    private final MediaService mediaService = mock(MediaService.class);
    private final SchoolFeeReceiptService receiptService = mock(SchoolFeeReceiptService.class);
    private final StudentFeeAdjustmentService adjustmentService = mock(StudentFeeAdjustmentService.class);
    private final AdjustmentHistoryQueryService historyService = mock(AdjustmentHistoryQueryService.class);
    private final StudentFeePaymentRepository billRepository = mock(StudentFeePaymentRepository.class);
    private final FeeAccessGuard guard = mock(FeeAccessGuard.class);
    private final CustomUserDetails caller = new CustomUserDetails();
    private final FeeTrackingAdminController controller = new FeeTrackingAdminController();

    FeeTrackingAdminControllerGuardTest() {
        ReflectionTestUtils.setField(controller, "feeTrackingService", feeTrackingService);
        ReflectionTestUtils.setField(controller, "feeLedgerAllocationService", allocationService);
        ReflectionTestUtils.setField(controller, "priorityRepository", priorityRepository);
        ReflectionTestUtils.setField(controller, "invoiceRepository", invoiceRepository);
        ReflectionTestUtils.setField(controller, "invoiceLineItemRepository", lineItemRepository);
        ReflectionTestUtils.setField(controller, "mediaService", mediaService);
        ReflectionTestUtils.setField(controller, "schoolFeeReceiptService", receiptService);
        ReflectionTestUtils.setField(controller, "studentFeeAdjustmentService", adjustmentService);
        ReflectionTestUtils.setField(controller, "adjustmentHistoryQueryService", historyService);
        ReflectionTestUtils.setField(controller, "studentFeePaymentRepository", billRepository);
        ReflectionTestUtils.setField(controller, "feeAccessGuard", guard);
    }

    private static ForbiddenException denied() {
        return new ForbiddenException("no");
    }

    private void verifyNoServiceTouched() {
        verifyNoInteractions(feeTrackingService, allocationService, priorityRepository, mediaService,
                receiptService, adjustmentService, historyService);
    }

    @Test
    void staffOnlyInstituteRoutesAreChecked() {
        doThrow(denied()).when(guard).requireStaff(caller, INSTITUTE);
        CollectionDashboardRequestDTO dashboard = new CollectionDashboardRequestDTO();
        dashboard.setInstituteId(INSTITUTE);
        SetPriorityRequest priority = new SetPriorityRequest();
        priority.setScope("ALL_DUES");
        priority.setPriorities(List.of());

        assertThrows(ForbiddenException.class, () -> controller.getStudentReceipts(LEARNER, INSTITUTE, caller));
        assertThrows(ForbiddenException.class, () -> controller.searchStudentFeePayments(INSTITUTE, new FeeSearchFilterDTO(), caller));
        assertThrows(ForbiddenException.class, () -> controller.getCollectionDashboard(dashboard, caller));
        assertThrows(ForbiddenException.class, () -> controller.getFeeTypesForInstitute(INSTITUTE, caller));
        assertThrows(ForbiddenException.class, () -> controller.setFeeTypePriority(INSTITUTE, priority, caller));
        assertThrows(ForbiddenException.class, () -> controller.getFeeTypePriority(INSTITUTE, "ALL_DUES", caller));
        assertThrows(ForbiddenException.class, () -> controller.getPendingAdjustments(INSTITUTE, caller));
        assertThrows(ForbiddenException.class, () -> controller.getInstituteAdjustmentHistory(null, INSTITUTE, caller));
        verifyNoServiceTouched();
    }

    @Test
    void parentPortalReadsUseTheLearnerSideRule() {
        doThrow(denied()).when(guard).requireStaffOrLearnerSide(caller, LEARNER, INSTITUTE);
        assertThrows(ForbiddenException.class, () -> controller.getStudentDues(LEARNER, INSTITUTE, null, caller));
        assertThrows(ForbiddenException.class, () -> controller.getStudentInvoiceReceipts(LEARNER, INSTITUTE, caller));
        verifyNoServiceTouched();
    }

    @Test
    void receiptDownloadChecksTheInvoiceOwnerAndInstitute() {
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setUserId(LEARNER);
        invoice.setInstituteId(INSTITUTE);
        invoice.setPdfFileId("file-1");
        when(invoiceRepository.findById("inv-1")).thenReturn(Optional.of(invoice));
        doThrow(denied()).when(guard).requireStaffOrLearnerSide(caller, LEARNER, INSTITUTE);
        assertThrows(ForbiddenException.class, () -> controller.downloadReceiptPdf("inv-1", caller));
        verifyNoInteractions(mediaService);
    }

    @Test
    void installmentReceiptUrlChecksTheInvoiceInstitute() {
        Invoice invoice = new Invoice();
        invoice.setInstituteId("inst-of-invoice");
        invoice.setPdfFileId("file-1");
        InvoiceLineItem line = new InvoiceLineItem();
        line.setInvoice(invoice);
        when(lineItemRepository.findBySourceId("bill-1")).thenReturn(List.of(line));
        doThrow(denied()).when(guard).requireStaff(caller, "inst-of-invoice");
        assertThrows(ForbiddenException.class, () -> controller.getReceiptUrlForInstallment("bill-1", caller));
        verifyNoInteractions(mediaService);
    }

    @Test
    void writesAreChecked() {
        doThrow(denied()).when(guard).requireStaffForBills(eq(caller), eq(INSTITUTE), anyCollection());
        doThrow(denied()).when(guard).requireStaffOfBillsInstitute(eq(caller), anyCollection(), any());

        SelectiveAllocationRequest selected = new SelectiveAllocationRequest();
        selected.setInstituteId(INSTITUTE);
        selected.setStudentFeePaymentIds(List.of("bill-1"));
        selected.setAmount(BigDecimal.TEN);
        assertThrows(ForbiddenException.class, () -> controller.allocatePaymentForSelectedInstallments(LEARNER, selected, caller));
        assertThrows(ForbiddenException.class,
                () -> controller.allocatePaymentForUser(LEARNER, BigDecimal.TEN, INSTITUTE, "ALL_DUES", caller));
        assertThrows(ForbiddenException.class, () -> controller.generateInvoiceForInstallments(LEARNER, INSTITUTE,
                Map.of("installment_ids", List.of("bill-1")), caller));

        FeeTrackingAdminController.AdjustmentSubmitRequest submit = new FeeTrackingAdminController.AdjustmentSubmitRequest();
        submit.setStudentFeePaymentId("bill-1");
        submit.setUserId(LEARNER);
        submit.setAdjustmentType("CONCESSION");
        submit.setAdjustmentAmount(BigDecimal.ONE);
        FeeTrackingAdminController.AdjustmentReviewRequest review = new FeeTrackingAdminController.AdjustmentReviewRequest();
        review.setStudentFeePaymentId("bill-1");
        review.setAction("APPROVED");
        FeeTrackingAdminController.AdjustmentRetractRequest retract = new FeeTrackingAdminController.AdjustmentRetractRequest();
        retract.setStudentFeePaymentId("bill-1");
        assertThrows(ForbiddenException.class, () -> controller.submitAdjustment(submit, INSTITUTE, caller));
        assertThrows(ForbiddenException.class, () -> controller.reviewAdjustment(review, INSTITUTE, caller));
        assertThrows(ForbiddenException.class, () -> controller.retractAdjustment(retract, INSTITUTE, caller));
        verifyNoServiceTouched();
    }

    @Test
    void adjustmentWritesCheckTheBillItself() {
        StudentFeePayment bill = new StudentFeePayment();
        bill.setId("bill-1");
        bill.setInstituteId("inst-2");
        when(billRepository.findById("bill-1")).thenReturn(Optional.of(bill));
        FeeTrackingAdminController.AdjustmentRetractRequest retract = new FeeTrackingAdminController.AdjustmentRetractRequest();
        retract.setStudentFeePaymentId("bill-1");
        when(adjustmentService.retractAdjustment("bill-1", INSTITUTE, caller))
                .thenReturn(new StudentFeeAdjustmentService.AdjustmentResult(bill, null));

        controller.retractAdjustment(retract, INSTITUTE, caller);

        verify(guard).requireStaffForBills(caller, INSTITUTE, List.of(bill));
    }

    @Test
    void installmentHistoryChecksTheBillsInstitute() {
        StudentFeePayment bill = new StudentFeePayment();
        bill.setId("bill-1");
        bill.setInstituteId("inst-2");
        when(billRepository.findById("bill-1")).thenReturn(Optional.of(bill));
        doThrow(denied()).when(guard).requireStaffOfBillsInstitute(caller, List.of(bill), null);
        assertThrows(ForbiddenException.class, () -> controller.getAdjustmentHistory("bill-1", 0, 20, caller));
        verifyNoInteractions(historyService);
    }

    @Test
    void paymentDetailsChecksThePaymentOptionsInstitute() {
        doThrow(denied()).when(guard).requireStaffOfPaymentOption(caller, "cpo-1");
        assertThrows(ForbiddenException.class, () -> controller.getPaymentDetails(LEARNER, "cpo-1", caller));
        verifyNoInteractions(feeTrackingService);
    }

    @Test
    void allowedReadReachesTheService() {
        controller.getFeeTypesForInstitute(INSTITUTE, caller);
        verify(guard).requireStaff(caller, INSTITUTE);
        verify(feeTrackingService).getFeeTypesForInstitute(anyString());
    }
}
