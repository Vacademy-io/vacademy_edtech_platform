package vacademy.io.admin_core_service.features.notification_service.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PaymentConfirmationReceiptAliasesTest {

    private static Map<String, String> base() {
        Map<String, String> v = new HashMap<>();
        v.put("user_full_name", "Sam Lee");
        v.put("amount", "431.00");
        v.put("currency_symbol", "A$");
        v.put("payment_date", "19 Oct 2026");
        v.put("course_name", "Practice Membership - MYCPD");
        return v;
    }

    @Test
    @DisplayName("email-editor receipt names resolve from the values the confirmation already carries")
    void aliases() {
        Map<String, String> v = PaymentNotificatonService.withReceiptAliases(base(), "Vet Course");
        assertEquals("Sam Lee", v.get("customer_name"));
        assertEquals("A$431.00", v.get("amount_paid"));
        assertEquals("19 Oct 2026", v.get("payment_received_date"));
        assertEquals("Practice Membership - MYCPD", v.get("invoice_item_description"));
        assertEquals("Vet Course", v.get("invoice_item_tag"));
    }

    @Test
    @DisplayName("a course without tags leaves the tag empty, so its {{#if}} block hides")
    void tagEmpty() {
        assertEquals("", PaymentNotificatonService.withReceiptAliases(base(), "").get("invoice_item_tag"));
        assertEquals("", PaymentNotificatonService.withReceiptAliases(base(), null).get("invoice_item_tag"));
    }

    @Test
    @DisplayName("a value the template's own variables already set is not overwritten")
    void keepsExisting() {
        Map<String, String> v = base();
        v.put("customer_name", "Billing Contact");
        assertEquals("Billing Contact", PaymentNotificatonService.withReceiptAliases(v, "").get("customer_name"));
    }
}
