package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.OrderAmountSummary;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Which payment logs are allowed to speak for their whole ORDER in the
 * confirmation email.
 *
 * A product-page checkout splits the real total across a child log per course,
 * so the log that sends the email knows only its share — it must quote the
 * invoice instead. Two other shapes reach the same code and must NOT:
 *
 *  - a single-course invoice, where the log's amount already IS the order;
 *  - a legacy multi-package order, where MultiPackageLearnerEnrollService copies
 *    the whole order total onto every child and the invoice is priced from plan
 *    LIST prices. Quoting the invoice there would announce the un-discounted sum
 *    as the amount paid.
 *
 * The discriminator is that only a genuine share is strictly less than the order.
 */
class OrderAmountSummaryGuardTest {

    private final PaymentLogService service = new PaymentLogService();

    private static Invoice invoice(double total, double discount) {
        Invoice inv = new Invoice();
        inv.setTotalAmount(BigDecimal.valueOf(total));
        inv.setDiscountAmount(BigDecimal.valueOf(discount));
        return inv;
    }

    private static PaymentLog log(double amount) {
        PaymentLog pl = new PaymentLog();
        pl.setId("log-1");
        pl.setPaymentAmount(amount);
        return pl;
    }

    private static InvoiceService.InvoiceGenerationResult result(Invoice inv, int logCount) {
        return new InvoiceService.InvoiceGenerationResult(inv, null, false, logCount);
    }

    @Test
    @DisplayName("a course that is one share of a bigger order quotes the order")
    void perShareLogSpeaksForTheOrder() {
        OrderAmountSummary summary = service.orderAmountsFrom(
                result(invoice(899, 497), 4), log(224.75));
        assertNotNull(summary);
        assertEquals(1396d, summary.grossAmount(), 0.001, "gross = paid + discount");
        assertEquals(497d, summary.discountAmount(), 0.001);
        assertEquals(899d, summary.paidAmount(), 0.001, "what the gateway actually took");
        assertEquals(4, summary.itemCount());
    }

    @Test
    @DisplayName("a single-course invoice keeps quoting its own log")
    void singleCourseUnchanged() {
        assertNull(service.orderAmountsFrom(result(invoice(349, 0), 1), log(349)),
                "one log, one course — the old behaviour must stand");
    }

    @Test
    @DisplayName("a legacy multi-package child does NOT quote the invoice")
    void legacyMultiPackageUnchanged() {
        // Every MP child carries the full order total, and the invoice is priced
        // from plan list prices — 3 books at 100 = 300 while 250 was charged.
        // Quoting the invoice would tell the learner they paid 300.
        assertNull(service.orderAmountsFrom(result(invoice(300, 0), 3), log(300)),
                "child amount == invoice total means it is not a share");
    }

    @Test
    @DisplayName("degrades safely when the invoice says nothing useful")
    void safeFallbacks() {
        assertNull(service.orderAmountsFrom(null, log(100)));
        assertNull(service.orderAmountsFrom(result(null, 4), log(100)));
        assertNull(service.orderAmountsFrom(result(invoice(0, 0), 4), log(0)), "a free order");
    }

    @Test
    @DisplayName("a missing amount on the log never fabricates an order total")
    void nullLogAmount() {
        PaymentLog noAmount = new PaymentLog();
        noAmount.setId("log-1");
        // Treated as 0, which is strictly less than the order — so it does quote
        // the invoice. That is correct: the invoice is the better source when the
        // log itself has no figure at all.
        assertNotNull(service.orderAmountsFrom(result(invoice(899, 497), 4), noAmount));
    }
}
