package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.enums.InvoicePdfPlacement;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * A synchronous gateway (eWay) charges inside the enrolment transaction. Generating the invoice
 * there made its REQUIRES_NEW save hit the payment_log foreign key on the still-uncommitted log,
 * which poisoned and rolled back the whole enrolment. The invoice must wait for the commit.
 */
class SyncPaymentInvoiceAfterCommitTest {

    private PaymentLogService service;
    private InvoiceService invoiceService;
    private PaymentNotificatonService notifications;
    private PaymentLog paymentLog;

    @BeforeEach
    void setUp() {
        service = new PaymentLogService();
        invoiceService = mock(InvoiceService.class);
        notifications = mock(PaymentNotificatonService.class);
        PaymentLogRepository repo = mock(PaymentLogRepository.class);
        AuthService auth = mock(AuthService.class);
        paymentLog = new PaymentLog();
        paymentLog.setId("pl-1");
        paymentLog.setUserId("u-1");
        paymentLog.setPaymentAmount(431.0);
        paymentLog.setCurrency("AUD");
        when(repo.findById("pl-1")).thenReturn(Optional.of(paymentLog));
        UserDTO user = new UserDTO();
        user.setId("u-1");
        user.setEmail("u@example.com");
        when(auth.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(List.of(user));
        ReflectionTestUtils.setField(service, "invoiceService", invoiceService);
        ReflectionTestUtils.setField(service, "paymentLogRepository", repo);
        ReflectionTestUtils.setField(service, "authService", auth);
        ReflectionTestUtils.setField(service, "paymentNotificatonService", notifications);
        ReflectionTestUtils.setField(service, "transactionManager", mock(PlatformTransactionManager.class));
        Invoice invoice = new Invoice();
        invoice.setInvoiceNumber("INV-1");
        when(invoiceService.generateInvoiceWithResultForCommittedPayment(eq("pl-1"), eq("inst"), anyBoolean()))
                .thenReturn(new InvoiceService.InvoiceGenerationResult(invoice, new byte[] {1}, false));
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    private static void commit() {
        for (TransactionSynchronization s : TransactionSynchronizationManager.getSynchronizations()) {
            s.afterCommit();
        }
    }

    @Test
    @DisplayName("inside a transaction nothing is invoiced until it commits; then invoice + one confirmation")
    void waitsForCommit() {
        when(invoiceService.getInvoicePdfPlacement("inst")).thenReturn(InvoicePdfPlacement.PAYMENT_CONFIRMATION_EMAIL);
        TransactionSynchronizationManager.initSynchronization();

        service.scheduleSyncInvoiceAfterCommit(paymentLog, "inst");
        verify(invoiceService, never()).generateInvoiceWithResultForCommittedPayment(any(), any(), anyBoolean());
        verifyNoInteractions(notifications);

        commit();
        // consolidated mode: the separate invoice email is suppressed ...
        verify(invoiceService).generateInvoiceWithResultForCommittedPayment("pl-1", "inst", false);
        // ... and the single confirmation carries the PDF
        verify(notifications).sendPaymentConfirmationNotification(eq("inst"), any(), any(), any(),
                eq(new byte[] {1}), eq("INV-1"), any(), any());
    }

    @Test
    @DisplayName("separate-invoice-email mode sends no confirmation from here")
    void invoiceEmailMode() {
        when(invoiceService.getInvoicePdfPlacement("inst")).thenReturn(InvoicePdfPlacement.INVOICE_EMAIL);
        TransactionSynchronizationManager.initSynchronization();
        service.scheduleSyncInvoiceAfterCommit(paymentLog, "inst");
        commit();
        verify(invoiceService).generateInvoiceWithResultForCommittedPayment("pl-1", "inst", true);
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("an invoice failure after commit is contained — the payment stands")
    void failureContained() {
        when(invoiceService.getInvoicePdfPlacement("inst")).thenReturn(InvoicePdfPlacement.PAYMENT_CONFIRMATION_EMAIL);
        when(invoiceService.generateInvoiceWithResultForCommittedPayment(any(), any(), anyBoolean()))
                .thenThrow(new RuntimeException("pdf failed"));
        TransactionSynchronizationManager.initSynchronization();
        service.scheduleSyncInvoiceAfterCommit(paymentLog, "inst");
        commit(); // must not throw
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("with no transaction active it runs straight away")
    void noTransaction() {
        when(invoiceService.getInvoicePdfPlacement("inst")).thenReturn(InvoicePdfPlacement.INVOICE_EMAIL);
        service.scheduleSyncInvoiceAfterCommit(paymentLog, "inst");
        verify(invoiceService).generateInvoiceWithResultForCommittedPayment("pl-1", "inst", true);
    }
}
