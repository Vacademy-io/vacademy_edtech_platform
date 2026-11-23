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
import static org.junit.jupiter.api.Assertions.assertFalse;
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
 * from the remaining tax, never twice, never after a full credit, and deferred when it fails.
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
    void theListLeavesRecentOrdersToTheirOwnTransactionCapsItsSizeAndLooksBackSevenDays() {
        when(f.orderRepository.findOrderIdsMissingInvoice(any(Date.class), any(Date.class), any(Date.class), anyInt()))
                .thenReturn(List.of(ORDER));
        long before = System.currentTimeMillis();
        assertEquals(List.of(ORDER), backlog.findOrderIdsMissingInvoice(10_000));
        long after = System.currentTimeMillis();
        ArgumentCaptor<Date> cutoff = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> since = ArgumentCaptor.forClass(Date.class);
        ArgumentCaptor<Date> now = ArgumentCaptor.forClass(Date.class);
        verify(f.orderRepository).findOrderIdsMissingInvoice(cutoff.capture(), since.capture(), now.capture(), eq(500));
        assertTrue(cutoff.getValue().getTime() <= before - CommerceOrderInvoiceBacklog.GRACE_MILLIS + 1000);
        long week = 7L * 24 * 60 * 60 * 1000;
        assertTrue(since.getValue().getTime() >= before - week && since.getValue().getTime() <= after - week,
                "only orders changed within the last 7 days are read");
        assertTrue(now.getValue().getTime() >= before && now.getValue().getTime() <= after,
                "orders deferred past now are left out");
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
        assertFalse(request.getValue().isAllowAfterFullCredit(),
                "the backlog never bills again an invoice that was credited in full");
        verify(f.orderRepository).clearSweep(ORDER);
    }

    @Test
    void aDeliveredOrderWhoseInvoiceWasCreditedInFullIsNeverInvoicedAgain() {
        f.order.setStatus("DELIVERED");
        // The invoice exists and was credited in full (by hand): no live document, but an invoice row.
        when(f.invoiceService.liveDocument(eq(INST), anyList())).thenReturn(Optional.empty());
        when(f.orderRepository.countInvoicesEver(ORDER)).thenReturn(1L);
        backlog.issueInvoiceFor(ORDER);
        verify(f.invoiceService, never()).issue(anyString(), any());
        verify(f.orderRepository, never()).deferSweep(anyString(), any());
    }

    @Test
    void anOrderWhoseRepairFailsCountsOneMoreFailureAndTheFailureStillSurfaces() {
        f.order.setStatus("PACKED");
        when(f.invoiceService.issue(anyString(), any())).thenThrow(new IllegalStateException("SELLER_GSTIN_MISSING"));
        when(f.orderRepository.sweepFailures(ORDER)).thenReturn(4);
        long before = System.currentTimeMillis();
        assertThrows(IllegalStateException.class, () -> backlog.issueInvoiceFor(ORDER));
        ArgumentCaptor<Date> now = ArgumentCaptor.forClass(Date.class);
        // The backoff (1 h, 4 h, 16 h, then 24 h) is worked out by the UPDATE from the stored count.
        verify(f.orderRepository).deferSweep(eq(ORDER), now.capture());
        assertTrue(now.getValue().getTime() >= before && now.getValue().getTime() <= System.currentTimeMillis());
        verify(f.orderRepository).sweepFailures(ORDER);
        verify(f.orderRepository, never()).clearSweep(anyString());
        assertEquals(4, CommerceOrderInvoiceBacklog.DAILY_AFTER_FAILURES);
    }

    @Test
    void aConfirmedOrderOlderThanTheLookbackIsStillServedAndTheQueryPutsHealthyOrdersFirst() throws Exception {
        String sql = vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository.class
                .getMethod("findOrderIdsMissingInvoice", Date.class, Date.class, Date.class, int.class)
                .getAnnotation(org.springframework.data.jpa.repository.Query.class).value();
        assertTrue(sql.contains("(o.status = 'CONFIRMED' OR o.updated_at >= :since)"), sql);
        assertTrue(sql.contains("ORDER BY o.sweep_failures ASC, o.updated_at ASC, o.id ASC"), sql);
        String defer = vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository.class
                .getMethod("deferSweep", String.class, Date.class)
                .getAnnotation(org.springframework.data.jpa.repository.Query.class).value();
        assertTrue(defer.contains("sweep_failures = sweep_failures + 1") && defer.contains("1440")
                && defer.contains("POWER(4, sweep_failures)"), defer);
    }

    @Test
    void aFailureToDeferDoesNotHideTheFailureOfTheRepair() {
        f.order.setStatus("PACKED");
        when(f.invoiceService.issue(anyString(), any())).thenThrow(new IllegalStateException("TAX_SNAPSHOT_STALE"));
        when(f.orderRepository.deferSweep(anyString(), any())).thenThrow(new IllegalStateException("db busy"));
        IllegalStateException thrown = assertThrows(IllegalStateException.class, () -> backlog.issueInvoiceFor(ORDER));
        assertEquals("TAX_SNAPSHOT_STALE", thrown.getMessage());
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
