package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class InvoicePaymentMethodTest {

    @Test
    @DisplayName("An offline payment recorded with a mode prints the mode label and the admin's reference")
    void offlineWithMode() {
        PaymentLog log = new PaymentLog();
        log.setVendor("MANUAL");
        log.setVendorId("MANUAL");
        log.setPaymentMode("UPI");
        log.setPaymentSubMode("PHONEPE");
        log.setPaymentReference("UPI-77");
        log.setPaymentDetailsJson("{\"mode_label\":\"UPI\",\"sub_mode_label\":\"PhonePe\"}");
        assertEquals("UPI · PhonePe", InvoiceService.invoicePaymentMethod(log));
        assertEquals("UPI-77", InvoiceService.invoiceTransactionId(log));
    }

    @Test
    @DisplayName("Gateway payments and offline payments without a mode print as before")
    void unchangedOtherwise() {
        PaymentLog gateway = new PaymentLog();
        gateway.setVendor("RAZORPAY");
        gateway.setVendorId("pay_123");
        assertEquals("RAZORPAY", InvoiceService.invoicePaymentMethod(gateway));
        assertEquals("pay_123", InvoiceService.invoiceTransactionId(gateway));

        PaymentLog codesOnly = new PaymentLog();
        codesOnly.setVendor("MANUAL");
        codesOnly.setPaymentMode("CHEQUE");
        assertEquals("CHEQUE", InvoiceService.invoicePaymentMethod(codesOnly));
    }

    @Test
    @DisplayName("receiptDateField reads that mode field's date; anything else keeps the recorded date")
    void paymentDetailsDate() {
        PaymentLog log = new PaymentLog();
        log.setPaymentDetailsJson("{\"mode_label\":\"PhonePe\",\"custom_fields\":["
                + "{\"key\":\"transaction_date\",\"label\":\"Transaction Date\",\"value\":\"2026-10-28\"}]}");
        assertEquals(LocalDate.of(2026, 10, 28).atStartOfDay(),
                InvoiceService.paymentDetailsDate(log, "transaction_date"));

        assertNull(InvoiceService.paymentDetailsDate(log, null));
        assertNull(InvoiceService.paymentDetailsDate(log, ""));
        assertNull(InvoiceService.paymentDetailsDate(log, "cheque_dd_date"));

        PaymentLog blank = new PaymentLog();
        blank.setPaymentDetailsJson("{\"custom_fields\":[{\"key\":\"transaction_date\",\"value\":\"\"}]}");
        assertNull(InvoiceService.paymentDetailsDate(blank, "transaction_date"));

        PaymentLog notDate = new PaymentLog();
        notDate.setPaymentDetailsJson("{\"custom_fields\":[{\"key\":\"transaction_date\",\"value\":\"yesterday\"}]}");
        assertNull(InvoiceService.paymentDetailsDate(notDate, "transaction_date"));

        assertNull(InvoiceService.paymentDetailsDate(new PaymentLog(), "transaction_date"));
        assertNull(InvoiceService.paymentDetailsDate(null, "transaction_date"));
    }
}
