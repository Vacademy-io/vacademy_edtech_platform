package vacademy.io.admin_core_service.features.commerce.order.desk;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;

import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.INST;
import static vacademy.io.admin_core_service.features.commerce.order.desk.DeskFixture.ORDER;

/**
 * The retry job's source of orders without an invoice: packed, shipped and delivered orders,
 * and confirmed ones of a shop that invoices at confirmation; each issued under the order lock
 * from the remaining tax, never twice.
 */
class CommerceOrderInvoiceBacklogTest {

    private DeskFixture f;
    private CommerceTaxSettingService taxSettings;
    private CommerceOrderInvoiceBacklog backlog;

    @BeforeEach
    void setUp() {
        f = new DeskFixture();
        taxSettings = mock(CommerceTaxSettingService.class);
        backlog = new CommerceOrderInvoiceBacklog(f.orderRepository, f.desk, taxSettings, f.transactionManager);
        f.line("l1", 2, "1000.00");
        f.snapshot();
        invoiceAt(InvoiceAt.PACKED);
    }

    private void invoiceAt(InvoiceAt at) {
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder().invoiceAt(at).build());
    }

    @Test
    void theListLeavesRecentOrdersToTheirOwnTransactionAndCapsItsSize() {
        when(f.orderRepository.findOrderIdsMissingInvoice(any(Date.class), anyInt())).thenReturn(List.of(ORDER));
        long before = System.currentTimeMillis();
        assertEquals(List.of(ORDER), backlog.findOrderIdsMissingInvoice(10_000));
        ArgumentCaptor<Date> cutoff = ArgumentCaptor.forClass(Date.class);
        verify(f.orderRepository).findOrderIdsMissingInvoice(cutoff.capture(), eq(500));
        assertTrue(cutoff.getValue().getTime() <= before - CommerceOrderInvoiceBacklog.GRACE_MILLIS + 1000);
    }

    @Test
    void aPackedOrderWithoutInvoiceGetsOneUnderItsLock() {
        f.order.setStatus("SHIPPED");
        backlog.issueInvoiceFor(ORDER);
        verify(f.orderRepository).lockById(ORDER);
        ArgumentCaptor<CommerceInvoiceRequest> request = ArgumentCaptor.forClass(CommerceInvoiceRequest.class);
        verify(f.invoiceService).issue(eq(INST), request.capture());
        assertEquals(ORDER, request.getValue().getCommerceOrderId());
        assertEquals(0, request.getValue().getTax().getTotal().compareTo(f.order.getTotal()));
    }

    @Test
    void aConfirmedOrderIsDueOnlyWhenTheShopInvoicesAtConfirmation() {
        f.order.setStatus("CONFIRMED");
        backlog.issueInvoiceFor(ORDER);
        verify(f.invoiceService, never()).issue(anyString(), any());
        invoiceAt(InvoiceAt.CONFIRMED);
        backlog.issueInvoiceFor(ORDER);
        verify(f.invoiceService).issue(eq(INST), any());
    }

    @Test
    void anOrderThatMovedOnOrGotItsInvoiceMeanwhileIsLeftAlone() {
        f.order.setStatus("CANCELLED");
        backlog.issueInvoiceFor(ORDER);
        f.order.setStatus("PACKED");
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.of(new Invoice()));
        backlog.issueInvoiceFor(ORDER);
        verify(f.invoiceService, never()).issue(anyString(), any());
        when(f.orderRepository.findById("gone")).thenReturn(Optional.empty());
        assertThrows(IllegalStateException.class, () -> backlog.issueInvoiceFor("gone"));
    }
}
