package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceData;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The totals block on the invoice PDF.
 *
 * The seeded templates printed "Subtotal / Discount / Total" where Subtotal is
 * the PRE-TAX figure, not the pre-discount one — so a ₹899 order that listed at
 * ₹1,396 rendered "Subtotal 899, Discount 497, Total 899", arithmetic a parent
 * cannot check. Full-price invoices printed an empty "Discount:" line for the
 * same reason: a template has no conditionals.
 */
class InvoiceTotalsRowsTest {

    /** The real order: four ₹349 subjects, ₹497 off, ₹899 charged. */
    private static InvoiceData order(double gross, double discount, double tax, double total) {
        return InvoiceData.builder()
                .planPrice(BigDecimal.valueOf(gross))
                .discountAmount(BigDecimal.valueOf(discount))
                .taxAmount(BigDecimal.valueOf(tax))
                .totalAmount(BigDecimal.valueOf(total))
                .build();
    }

    @Test
    @DisplayName("shows amount, discount and what was actually paid, in that order")
    void discountedOrder() {
        String html = InvoiceService.buildTotalsRowsHtml(order(1396, 497, 0, 899), "₹");
        assertTrue(html.contains("Amount"), "names what the courses cost");
        assertTrue(html.contains("₹1,396.00"), "the gross, not the charged figure");
        assertTrue(html.contains("-₹497.00"), "the discount, as a deduction");
        assertTrue(html.contains("Total Paid"));
        assertTrue(html.contains("₹899.00"));
        assertTrue(html.indexOf("1396") < html.indexOf("497")
                && html.indexOf("497") < html.indexOf("899"), "reads top to bottom as a sum");
    }

    @Test
    @DisplayName("prints no Discount line on a full-price invoice")
    void noDiscount() {
        String html = InvoiceService.buildTotalsRowsHtml(order(349, 0, 0, 349), "₹");
        assertFalse(html.contains("Discount"), "an empty discount row is what this replaces");
        assertFalse(html.contains("Amount:"), "repeating the total as an 'Amount' row reads as an error");
        assertTrue(html.contains("Total Paid"));
        assertTrue(html.contains("₹349.00"));
    }

    @Test
    @DisplayName("shows tax under its configured label when there is any")
    void withTax() {
        InvoiceData taxed = InvoiceData.builder()
                .planPrice(BigDecimal.valueOf(1396))
                .discountAmount(BigDecimal.valueOf(497))
                .taxAmount(BigDecimal.valueOf(137.14))
                .totalAmount(BigDecimal.valueOf(899))
                .taxLabel("GST")
                .build();
        String html = InvoiceService.buildTotalsRowsHtml(taxed, "₹");
        assertTrue(html.contains("GST"));
        assertTrue(html.contains("137.14"));
    }

    @Test
    @DisplayName("survives an invoice with nothing on it")
    void empty() {
        assertTrue(InvoiceService.buildTotalsRowsHtml(null, "₹").isEmpty());
        String html = InvoiceService.buildTotalsRowsHtml(InvoiceData.builder().build(), "₹");
        assertTrue(html.contains("Total Paid"), "still states a total rather than blowing up");
    }

    @Test
    @DisplayName("the shipped default invoice template keeps the block out")
    void defaultTemplateDoesNotUseTheBlock() throws IOException {
        String template = Files.readString(
                Path.of("src/main/resources/templates/invoice/default_invoice.html"));
        // The block is built with raw &nbsp;. default_invoice.html names its
        // placeholder inside a CSS comment and an HTML comment as well as at the
        // real insertion point, and jsoup emits <style> data and comments verbatim
        // -- so substituting it put an undeclared XML entity into the document and
        // every invoice PDF died on it. Until the block stops emitting named
        // entities, the shipped template stays on the single-figure total.
        assertFalse(template.contains("{{totals_rows}}"),
                "default_invoice.html must not embed the totals block");
        assertTrue(template.contains("Total Purchases</span>"),
                "the single-figure total is what it renders instead");
    }
}
