package vacademy.io.admin_core_service.features.commerce.order.checkout;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;

import java.math.BigDecimal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Money that must go back is written to the list staff work from, not only to the log. */
class CommerceRefundHookTest {

    private CommercePaymentExceptionRepository exceptions;
    private CommerceRefundHook hook;

    @BeforeEach
    void setUp() {
        exceptions = mock(CommercePaymentExceptionRepository.class);
        hook = new CommerceRefundHook(exceptions);
    }

    @Test
    void anOversoldPaidOrderIsRecordedOncePerOrder() {
        hook.refundOversoldPaidOrder("inst-1", "order-1", "ORD-000007", new BigDecimal("1500.00"), "INR");

        // The payment id is empty, so the unique key (order, kind, payment) holds one row per order.
        verify(exceptions).record(anyString(), eq("inst-1"), eq("order-1"), eq("ORD-000007"), eq("OVERSOLD_PAID"),
                isNull(), eq(""), eq(new BigDecimal("1500.00")), eq("INR"), anyString());
    }

    @Test
    void aSecondPaymentIsRecordedWithThePaymentToGiveBack() {
        hook.refundDuplicatePayment("inst-1", "order-1", "ORD-000007", "order_rzp2", "pay_second",
                new BigDecimal("499.00"), "INR");

        verify(exceptions).record(anyString(), eq("inst-1"), eq("order-1"), eq("ORD-000007"),
                eq("DUPLICATE_PAYMENT"), eq("order_rzp2"), eq("pay_second"), eq(new BigDecimal("499.00")),
                eq("INR"), anyString());
    }

    @Test
    void aRecordThatCannotBeWrittenNeverReachesThePaymentPath() {
        when(exceptions.record(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalStateException("database down"));

        hook.refundOversoldPaidOrder("inst-1", "order-1", "ORD-000007", new BigDecimal("1500.00"), "INR");
        hook.refundDuplicatePayment("inst-1", "order-1", "ORD-000007", "order_rzp2", "pay_second",
                new BigDecimal("499.00"), "INR");
    }
}
