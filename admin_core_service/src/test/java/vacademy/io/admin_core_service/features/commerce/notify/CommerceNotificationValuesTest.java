package vacademy.io.admin_core_service.features.commerce.notify;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The values of a message: money the Indian way, cleaning and caps, the fallbacks Meta needs (it
 * refuses an empty parameter), the order's language, the fixed phrases, and the provider text
 * as it may be stored.
 */
class CommerceNotificationValuesTest {

    private static String money(String amount, String currency) {
        return CommerceNotificationValues.money(amount == null ? null : new BigDecimal(amount), currency);
    }

    @Test
    void moneyIsWrittenTheIndianWayWithLatinDigits() {
        assertEquals("₹1,499", money("1499", "INR"));
        assertEquals("₹1,499", money("1499.00", "INR"));
        assertEquals("₹1,499.50", money("1499.5", "INR"));
        assertEquals("₹1,23,456", money("123456", "INR"));
        assertEquals("₹12,34,56,789", money("123456789.00", null));
        assertEquals("₹999", money("999", ""));
        assertEquals("₹0", money("0", "INR"));
        assertEquals("₹0", money(null, "INR"));
        assertEquals("₹0.05", money("0.049", "inr"));
        assertEquals("USD 1,499.50", money("1499.5", "USD"));
        assertEquals("USD 123,456", money("123456", "usd"));
        assertEquals("AED 99", money("99", " aed "));
    }

    @Test
    void cleaningRemovesBreaksTabsRunsOfSpacesAndBraces() {
        assertEquals("Asha Verma", CommerceNotificationValues.clean("Asha\r\nVerma", 60, "x"));
        assertEquals("Asha Verma", CommerceNotificationValues.clean("Asha\tVerma", 60, "x"));
        assertEquals("Asha Verma", CommerceNotificationValues.clean("Asha     Verma", 60, "x"));
        assertEquals("Asha Verma", CommerceNotificationValues.clean("  Asha \n\n Verma  ", 60, "x"));
        assertEquals("Asha 1", CommerceNotificationValues.clean("Asha {{1}}", 60, "x"));
        assertEquals("name", CommerceNotificationValues.clean("{{name}}", 60, "x"));
        String cleaned = CommerceNotificationValues.clean("a{{b}}c{{ d }}", 60, "x");
        assertFalse(cleaned.contains("{{") || cleaned.contains("}}"), cleaned);
    }

    @Test
    void valuesAreCutToTheirCap() {
        assertEquals(CommerceNotificationValues.CAP_NAME,
                CommerceNotificationValues.clean("A".repeat(200), CommerceNotificationValues.CAP_NAME, "x").length());
        assertEquals("abcd", CommerceNotificationValues.clean("abcd efgh", 5, "x"), "cut, then trimmed");
        assertEquals(60, CommerceNotificationValues.CAP_NAME);
        assertEquals(40, CommerceNotificationValues.CAP_COURIER);
        assertEquals(40, CommerceNotificationValues.CAP_TRACKING);
        assertEquals(32, CommerceNotificationValues.CAP_NUMBER);
        assertEquals(300, CommerceNotificationValues.CAP_LINK);
        assertEquals(150, CommerceNotificationValues.CAP_SUBJECT);
        String subject = CommerceNotificationValues.subjectLine("Order\r\nSH-1 " + "x".repeat(300));
        assertEquals(150, subject.length());
        assertFalse(subject.contains("\n") || subject.contains("\r"));
    }

    @Test
    void anEmptyValueTakesItsFallback() {
        assertEquals("Customer", CommerceNotificationValues.clean("  \n\t ", 60,
                CommerceNotificationValues.customerFallback("en")));
        assertEquals("ग्राहक", CommerceNotificationValues.clean(null, 60,
                CommerceNotificationValues.customerFallback("hi")));
        assertEquals("ग्राहक", CommerceNotificationValues.clean("{{}}", 60,
                CommerceNotificationValues.customerFallback("hi")));
        assertEquals("our courier", CommerceNotificationValues.courierFallback("en"));
        assertEquals("हमारा कूरियर", CommerceNotificationValues.courierFallback("hi"));
        assertEquals("not given", CommerceNotificationValues.trackingFallback("en"));
        assertEquals("उपलब्ध नहीं", CommerceNotificationValues.trackingFallback("hi"));

        // As the messages use them: no WhatsApp variable is ever empty.
        CommerceNotificationMessages.Facts blank = new CommerceNotificationMessages.Facts(" ", null, null, null,
                "https://shop.example.com/order#l=x", "", "\n", null, null, null, null, null, null, null, null, null);
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                Map<String, String> vars = CommerceNotificationMessages.whatsappVariables(trigger, locale, blank);
                assertEquals(trigger.variables(), vars.keySet().stream().toList(), trigger + " " + locale);
                vars.forEach((k, v) -> assertFalse(v == null || v.isBlank(), trigger + " " + locale + " " + k));
            }
        }
        Map<String, String> en = CommerceNotificationMessages.values(CommerceNotificationTrigger.ORDER_SHIPPED, "en",
                blank);
        assertEquals("Customer", en.get("customer_name"));
        assertEquals("our shop", en.get("shop_name"));
        assertEquals("our courier", en.get("courier"));
        assertEquals("not given", en.get("tracking_number"));
        assertEquals("₹0", en.get("amount_due"));
        Map<String, String> hi = CommerceNotificationMessages.values(CommerceNotificationTrigger.ORDER_SHIPPED, "hi",
                blank);
        assertEquals("हमारी दुकान", hi.get("shop_name"));
        assertEquals("हमारा कूरियर", hi.get("courier"));
    }

    @Test
    void theLanguageIsTheOrdersThenTheShopsThenHindi() {
        assertEquals("hi", CommerceNotificationValues.normaliseLocale("hi-IN"));
        assertEquals("hi", CommerceNotificationValues.normaliseLocale("HI_in"));
        assertEquals("hi", CommerceNotificationValues.normaliseLocale(" hi "));
        assertEquals("en", CommerceNotificationValues.normaliseLocale("en_US"));
        assertEquals("en", CommerceNotificationValues.normaliseLocale("en-GB"));
        assertEquals("en", CommerceNotificationValues.normaliseLocale("EN"));
        assertNull(CommerceNotificationValues.normaliseLocale("fr"));
        assertNull(CommerceNotificationValues.normaliseLocale("hindi"));
        assertNull(CommerceNotificationValues.normaliseLocale("english"));
        assertNull(CommerceNotificationValues.normaliseLocale(null));

        assertEquals("en", CommerceNotificationValues.messageLocale("en_US", "hi"));
        assertEquals("hi", CommerceNotificationValues.messageLocale("hi-IN", "en"));
        assertEquals("en", CommerceNotificationValues.messageLocale(null, "en-IN"), "null: the shop's base");
        assertEquals("en", CommerceNotificationValues.messageLocale("ta", "en"), "other: the shop's base");
        assertEquals("hi", CommerceNotificationValues.messageLocale(null, null), "no base: Hindi");
        assertEquals("hi", CommerceNotificationValues.messageLocale("ta", "fr"));
    }

    @Test
    void cancelReasonsAndRefundMethodsReadAsTheFixedPhrases() {
        assertEquals("cancelled by the shop", CommerceNotificationValues.cancelReason("STAFF_CANCELLED", "en"));
        assertEquals("दुकान द्वारा रद्द", CommerceNotificationValues.cancelReason("STAFF_CANCELLED", "hi"));
        assertEquals("cancelled by the shop", CommerceNotificationValues.cancelReason("SOMETHING_NEW", "en"));
        assertEquals("दुकान द्वारा रद्द", CommerceNotificationValues.cancelReason(null, "hi"));
        assertEquals("the items are not available", CommerceNotificationValues.cancelReason("LINES_CANCELLED", "en"));
        assertEquals("सामान उपलब्ध नहीं है", CommerceNotificationValues.cancelReason("LINES_CANCELLED", "hi"));
        assertEquals("we could not confirm it by phone",
                CommerceNotificationValues.cancelReason("COD_NOT_CONFIRMED", "en"));
        assertEquals("फ़ोन पर पुष्टि नहीं हो सकी", CommerceNotificationValues.cancelReason("COD_NOT_CONFIRMED", "hi"));
        assertEquals("the item sold out before your payment reached us",
                CommerceNotificationValues.cancelReason("OVERSOLD_PAID", "en"));
        assertEquals("आपका भुगतान पहुँचने से पहले सामान बिक गया",
                CommerceNotificationValues.cancelReason("OVERSOLD_PAID", "hi"));

        assertEquals("the way you paid", CommerceNotificationValues.refundMethod("GATEWAY", "en"));
        assertEquals("आपके भुगतान के तरीके", CommerceNotificationValues.refundMethod("GATEWAY", "hi"));
        assertEquals("bank transfer", CommerceNotificationValues.refundMethod("BANK_TRANSFER", "en"));
        assertEquals("बैंक ट्रांसफ़र", CommerceNotificationValues.refundMethod("BANK_TRANSFER", "hi"));
        assertEquals("UPI", CommerceNotificationValues.refundMethod("UPI", "en"));
        assertEquals("UPI", CommerceNotificationValues.refundMethod("UPI", "hi"));
        assertNull(CommerceNotificationValues.refundMethod("CASH", "en"));
        assertNull(CommerceNotificationValues.refundMethod("EXCHANGE_CREDIT", "hi"));
        assertTrue(CommerceNotificationValues.refundMessaged("GATEWAY"));
        assertTrue(CommerceNotificationValues.refundMessaged("BANK_TRANSFER"));
        assertTrue(CommerceNotificationValues.refundMessaged("UPI"));
        assertFalse(CommerceNotificationValues.refundMessaged("CASH"));
        assertFalse(CommerceNotificationValues.refundMessaged("EXCHANGE_CREDIT"));
        assertFalse(CommerceNotificationValues.refundMessaged(null));
    }

    @Test
    void htmlValuesAreEscaped() {
        assertEquals("&lt;script&gt;a &amp; &quot;b&quot; &#39;c&#39;&lt;/script&gt;",
                CommerceNotificationValues.cleanHtml("<script>a & \"b\" 'c'</script>", 200, ""));
        assertNull(CommerceNotificationValues.escapeHtml(null));
    }

    @Test
    void aProviderErrorIsStoredWithoutLongDigitRunsOrAddresses() {
        String detail = CommerceNotificationValues.errorDetail(
                "Recipient 919876543210 (asha.verma@example.com) rejected:\nerror 131026, code 42");
        assertEquals("Recipient # ([email]) rejected: error #, code 42", detail);
        assertFalse(detail.contains("98765"));
        assertFalse(detail.contains("@"));
        assertEquals(300, CommerceNotificationValues.errorDetail("x".repeat(500)).length());
        assertEquals("12345 kept", CommerceNotificationValues.errorDetail("12345 kept"));
        assertNull(CommerceNotificationValues.errorDetail(null));
    }
}
