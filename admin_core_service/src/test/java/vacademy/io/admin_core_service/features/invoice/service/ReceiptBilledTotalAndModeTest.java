package vacademy.io.admin_core_service.features.invoice.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

class ReceiptBilledTotalAndModeTest {

    @Test
    @DisplayName("Total fees is what the schedule bills after discount, not the list price")
    void billedTotalPrefersSchedule() {
        // list price 10,000, schedule 5,000 + 3,000 after discount
        assertEquals(new BigDecimal("8000.00"),
                InvoiceService.billedTotal(new BigDecimal("10000"), new BigDecimal("8000.00")));
        // no discount: same as before
        assertEquals(new BigDecimal("10000"),
                InvoiceService.billedTotal(new BigDecimal("10000"), new BigDecimal("10000")));
    }

    @Test
    @DisplayName("Without a schedule the plan price is still used")
    void billedTotalFallsBackToPlan() {
        assertEquals(new BigDecimal("10000"), InvoiceService.billedTotal(new BigDecimal("10000"), BigDecimal.ZERO));
        assertEquals(new BigDecimal("10000"), InvoiceService.billedTotal(new BigDecimal("10000"), null));
        assertNull(InvoiceService.billedTotal(null, BigDecimal.ZERO));
    }

    private static PaymentLog log(String mode, String json, String vendor) {
        PaymentLog log = new PaymentLog();
        log.setPaymentMode(mode);
        log.setPaymentDetailsJson(json);
        log.setVendor(vendor);
        return log;
    }

    @Test
    @DisplayName("Payment mode prints the mode label only, never the account")
    void paymentModeIsLabelOnly() {
        PaymentLog cash = log("CASH", "{\"mode_label\":\"Cash\",\"sub_mode_label\":\"Cash account A\"}", "OFFLINE");
        assertEquals("Cash", InvoiceService.invoicePaymentMode(cash, "Cash · Cash account A"));
        assertEquals("GOOGLE_PAY", InvoiceService.invoicePaymentMode(log("GOOGLE_PAY", "not json", "OFFLINE"), null));
        assertEquals("GOOGLE_PAY", InvoiceService.invoicePaymentMode(log("GOOGLE_PAY", null, "OFFLINE"), null));
    }

    @Test
    @DisplayName("No recorded mode: the gateway, else the mode part of the stored method")
    void paymentModeFallbacks() {
        assertEquals("RAZORPAY", InvoiceService.invoicePaymentMode(log(null, null, "RAZORPAY"), null));
        assertEquals("Cheque", InvoiceService.invoicePaymentMode(null, "Cheque · Account B"));
        assertEquals("Cash", InvoiceService.invoicePaymentMode(null, "Cash"));
        assertNull(InvoiceService.invoicePaymentMode(null, null));
    }
}
