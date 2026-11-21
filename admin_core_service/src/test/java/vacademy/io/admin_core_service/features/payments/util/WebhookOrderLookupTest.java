package vacademy.io.admin_core_service.features.payments.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Exact order-id matching used by Cashfree/PhonePe webhooks. */
class WebhookOrderLookupTest {

    private static PaymentLog log(String id, String vendor, String data) {
        PaymentLog log = new PaymentLog();
        log.setId(id);
        log.setVendor(vendor);
        log.setPaymentSpecificData(data);
        return log;
    }

    @Test
    @DisplayName("LIKE wildcards and the escape character in the id are escaped")
    void likePatternEscapesWildcards() {
        assertEquals("%\"abc\"%", WebhookOrderLookup.quotedValueLikePattern("abc"));
        assertEquals("%\"\\%\"%", WebhookOrderLookup.quotedValueLikePattern("%"));
        assertEquals("%\"a\\_b\"%", WebhookOrderLookup.quotedValueLikePattern("a_b"));
        assertEquals("%\"a\\\\b\"%", WebhookOrderLookup.quotedValueLikePattern("a\\b"));
    }

    @Test
    @DisplayName("the payment log's own id matches (single-course checkout)")
    void primaryKeyMatches() {
        assertTrue(WebhookOrderLookup.matches(log("pl-1", "CASHFREE", null), "pl-1", "CASHFREE"));
        assertTrue(WebhookOrderLookup.matches(log("pl-1", "cashfree", null), "pl-1", "CASHFREE"));
    }

    @Test
    @DisplayName("a shared multi-package order id stored as originalRequest.order_id matches parent and children")
    void sharedOrderIdMatches() {
        String data = "{\"originalRequest\":{\"order_id\":\"MPabc123\",\"amount\":900.0},"
                + "\"response\":{\"order_id\":\"MPabc123\"},\"childPaymentLogIds\":[\"pl-child\"]}";
        assertTrue(WebhookOrderLookup.matches(log("pl-parent", "CASHFREE", data), "MPabc123", "CASHFREE"));
        assertTrue(WebhookOrderLookup.matches(log("pl-child", "CASHFREE", data), "MPabc123", "CASHFREE"));
    }

    @Test
    @DisplayName("camelCase originalRequest.orderId on older rows matches")
    void camelCaseOrderIdMatches() {
        String data = "{\"originalRequest\":{\"orderId\":\"MPold\"}}";
        assertTrue(WebhookOrderLookup.matches(log("pl-1", "PHONEPE", data), "MPold", "PHONEPE"));
    }

    @Test
    @DisplayName("a log of another gateway does not match, even with the same id")
    void vendorMustMatch() {
        String data = "{\"originalRequest\":{\"order_id\":\"MPabc123\"}}";
        assertFalse(WebhookOrderLookup.matches(log("pl-1", "RAZORPAY", data), "MPabc123", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(log("pl-1", "RAZORPAY", null), "pl-1", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(log("pl-1", null, null), "pl-1", "CASHFREE"));
    }

    @Test
    @DisplayName("substrings, wildcards and ids stored elsewhere in the JSON do not match")
    void noPartialMatches() {
        String data = "{\"originalRequest\":{\"order_id\":\"MPabc123\",\"email\":\"a_b@x.com\"},"
                + "\"response\":{\"order_id\":\"other-order\"}}";
        PaymentLog row = log("pl-1", "CASHFREE", data);
        assertFalse(WebhookOrderLookup.matches(row, "MPabc", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(row, "%", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(row, "_", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(row, "a_b@x.com", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(row, "other-order", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(row, "pl-", "CASHFREE"));
    }

    @Test
    @DisplayName("blank ids and unparsable data never match")
    void blankAndBrokenData() {
        assertFalse(WebhookOrderLookup.matches(log("pl-1", "CASHFREE", null), "", "CASHFREE"));
        assertFalse(WebhookOrderLookup.matches(log("pl-1", "CASHFREE", "not json"), "x", "CASHFREE"));
    }
}
