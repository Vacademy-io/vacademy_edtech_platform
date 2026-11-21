package vacademy.io.admin_core_service.features.invoice.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceData;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceLineItemData;

/**
 * Placeholders for a monthly fee invoice: the month being billed, and the parent / year group
 * read off the learner's own custom fields.
 */
class MonthlyInvoicePlaceholdersTest {

    @Test
    @DisplayName("the billed month follows the due date, so an invoice raised in advance names the right month")
    void billingMonthFollowsDueDate() {
        InvoiceData data = InvoiceData.builder()
                .invoiceDate(LocalDateTime.of(2026, 9, 25, 10, 0))
                .dueDate(LocalDateTime.of(2026, 10, 1, 0, 0))
                .build();
        LocalDate billed = InvoiceService.billingPeriodDate(data);
        assertEquals(LocalDate.of(2026, 10, 1), billed);
        assertEquals("October", InvoiceService.billingMonthName(billed));
    }

    @Test
    @DisplayName("without a due date the invoice date is used, and without either the month is blank")
    void billingMonthFallsBack() {
        InvoiceData data = InvoiceData.builder().invoiceDate(LocalDateTime.of(2026, 11, 3, 9, 0)).build();
        assertEquals("November", InvoiceService.billingMonthName(InvoiceService.billingPeriodDate(data)));
        assertNull(InvoiceService.billingPeriodDate(InvoiceData.builder().build()));
        assertEquals("", InvoiceService.billingMonthName(null));
    }

    @Test
    @DisplayName("parent name fields are recognised however the institute labelled them")
    void parentNameFieldsMatch() {
        for (String label : new String[] {"Parent Name", "Parent's Name", "Parent/Guardian", "Guardian Name",
                "PARENTS NAME", "Name of Parent"}) {
            assertEquals("parent_name", InvoiceService.learnerProfilePlaceholderFor(label), label);
        }
    }

    @Test
    @DisplayName("a parent's email or phone is never taken for the parent's name")
    void parentContactFieldsDoNotMatch() {
        for (String label : new String[] {"Parent Email", "Parent's Mobile Number", "Guardian Phone",
                "Parent Contact", "Parent WhatsApp", "Parent Occupation", "Relation with Guardian"}) {
            assertNull(InvoiceService.learnerProfilePlaceholderFor(label), label);
        }
    }

    @Test
    @DisplayName("year group fields are recognised, unrelated fields are not")
    void yearGroupFieldsMatch() {
        for (String label : new String[] {"Year Group", "Year group (2026-27)", "Grade", "Class", "Year"}) {
            assertEquals("year_group", InvoiceService.learnerProfilePlaceholderFor(label), label);
        }
        for (String label : new String[] {"Class Timing", "Year of Passing", "Full Name", "Email", ""}) {
            assertNull(InvoiceService.learnerProfilePlaceholderFor(label), label);
        }
        assertNull(InvoiceService.learnerProfilePlaceholderFor(null));
    }

    @Test
    @DisplayName("the custom-field lookup only runs for templates that ask for it")
    void lookupIsGatedOnTheTemplate() {
        assertTrue(InvoiceService.usesLearnerProfileFields("<td>{{parent_name}}</td>"));
        assertTrue(InvoiceService.usesLearnerProfileFields("<td>{{year_group}}</td>"));
        assertFalse(InvoiceService.usesLearnerProfileFields("<td>{{user_name}} {{billing_period}}</td>"));
        assertFalse(InvoiceService.usesLearnerProfileFields(null));
    }

    private static InvoiceLineItemData item(String description, String amount) {
        return InvoiceLineItemData.builder().description(description).quantity(1)
                .unitPrice(new BigDecimal(amount)).amount(new BigDecimal(amount)).build();
    }

    @Test
    @DisplayName("a 'date | subject' line becomes one session row, with the day worked out from the date")
    void sessionRowFromDateAndSubject() {
        String html = InvoiceService.buildSessionRowsHtml(List.of(item("05 Oct 2026 | Maths", "15")), "£");
        assertTrue(html.contains(">Session 1</td>"), html);
        assertTrue(html.contains(">05 October 2026</td>"), html);
        assertTrue(html.contains(">Maths</td>"), html);
        assertTrue(html.contains(">Monday</td>"), html);
        assertTrue(html.contains(">£15.00</td>"), html);
    }

    @Test
    @DisplayName("dates are read in the usual spellings, and anything else is not a date")
    void sessionDatesParse() {
        LocalDate oct5 = LocalDate.of(2026, 10, 5);
        for (String s : new String[] {"5 Oct 2026", "05 October 2026", "Mon 5 Oct 2026", "Monday, 5 October 2026",
                "2026-10-05", "05/10/2026", "5-10-2026", "05.10.2026", "5 oct 2026"}) {
            assertEquals(oct5, InvoiceService.parseSessionDate(s), s);
        }
        for (String s : new String[] {"Maths", "October classes", "", "32/10/2026"}) {
            assertNull(InvoiceService.parseSessionDate(s), s);
        }
        assertNull(InvoiceService.parseSessionDate(null));
    }

    @Test
    @DisplayName("a plain description is the subject, an explicit day wins, and rows are numbered with rotating icons")
    void sessionRowFallbacks() {
        String html = InvoiceService.buildSessionRowsHtml(List.of(
                item("October English & Maths", "60"),
                item("05/10/2026 | Science | Mon (online)", "15"),
                item("5th Oct | Art", "10"),
                item("Extra", "5")), "£");
        assertTrue(html.contains("session-icon-1\">Session 1</td><td class=\"session-date\"></td>"
                + "<td class=\"session-subject\">October English &amp; Maths</td>"), html);
        assertTrue(html.contains(">Mon (online)</td>"), html);
        assertTrue(html.contains(">5th Oct</td><td class=\"session-subject\">Art</td>"), html);
        assertTrue(html.contains("session-icon-1\">Session 4</td>"), html);
        assertTrue(html.contains("session-icon-2\">Session 2</td>"), html);
    }

    @Test
    @DisplayName("typed markup is escaped, and an empty invoice still renders a valid row")
    void sessionRowsAreEscaped() {
        String html = InvoiceService.buildSessionRowsHtml(List.of(item("<b>x</b> {{user_name}}", "1")), "£");
        assertFalse(html.contains("<b>"), html);
        assertFalse(html.contains("{{"), html);
        assertEquals("<tr><td colspan=\"5\">No sessions</td></tr>", InvoiceService.buildSessionRowsHtml(List.of(), "£"));
    }
}
