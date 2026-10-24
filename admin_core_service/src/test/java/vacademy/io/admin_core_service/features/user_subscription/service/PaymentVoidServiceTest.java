package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeeAllocationLedgerRepository;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentVoidResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Voiding a mistaken offline payment must put back everything recording it moved — and must
 * refuse anything it cannot undo safely.
 */
class PaymentVoidServiceTest {

    private static final String INSTITUTE = "inst-vasco";

    private PaymentLogRepository paymentLogRepository;
    private StudentFeeAllocationLedgerRepository allocationRepository;
    private StudentFeePaymentRepository sfpRepository;
    private InvoiceService invoiceService;
    private UserAccountLedgerService ledgerService;
    private FacultySubjectPackageSessionMappingRepository facultyRepository;
    private PaymentVoidService service;

    private final Map<String, StudentFeePayment> sfps = new HashMap<>();

    @BeforeEach
    void setUp() {
        paymentLogRepository = mock(PaymentLogRepository.class);
        allocationRepository = mock(StudentFeeAllocationLedgerRepository.class);
        sfpRepository = mock(StudentFeePaymentRepository.class);
        InvoicePaymentLogMappingRepository mappingRepository = mock(InvoicePaymentLogMappingRepository.class);
        invoiceService = mock(InvoiceService.class);
        ledgerService = mock(UserAccountLedgerService.class);
        facultyRepository = mock(FacultySubjectPackageSessionMappingRepository.class);

        when(sfpRepository.findById(anyString())).thenAnswer(inv -> Optional.ofNullable(sfps.get(inv.getArgument(0))));
        when(mappingRepository.findAllByPaymentLogId(anyString())).thenReturn(List.of());
        when(invoiceService.unwindInvoicesForVoidedPayment(anyString(), any(), any())).thenReturn(1);
        when(ledgerService.reverseCreditsForVoidedPayment(anyString(), anyString())).thenReturn(new BigDecimal("25000"));
        when(facultyRepository.findDistinctSubOrgIdsByUserAndLinkage(anyString(), any())).thenReturn(List.of());

        service = new PaymentVoidService(paymentLogRepository, allocationRepository, sfpRepository,
                mappingRepository, invoiceService, ledgerService, facultyRepository,
                mock(vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository.class));
    }

    private PaymentLog payment(String vendor, String paymentStatus, String instituteId) {
        EnrollInvite invite = new EnrollInvite();
        invite.setInstituteId(instituteId);
        UserPlan plan = new UserPlan();
        plan.setId("plan-1");
        plan.setEnrollInvite(invite);
        PaymentLog log = new PaymentLog();
        log.setId("pl-1");
        log.setVendor(vendor);
        log.setStatus("SUCCESS");
        log.setPaymentStatus(paymentStatus);
        log.setPaymentAmount(25000d);
        log.setCurrency("INR");
        log.setUserPlan(plan);
        log.setPaymentSpecificData("{\"source\":\"SIDE_VIEW_CPO\",\"transaction_id\":\"cash\"}");
        when(paymentLogRepository.findById("pl-1")).thenReturn(Optional.of(log));
        return log;
    }

    private StudentFeePayment bill(String id, String expected, String paid, String status) {
        StudentFeePayment sfp = new StudentFeePayment();
        sfp.setId(id);
        sfp.setAmountExpected(new BigDecimal(expected));
        sfp.setAmountPaid(new BigDecimal(paid));
        sfp.setStatus(status);
        sfp.setInstituteId(INSTITUTE);
        sfps.put(id, sfp);
        return sfp;
    }

    private StudentFeeAllocationLedger allocation(String sfpId, String amount) {
        StudentFeeAllocationLedger a = new StudentFeeAllocationLedger();
        a.setPaymentLogId("pl-1");
        a.setStudentFeePaymentId(sfpId);
        a.setAmountAllocated(new BigDecimal(amount));
        a.setAllocationType("PAYMENT");
        a.setRemarks("[NEW FLOW] Auto-allocated via FIFO");
        return a;
    }

    @Test
    @DisplayName("gives the installments back what the payment paid, reverses the credit, marks it VOIDED")
    void voidsAnOfflinePayment() {
        PaymentLog log = payment("MANUAL", "PAID", INSTITUTE);
        StudentFeePayment first = bill("i1", "18571.43", "18571.43", "PAID");
        StudentFeePayment second = bill("i2", "37142.86", "11785.71", "PARTIAL_PAID");
        StudentFeeAllocationLedger a1 = allocation("i1", "13214.29");
        StudentFeeAllocationLedger a2 = allocation("i2", "11785.71");
        when(allocationRepository.findByPaymentLogId("pl-1")).thenReturn(List.of(a1, a2));

        PaymentVoidResultDTO result = service.voidPayment("pl-1", INSTITUTE, "entered twice", "admin-1");

        assertEquals(0, new BigDecimal("5357.14").compareTo(first.getAmountPaid()));
        assertEquals("PARTIAL_PAID", first.getStatus());
        assertEquals(0, BigDecimal.ZERO.compareTo(second.getAmountPaid()));
        assertEquals("PENDING", second.getStatus());
        assertEquals("VOIDED", a1.getAllocationType());
        assertTrue(a1.getRemarks().contains("entered twice"));

        assertEquals("VOIDED", log.getPaymentStatus());
        assertEquals("VOIDED", log.getStatus());
        assertTrue(log.getPaymentSpecificData().contains("\"void_reason\":\"entered twice\""));
        assertTrue(log.getPaymentSpecificData().contains("\"transaction_id\":\"cash\""), "keeps the original data");
        verify(invoiceService).unwindInvoicesForVoidedPayment("pl-1", "entered twice", "admin-1");
        verify(ledgerService).reverseCreditsForVoidedPayment(eq("pl-1"), anyString());

        assertEquals(2, result.getInstallmentsReopened());
        assertEquals(1, result.getInvoicesUpdated());
        assertEquals(0, new BigDecimal("25000").compareTo(result.getCreditReversed()));
    }

    @Test
    @DisplayName("refuses a gateway payment — that is a refund, not a void")
    void refusesGatewayPayment() {
        PaymentLog log = payment("RAZORPAY", "PAID", INSTITUTE);
        assertThrows(VacademyException.class, () -> service.voidPayment("pl-1", INSTITUTE, null, "admin-1"));
        assertEquals("PAID", log.getPaymentStatus());
        verify(ledgerService, never()).reverseCreditsForVoidedPayment(anyString(), anyString());
    }

    @Test
    @DisplayName("refuses another institute's payment, an unpaid one, and a second void")
    void refusesWhatItCannotUndo() {
        payment("MANUAL", "PAID", "some-other-institute");
        when(allocationRepository.findByPaymentLogId("pl-1")).thenReturn(List.of());
        assertThrows(VacademyException.class, () -> service.voidPayment("pl-1", INSTITUTE, null, "admin-1"));

        payment("MANUAL", "PAYMENT_PENDING", INSTITUTE);
        assertThrows(VacademyException.class, () -> service.voidPayment("pl-1", INSTITUTE, null, "admin-1"));

        payment("OFFLINE", "VOIDED", INSTITUTE);
        assertThrows(VacademyException.class, () -> service.voidPayment("pl-1", INSTITUTE, null, "admin-1"));

        verify(invoiceService, never()).unwindInvoicesForVoidedPayment(anyString(), any(), any());
    }

    @Test
    @DisplayName("a sub-org admin cannot void the parent institute's collections")
    void refusesSubOrgAdmin() {
        payment("MANUAL", "PAID", INSTITUTE);
        when(facultyRepository.findDistinctSubOrgIdsByUserAndLinkage(eq("suborg-admin"), any()))
                .thenReturn(List.of("sub-1"));
        assertThrows(VacademyException.class, () -> service.voidPayment("pl-1", INSTITUTE, null, "suborg-admin"));
    }
}
