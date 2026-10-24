package vacademy.io.admin_core_service.features.notification_service.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService.OrderAmountSummary;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The receipt a learner is emailed after a multi-course checkout.
 *
 * A product-page order is recorded as one child PaymentLog per course, and the
 * confirmation quoted whichever log it happened to be sent from — so a parent who
 * paid ₹899 for four subjects received four emails announcing a fraction each,
 * none of which matched their bank. These cases pin the arithmetic the single
 * email must now show, and that the seeded template actually has somewhere to
 * show it.
 */
class PaymentConfirmationReceiptTest {

    /** The real order from 2026-09-01: 4 subjects, ₹1,396 of list price, ₹899 charged. */
    private static final OrderAmountSummary FOUR_SUBJECTS =
            new OrderAmountSummary(1396d, 497d, 899d, 4);

    @Test
    @DisplayName("breaks the order down into subtotal and discount")
    void breakdownRows() {
        String html = PaymentNotificatonService.buildAmountBreakdownHtml(FOUR_SUBJECTS, "₹");
        assertTrue(html.contains("4 courses"), "names how many courses one payment bought");
        assertTrue(html.contains("₹1,396.00"), "shows what they cost apart");
        assertTrue(html.contains("-₹497.00"), "shows what was taken off, as a deduction");
        assertTrue(html.indexOf("1,396.00") < html.indexOf("497.00"), "subtotal before discount");
    }

    @Test
    @DisplayName("collapses to nothing when there is no discount to explain")
    void noDiscountNoRows() {
        // A single full-price course is every other order on the platform; its
        // receipt must look exactly as it always has.
        assertEquals("", PaymentNotificatonService.buildAmountBreakdownHtml(
                new OrderAmountSummary(349d, 0d, 349d, 1), "₹"));
        assertEquals("", PaymentNotificatonService.buildAmountBreakdownHtml(null, "₹"));
    }

    @Test
    @DisplayName("says Subtotal, not '1 courses', for a discounted single course")
    void singleCourseLabel() {
        String html = PaymentNotificatonService.buildAmountBreakdownHtml(
                new OrderAmountSummary(349d, 50d, 299d, 1), "₹");
        assertTrue(html.contains("Subtotal"));
        assertFalse(html.contains("1 courses"));
    }

    @Test
    @DisplayName("the field name still derives the placeholder V490 puts in the template")
    void placeholderContractHolds() throws NoSuchFieldException {
        // SendUniqueLinkService derives {{snake_case}} from the field name by
        // reflection, and applyVariables leaves UNKNOWN tokens intact so an
        // authoring typo stays visible. So renaming this field would print a raw
        // "{{amount_breakdown_html}}" in a learner's receipt rather than failing.
        for (String[] pair : new String[][] {
                { "amountBreakdownHtml", "amount_breakdown_html" },
                { "orderTotal", "order_total" },
                { "discountAmount", "discount_amount" },
                { "itemCount", "item_count" },
        }) {
            String field = vacademy.io.admin_core_service.features.notification.dto
                    .NotificationTemplateVariables.class.getDeclaredField(pair[0]).getName();
            assertEquals(pair[1], field.replaceAll("([a-z])([A-Z]+)", "$1_$2").toLowerCase());
        }
    }

    @Test
    @DisplayName("the seeded receipt renders the whole sum, in order")
    void seededTemplateRendersTheBreakdown() throws IOException {
        // Take the template as actually seeded, apply V490's edit, then substitute
        // exactly as PaymentNotificatonService.applyVariables does. If the anchor
        // string in the migration ever drifts from the template, this fails.
        String seeded = Files.readString(Path.of(
                "src/main/resources/db/migration/V422__payment_confirmation_default_template.sql"));
        String anchor = "<tr class=\"amount-row\"><td class=\"total-label\">Amount Paid</td>";
        assertTrue(seeded.contains(anchor), "V490 anchors on this row; V422 must still contain it");

        String migrated = seeded.replace(anchor, "{{amount_breakdown_html}}" + anchor);
        String rendered = migrated
                .replace("{{amount_breakdown_html}}",
                        PaymentNotificatonService.buildAmountBreakdownHtml(FOUR_SUBJECTS, "₹"))
                .replace("{{currency_symbol}}", "₹")
                .replace("{{amount}}", "899.00");

        int subtotal = rendered.indexOf("₹1,396.00");
        int discount = rendered.indexOf("-₹497.00");
        int paid = rendered.indexOf("₹899.00");
        assertTrue(subtotal > 0 && discount > subtotal && paid > discount,
                "receipt reads subtotal, then discount, then amount paid");
    }
}
