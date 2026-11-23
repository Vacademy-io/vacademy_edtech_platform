package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.returns.service.CommerceRefundService;

import java.math.BigDecimal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Money that must go back without a person deciding: the exception row staff work from, then the
 * refund row (oversold: the order's whole payment; duplicate: the second payment). A desk event
 * writes no row. The hook never throws.
 */
@SuppressWarnings("unchecked")
class CommerceRefundHookTest {

    private CommercePaymentExceptionRepository exceptions;
    private CommerceRefundService refunds;
    private CommerceRefundHook hook;

    @BeforeEach
    void setUp() {
        exceptions = mock(CommercePaymentExceptionRepository.class);
        refunds = mock(CommerceRefundService.class);
        ObjectProvider<CommerceRefundService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(refunds);
        hook = new CommerceRefundHook(exceptions, provider);
    }

    @Test
    void anOversoldPaidOrderIsRecordedOncePerOrderAndGetsItsOrderRefund() {
        when(refunds.autoOversold("inst-1", "order-1")).thenReturn("refund-1");
        hook.refundOversoldPaidOrder("inst-1", "order-1", "ORD-000007", new BigDecimal("1500.00"), "INR");

        // The payment id is empty, so the unique key (order, kind, payment) holds one row per order.
        verify(exceptions).record(anyString(), eq("inst-1"), eq("order-1"), eq("ORD-000007"), eq("OVERSOLD_PAID"),
                isNull(), eq(""), eq(new BigDecimal("1500.00")), eq("INR"), anyString());
        // Due raised and an ORDER refund through the gateway, made in the service's own transaction.
        verify(refunds).autoOversold("inst-1", "order-1");
    }

    @Test
    void aSecondPaymentIsRecordedAndGetsAnExtraPaymentRefundOfThatPayment() {
        when(refunds.autoDuplicate("inst-1", "order-1", "pay_second", new BigDecimal("499.00")))
                .thenReturn("refund-2");
        hook.refundDuplicatePayment("inst-1", "order-1", "ORD-000007", "order_rzp2", "pay_second",
                new BigDecimal("499.00"), "INR");

        verify(exceptions).record(anyString(), eq("inst-1"), eq("order-1"), eq("ORD-000007"),
                eq("DUPLICATE_PAYMENT"), eq("order_rzp2"), eq("pay_second"), eq(new BigDecimal("499.00")),
                eq("INR"), anyString());
        verify(refunds).autoDuplicate("inst-1", "order-1", "pay_second", new BigDecimal("499.00"));
    }

    @Test
    void anOversoldOrderWithoutAPaymentIdKeepsOnlyItsExceptionRow() {
        when(refunds.autoOversold("inst-1", "order-1")).thenReturn(null);
        hook.refundOversoldPaidOrder("inst-1", "order-1", "ORD-000007", new BigDecimal("1500.00"), "INR");
        verify(exceptions).record(anyString(), eq("inst-1"), eq("order-1"), any(), eq("OVERSOLD_PAID"), any(),
                eq(""), any(), any(), anyString());
        verify(exceptions, never()).linkRefund(any(), any(), any(), any());
    }

    @Test
    void aFailureOfTheRecordOrTheRefundNeverReachesThePaymentPath() {
        when(exceptions.record(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("database down"));
        when(refunds.autoOversold(any(), any())).thenThrow(new IllegalStateException("lock timeout"));
        when(refunds.autoDuplicate(any(), any(), any(), any())).thenThrow(new IllegalStateException("lock timeout"));

        hook.refundOversoldPaidOrder("inst-1", "order-1", "ORD-000007", new BigDecimal("1500.00"), "INR");
        hook.refundDuplicatePayment("inst-1", "order-1", "ORD-000007", "order_rzp2", "pay_second",
                new BigDecimal("499.00"), "INR");
    }

    @Test
    void moneyDueBackAfterADeskActionWritesNoRow() {
        hook.refundDue("inst-1", "order-1", "ORD-000007", "LCAN:line-1:2", new BigDecimal("250.00"), "INR",
                "A line of the paid order was cancelled.");
        hook.refundDue("inst-1", "order-1", "ORD-000007", "RTO:sh-1", BigDecimal.ZERO, "INR", "nothing");
        hook.refundDue("inst-1", "order-1", "ORD-000007", "RTO:sh-1", null, "INR", "nothing");
        verifyNoInteractions(exceptions);
        verifyNoInteractions(refunds);
    }
}
