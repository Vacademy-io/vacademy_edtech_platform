package vacademy.io.admin_core_service.features.commerce.notify;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The default texts: nine triggers in Hindi and English, each WhatsApp body of the shape Meta
 * approves (no placeholder at the start or the end, never two placeholders with only spaces or
 * punctuation between them, at most 1024 characters, positions numbered in order, only the
 * trigger's own variables), the right script per language, subjects that fit, and a positional
 * form whose variable list maps back to the named text.
 */
class CommerceNotificationTextsTest {

    private static final Pattern POSITION = Pattern.compile("\\{\\{(\\d+)\\}\\}");
    /** Two placeholders with nothing but white space or punctuation between them. */
    private static final Pattern ADJACENT = Pattern.compile("\\}\\}[\\s\\p{P}]*\\{\\{");
    private static final Pattern DEVANAGARI = Pattern.compile("\\p{InDevanagari}");
    private static final List<String> PROMOTIONAL = List.of("offer", "discount", "sale", "% off", "coupon", "free",
            "deal", "छूट", "ऑफ़र", "मुफ़्त");

    /** The longest value each variable can take after cleaning (§3.4 caps). */
    private static Map<String, String> longestValues() {
        Map<String, String> v = new HashMap<>();
        v.put("customer_name", "N".repeat(CommerceNotificationValues.CAP_NAME));
        v.put("shop_name", "S".repeat(CommerceNotificationValues.CAP_NAME));
        v.put("order_number", "9".repeat(CommerceNotificationValues.CAP_NUMBER));
        v.put("order_total", "9".repeat(CommerceNotificationValues.CAP_NUMBER));
        v.put("order_link", "h".repeat(CommerceNotificationValues.CAP_LINK));
        v.put("courier", "C".repeat(CommerceNotificationValues.CAP_COURIER));
        v.put("tracking_number", "T".repeat(CommerceNotificationValues.CAP_TRACKING));
        v.put("amount_due", "9".repeat(CommerceNotificationValues.CAP_NUMBER));
        v.put("cancel_reason", "the item sold out before your payment reached us");
        v.put("return_number", "R".repeat(CommerceNotificationValues.CAP_NUMBER));
        v.put("refund_amount", "9".repeat(CommerceNotificationValues.CAP_NUMBER));
        v.put("refund_method", "आपके भुगतान के तरीके");
        v.put("return_days", "365");
        v.put("refund_reference", "F".repeat(CommerceNotificationValues.CAP_TRACKING));
        return v;
    }

    @Test
    void everyTriggerHasATextInHindiAndInEnglish() {
        assertEquals(9, CommerceNotificationTrigger.values().length);
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : List.of("hi", "en")) {
                CommerceNotificationTexts.Text text = CommerceNotificationTexts.of(trigger, locale);
                assertNotNull(text, trigger + " " + locale);
                assertFalse(text.body().isBlank(), trigger + " " + locale + " body");
                assertFalse(text.subject().isBlank(), trigger + " " + locale + " subject");
            }
            assertThrows(IllegalArgumentException.class, () -> CommerceNotificationTexts.of(trigger, "fr"));
        }
        assertEquals(List.of("hi", "en"), CommerceNotificationTexts.LOCALES);
    }

    @Test
    void templateNamesAndTagsAreTheContractsOwn() {
        Set<String> tags = new HashSet<>();
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            assertEquals("commerce_" + trigger.name().toLowerCase(Locale.ROOT), trigger.templateName());
            assertTrue(trigger.templateName().matches("[a-z0-9_]{1,100}"));
            assertTrue(trigger.tag().matches("[A-Z]{2}"), trigger.tag());
            assertTrue(tags.add(trigger.tag()), "tag used twice: " + trigger.tag());
            assertEquals(trigger, CommerceNotificationTrigger.of(trigger.name()));
        }
        assertEquals(Set.of("OC", "CN", "OS", "OD", "OX", "OR", "RA", "RP", "PB"), tags);
        assertNull(CommerceNotificationTrigger.of(null));
        assertNull(CommerceNotificationTrigger.of("order_confirmed"));
        assertNull(CommerceNotificationTrigger.of("PAYMENT_EXPIRED"));
    }

    @Test
    void everyWhatsAppBodyHasTheShapeMetaApproves() {
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                String where = trigger + " " + locale;
                String named = CommerceNotificationTexts.of(trigger, locale).body();
                CommerceNotificationTexts.Positional p = CommerceNotificationTexts.positional(named);
                String body = p.body();

                assertFalse(body.strip().startsWith("{{"), where + ": a placeholder at the start");
                assertFalse(body.strip().endsWith("}}"), where + ": a placeholder at the end");
                Matcher adjacent = ADJACENT.matcher(body);
                boolean found = adjacent.find();
                assertFalse(found, () -> where + ": two placeholders with only spaces or punctuation between "
                        + "them at " + adjacent.start() + " in: " + body);
                assertTrue(body.length() <= 1024, where + ": longer than 1024");
                assertFalse(body.contains("\n") || body.contains("\t"), where + ": a line break or tab");

                // {{1}}..{{n}} numbered in order of first appearance.
                Matcher m = POSITION.matcher(body);
                int highest = 0;
                while (m.find()) {
                    int n = Integer.parseInt(m.group(1));
                    assertTrue(n <= highest + 1, where + ": position " + n + " after " + highest);
                    highest = Math.max(highest, n);
                }
                assertEquals(p.names().size(), highest, where + ": positions and names differ in count");
                assertFalse(CommerceNotificationTexts.PLACEHOLDER.matcher(body.replaceAll("\\{\\{\\d+\\}\\}", ""))
                        .find(), where + ": a named placeholder left in the positional body");

                // Only the trigger's own variables, never an email-only one; every message carries the link.
                assertTrue(trigger.variables().containsAll(p.names()), where + ": " + p.names());
                assertTrue(p.names().contains("order_link"), where + ": no order link");
                for (String word : PROMOTIONAL) {
                    assertFalse(named.toLowerCase(Locale.ROOT).contains(word), where + ": promotional word " + word);
                }
            }
        }
    }

    @Test
    void thePositionalBodyAndItsVariableNamesGiveBackTheNamedText() {
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                String named = CommerceNotificationTexts.of(trigger, locale).body();
                CommerceNotificationTexts.Positional p = CommerceNotificationTexts.positional(named);
                assertEquals(new LinkedHashSet<>(CommerceNotificationTexts.placeholders(named)).stream().toList(),
                        p.names(), trigger + " " + locale);
                Matcher m = POSITION.matcher(p.body());
                StringBuilder back = new StringBuilder();
                while (m.find()) {
                    m.appendReplacement(back, Matcher.quoteReplacement(
                            "{{" + p.names().get(Integer.parseInt(m.group(1)) - 1) + "}}"));
                }
                m.appendTail(back);
                assertEquals(named, back.toString(), trigger + " " + locale);
            }
        }
    }

    @Test
    void aRepeatedNameKeepsItsPositionAndFillLeavesNoPlaceholder() {
        CommerceNotificationTexts.Positional p = CommerceNotificationTexts.positional(
                "Hi {{a}}, order {{b}} for {{ a }} ok");
        assertEquals("Hi {{1}}, order {{2}} for {{1}} ok", p.body());
        assertEquals(List.of("a", "b"), p.names());
        assertEquals("x  y", CommerceNotificationTexts.fill("x {{unknown}} y", Map.of()));
        assertEquals("x $1 \\ y", CommerceNotificationTexts.fill("x {{v}} y", Map.of("v", "$1 \\")));
        assertNull(CommerceNotificationTexts.fill(null, Map.of()));
    }

    @Test
    void hindiTextsAreInDevanagariAndEnglishTextsHaveNone() {
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            CommerceNotificationTexts.Text hi = CommerceNotificationTexts.of(trigger, "hi");
            CommerceNotificationTexts.Text en = CommerceNotificationTexts.of(trigger, "en");
            assertTrue(DEVANAGARI.matcher(hi.body()).find(), trigger + " hi body");
            assertTrue(DEVANAGARI.matcher(hi.subject()).find(), trigger + " hi subject");
            assertFalse(DEVANAGARI.matcher(en.body()).find(), trigger + " en body");
            assertFalse(DEVANAGARI.matcher(en.subject()).find(), trigger + " en subject");
            if (hi.emailLine() != null) {
                assertTrue(DEVANAGARI.matcher(hi.emailLine()).find(), trigger + " hi email line");
            }
            if (en.emailLine() != null) {
                assertFalse(DEVANAGARI.matcher(en.emailLine()).find(), trigger + " en email line");
            }
            // Both languages carry the same email-only line or none.
            assertEquals(hi.emailLine() == null, en.emailLine() == null, trigger + " email line");
        }
    }

    @Test
    void subjectsFitIn150CharactersWithTheLongestValues() {
        Map<String, String> longest = longestValues();
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            for (String locale : CommerceNotificationTexts.LOCALES) {
                CommerceNotificationTexts.Text text = CommerceNotificationTexts.of(trigger, locale);
                String filled = CommerceNotificationTexts.fill(text.subject(), longest);
                assertTrue(filled.length() <= CommerceNotificationValues.CAP_SUBJECT,
                        trigger + " " + locale + " subject is " + filled.length() + " long");
                assertEquals(filled, CommerceNotificationValues.subjectLine(filled), "never cut");
                Set<String> allowed = new HashSet<>(trigger.variables());
                allowed.addAll(trigger.emailOnly());
                assertTrue(allowed.containsAll(CommerceNotificationTexts.placeholders(text.subject())),
                        trigger + " " + locale + " subject");
                if (text.emailLine() != null) {
                    assertTrue(trigger.emailOnly().containsAll(CommerceNotificationTexts.placeholders(
                            text.emailLine())), trigger + " " + locale + " email line");
                }
                // The message itself stays within Meta's limit with every value at its cap.
                assertTrue(CommerceNotificationTexts.fill(text.body(), longest).length() <= 1024,
                        trigger + " " + locale + " body with the longest values");
            }
        }
    }

    @Test
    void theEmailOnlyLinesAreThoseOfTheContract() {
        assertEquals(List.of("return_days"), CommerceNotificationTrigger.ORDER_DELIVERED.emailOnly());
        assertEquals(List.of("refund_reference"), CommerceNotificationTrigger.REFUND_PROCESSED.emailOnly());
        Set<CommerceNotificationTrigger> withItems = new HashSet<>();
        for (CommerceNotificationTrigger trigger : CommerceNotificationTrigger.values()) {
            if (trigger.itemsTable()) {
                withItems.add(trigger);
            }
            if (trigger != CommerceNotificationTrigger.ORDER_DELIVERED
                    && trigger != CommerceNotificationTrigger.REFUND_PROCESSED) {
                assertTrue(trigger.emailOnly().isEmpty(), trigger.name());
            }
        }
        assertEquals(Set.of(CommerceNotificationTrigger.ORDER_CONFIRMED,
                CommerceNotificationTrigger.COD_CONFIRMATION_NEEDED, CommerceNotificationTrigger.POS_BILL_ISSUED),
                withItems);
        assertFalse(CommerceNotificationTrigger.POS_BILL_ISSUED.variables().contains("customer_name"));
    }
}
