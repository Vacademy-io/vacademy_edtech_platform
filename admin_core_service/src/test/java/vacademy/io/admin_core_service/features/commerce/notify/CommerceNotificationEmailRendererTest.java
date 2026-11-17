package vacademy.io.admin_core_service.features.commerce.notify;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.notify.entity.CommerceNotificationSetting;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The buyer's email HTML: every value escaped (a name or a product name cannot add markup), the
 * link paragraph made a button that opens safely, no button without a link, at most twenty item
 * rows, the email-only lines by their rule, the page language, and no placeholder left.
 */
class CommerceNotificationEmailRendererTest {

    private static final String LINK = "https://shop.example.com/order#l=l1.cGF5bG9hZA.c2lnbmF0dXJl";
    private static final String MARKUP_NAME = "<script>alert(1)</script> \"Asha\"";
    private static final String MARKUP_PRODUCT = "<script>x()</script> \"Kurta\" & 'Dupatta'";

    private final CommerceNotificationEmailRenderer renderer = new CommerceNotificationEmailRenderer();
    private final CommerceNotificationMessages messages = new CommerceNotificationMessages(renderer);

    private static CommerceNotificationMessages.Facts facts(String name, String link, Integer returnDays,
                                                            String reference,
                                                            List<CommerceNotificationEmailRenderer.Item> items) {
        return new CommerceNotificationMessages.Facts(name, "Example Shop", "SH-000123", "₹1,499", link,
                "India Post", "EZ123456789IN", "₹0", "STAFF_CANCELLED", "R-000045", "₹500", "UPI", returnDays,
                reference, items, "₹1,499");
    }

    private static List<CommerceNotificationEmailRenderer.Item> items(int n, String name) {
        List<CommerceNotificationEmailRenderer.Item> out = new ArrayList<>();
        for (int i = 1; i <= n; i++) {
            out.add(new CommerceNotificationEmailRenderer.Item(name + " " + i, "Blue / M", "1", "₹100"));
        }
        return out;
    }

    private static int count(String html, String part) {
        Matcher m = Pattern.compile(Pattern.quote(part)).matcher(html);
        int n = 0;
        while (m.find()) {
            n++;
        }
        return n;
    }

    @Test
    void aScriptTagOrAQuoteInANameOrAProductNameComesOutEscaped() {
        CommerceNotificationEmailRenderer.Email email = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED,
                "en", facts(MARKUP_NAME, LINK, null, null, List.of(new CommerceNotificationEmailRenderer.Item(
                        MARKUP_PRODUCT, "<b>Red</b>", "2", "₹998"))), null);
        String html = email.html();
        assertFalse(html.toLowerCase().contains("<script"), html);
        assertFalse(html.contains("<b>Red"), html);
        assertTrue(html.contains("Hello &lt;script&gt;alert(1)&lt;/script&gt; &quot;Asha&quot;,"), html);
        assertTrue(html.contains("&lt;script&gt;x()&lt;/script&gt; &quot;Kurta&quot; &amp; &#39;Dupatta&#39;"),
                html);
        assertTrue(html.contains("&lt;b&gt;Red&lt;/b&gt;"), html);
        // The subject is plain text, one line.
        assertEquals("Order SH-000123 confirmed", email.subject());
    }

    @Test
    void aShopNameWithMarkupIsEscapedInTheHeadingAndTheFooter() {
        CommerceNotificationEmailRenderer.Email email = renderer.render(new CommerceNotificationEmailRenderer.Input(
                "en", "Shop <b>Bold</b> \"A\"", "Order {{order_number}}",
                "Hello. See your order: {{order_link}} Thanks.", Map.of("order_number", "SH-1"), LINK, null, null,
                null));
        assertFalse(email.html().contains("<b>Bold"), email.html());
        assertEquals(2, count(email.html(), "Shop &lt;b&gt;Bold&lt;/b&gt; &quot;A&quot;"));
    }

    @Test
    void theLinkParagraphIsAButtonThatOpensSafely() {
        String html = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED, "en",
                facts("Asha", LINK, null, null, items(1, "Kurta")), null).html();
        assertEquals(1, count(html, "<a "), html);
        // ses:no-track: the mail service never rewrites the order link into a click-tracking redirect.
        assertTrue(html.contains("<a ses:no-track href=\"" + LINK + "\" target=\"_blank\" rel=\"noopener noreferrer\""),
                html);
        // Every anchor of the message carries it.
        assertEquals(html.split("<a ", -1).length, html.split("<a ses:no-track ", -1).length, html);
        assertTrue(html.contains(">See your order</a>"), html);
        // The lead-in "See your order:" is the button now, not a paragraph as well.
        assertEquals(1, count(html, "See your order"), html);
        assertTrue(html.contains("We will message you again when it is on its way."), html);
        assertTrue(html.indexOf("is confirmed.") < html.indexOf("<a "), "text, then the button");
        assertTrue(html.indexOf("<a ") < html.indexOf("We will message you again"), "the button, then the rest");

        // A lead-in that says more than the label stays as its own paragraph above the button.
        String delivered = messages.email(CommerceNotificationTrigger.ORDER_DELIVERED, "en",
                facts("Asha", LINK, null, null, null), null).html();
        assertTrue(delivered.contains("If anything is wrong, open your order and message us from there"), delivered);
        assertTrue(delivered.contains(">See your order</a>"), delivered);

        String hindi = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED, "hi",
                facts("Asha", LINK, null, null, items(1, "Kurta")), null).html();
        assertTrue(hindi.contains(">अपना ऑर्डर देखें</a>"), hindi);
        assertTrue(hindi.contains("rel=\"noopener noreferrer\""), hindi);
        assertTrue(hindi.contains("<a ses:no-track href=\"" + LINK + "\""), hindi);
    }

    @Test
    void withoutALinkThereIsNoButtonAndNoSeeYourOrderParagraph() {
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                String html = messages.email(trigger, locale, facts("Asha", null, 7, "pay_ref_1", items(2, "Kurta")),
                        null).html();
                assertFalse(html.contains("<a "), trigger + " " + locale);
                assertFalse(html.contains("See your order") || html.contains("अपना ऑर्डर देखें"),
                        trigger + " " + locale + ": " + html);
                assertFalse(html.contains("order_link") || html.contains("{{") || html.contains("}}"),
                        trigger + " " + locale);
            }
        }
    }

    @Test
    void itemsAreCappedAtTwentyWithACountOfTheRest() {
        String en = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED, "en",
                facts("Asha", LINK, null, null, items(25, "Kurta")), null).html();
        assertEquals(20, count(en, "Kurta "), en);
        assertTrue(en.contains("Kurta 20<"));
        assertFalse(en.contains("Kurta 21<"));
        assertTrue(en.contains("+5 more"), en);
        assertTrue(en.contains(">Total<") && en.contains("₹1,499"), en);

        String hi = messages.email(CommerceNotificationTrigger.POS_BILL_ISSUED, "hi",
                facts(null, LINK, null, null, items(21, "Kurta")), null).html();
        assertEquals(20, count(hi, "Kurta "));
        assertTrue(hi.contains("+1 और"), hi);

        String exactly = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED, "en",
                facts("Asha", LINK, null, null, items(20, "Kurta")), null).html();
        assertEquals(20, count(exactly, "Kurta "));
        assertFalse(exactly.contains("more<"), exactly);

        // A trigger without an items table never shows one.
        String shipped = messages.email(CommerceNotificationTrigger.ORDER_SHIPPED, "en",
                facts("Asha", LINK, null, null, items(3, "Kurta")), null).html();
        assertFalse(shipped.contains("Kurta"), shipped);
    }

    @Test
    void emailOnlyLinesAreAddedOnlyWhenTheyApply() {
        String withWindow = messages.email(CommerceNotificationTrigger.ORDER_DELIVERED, "en",
                facts("Asha", LINK, 7, null, null), null).html();
        assertTrue(withWindow.contains("You can ask for a return within 7 days of delivery."), withWindow);
        String hiWindow = messages.email(CommerceNotificationTrigger.ORDER_DELIVERED, "hi",
                facts("Asha", LINK, 10, null, null), null).html();
        assertTrue(hiWindow.contains("डिलीवरी के 10 दिन के भीतर आप वापसी के लिए कह सकते हैं।"), hiWindow);
        for (Integer none : new Integer[] {0, null}) {
            String noWindow = messages.email(CommerceNotificationTrigger.ORDER_DELIVERED, "en",
                    facts("Asha", LINK, none, null, null), null).html();
            assertFalse(noWindow.contains("ask for a return"), noWindow);
        }

        String withReference = messages.email(CommerceNotificationTrigger.REFUND_PROCESSED, "en",
                facts("Asha", LINK, null, "rfnd_ABC123", null), null).html();
        assertTrue(withReference.contains("Reference: rfnd_ABC123"), withReference);
        String noReference = messages.email(CommerceNotificationTrigger.REFUND_PROCESSED, "en",
                facts("Asha", LINK, null, "  ", null), null).html();
        assertFalse(noReference.contains("Reference:"), noReference);

        // Only the trigger that owns a line gets it.
        String cancelled = messages.email(CommerceNotificationTrigger.ORDER_CANCELLED, "en",
                facts("Asha", LINK, 7, "rfnd_ABC123", null), null).html();
        assertFalse(cancelled.contains("ask for a return") || cancelled.contains("Reference:"), cancelled);
    }

    @Test
    void thePageCarriesItsLanguage() {
        assertTrue(messages.email(CommerceNotificationTrigger.ORDER_RTO, "en", facts("Asha", LINK, null, null, null),
                null).html().startsWith("<!DOCTYPE html><html lang=\"en\">"));
        String hi = messages.email(CommerceNotificationTrigger.ORDER_RTO, "hi", facts("Asha", LINK, null, null, null),
                null).html();
        assertTrue(hi.startsWith("<!DOCTYPE html><html lang=\"hi\">"));
        assertTrue(hi.contains("यह ईमेल आपको इसलिए मिला है क्योंकि आपने Example Shop पर ऑर्डर दिया था।"), hi);
        assertFalse(hi.contains("<img"), "no images, no tracking pixel");
    }

    @Test
    void noPlaceholderIsLeftEvenFromAStaffOverrideOrAValue() {
        CommerceNotificationSetting override = new CommerceNotificationSetting();
        override.setEmailSubjectEn("Your order {{order_number}} {{not_a_variable}}");
        override.setEmailBodyEn("Dear {{customer_name}},\nyour order {{order_number}} is confirmed.\n"
                + "See your order: {{order_link}}\nThanks from {{shop_name}}.");
        CommerceNotificationEmailRenderer.Email email = messages.email(CommerceNotificationTrigger.ORDER_CONFIRMED,
                "en", facts("Asha {{order_link}}", LINK, null, null, items(1, "Kurta {{x}}")), override);
        assertFalse(email.html().contains("{{") || email.html().contains("}}"), email.html());
        assertFalse(email.subject().contains("{{"), email.subject());
        assertEquals("Your order SH-000123", email.subject());
        assertTrue(email.html().contains("Dear Asha order_link,"), email.html());
        assertTrue(email.html().contains("Thanks from Example Shop."), email.html());
        assertEquals(1, count(email.html(), "<a "));

        Map<String, String> values = new LinkedHashMap<>();
        values.put("order_number", "SH-1}} {{2");
        String html = renderer.render(new CommerceNotificationEmailRenderer.Input("en", "Example Shop",
                "Order {{order_number}}", "Order {{order_number}} is ready.", values, null, null, null, null)).html();
        assertFalse(html.contains("{{") || html.contains("}}"), html);
    }
}
