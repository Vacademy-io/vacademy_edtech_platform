package vacademy.io.admin_core_service.features.invoice.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A fee receipt spells the amount out in words, so the figure and the words have to agree.
 * The scale is Indian: crore / lakh / thousand, not million.
 */
class ReceiptAmountInWordsTest {

    private static String words(String amount) {
        return InvoiceService.amountInWords(new BigDecimal(amount));
    }

    @Test
    @DisplayName("a round thousand reads the way a receipt prints it")
    void roundThousand() {
        assertEquals("FIVE THOUSAND only", words("5000"));
    }

    @Test
    @DisplayName("Indian scale, not the short scale")
    void indianScale() {
        assertEquals("ONE LAKH TWENTY FIVE THOUSAND only", words("125000"));
        assertEquals("SEVENTY FIVE THOUSAND only", words("75000"));
        assertEquals("TEN LAKH only", words("1000000"));
        assertEquals("ONE CRORE only", words("10000000"));
        assertEquals("TWO CRORE FIFTY LAKH only", words("25000000"));
    }

    @Test
    @DisplayName("hundreds and the teens")
    void hundredsAndTeens() {
        assertEquals("ONE HUNDRED only", words("100"));
        assertEquals("NINE HUNDRED NINETY NINE only", words("999"));
        assertEquals("SIXTEEN only", words("16"));
        assertEquals("NINETEEN THOUSAND only", words("19000"));
    }

    @Test
    @DisplayName("paise appear only when there are any")
    void paise() {
        assertEquals("FIVE THOUSAND only", words("5000.00"));
        assertEquals("FIVE THOUSAND AND FIFTY PAISE only", words("5000.50"));
        assertEquals("NINETY NINE AND NINETY NINE PAISE only", words("99.99"));
    }

    @Test
    @DisplayName("nothing sensible to say for nothing, or for a negative")
    void edges() {
        assertEquals("ZERO only", words("0"));
        assertEquals("", InvoiceService.amountInWords(null));
        assertEquals("", InvoiceService.amountInWords(new BigDecimal("-1")));
    }

    @Test
    @DisplayName("the course code is the prefix of a plan name, and nothing when there is no code")
    void courseCode() {
        assertEquals("PGDXX",
                InvoiceService.deriveCourseCode("PGDXX - Post Graduate Diploma in Example Studies (Offline)"));
        assertEquals("A&B", InvoiceService.deriveCourseCode("A&B - Alpha and Beta"));
        // a plain course name carries no code, and a guess on a receipt is worse than a blank
        assertEquals("", InvoiceService.deriveCourseCode("Post Graduate Diploma in Example Studies"));
        assertEquals("", InvoiceService.deriveCourseCode("Beginners - Evening Batch"));
        assertEquals("", InvoiceService.deriveCourseCode(null));
        assertEquals("", InvoiceService.deriveCourseCode(""));
    }

    @Test
    @DisplayName("the fee schedule is read only when the template actually asks for it")
    void receiptFieldDetection() {
        // Most institutes print an invoice, not a receipt; they should not pay a query for
        // placeholders their template never mentions.
        assertTrue(InvoiceService.usesReceiptFields("<p>{{total_fees_due}}</p>"));
        assertTrue(InvoiceService.usesReceiptFields("<p>{{course_name}}</p>"));
        assertFalse(InvoiceService.usesReceiptFields("<p>{{total_amount}} {{user_name}}</p>"));
        assertFalse(InvoiceService.usesReceiptFields(""));
        assertFalse(InvoiceService.usesReceiptFields(null));
    }

    private static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }

    @Test
    @DisplayName("the paid figures read the same whichever side of allocation the receipt is rendered on")
    void paidFiguresAreOrderingIndependent() {
        // Learner had paid 5,000 and is now paying 30,000.
        // After allocation the schedule already totals 35,000.
        BigDecimal afterTotal = InvoiceService.totalCollected(bd("35000"), bd("30000"), true);
        // Before allocation it still totals only 5,000.
        BigDecimal beforeTotal = InvoiceService.totalCollected(bd("5000"), bd("30000"), false);
        assertEquals(0, afterTotal.compareTo(beforeTotal), "total paid must not depend on ordering");
        assertEquals(0, afterTotal.compareTo(bd("35000")));

        assertEquals(0, InvoiceService.paidBefore(afterTotal, bd("30000")).compareTo(bd("5000")));
        assertEquals(0, InvoiceService.paidBefore(beforeTotal, bd("30000")).compareTo(bd("5000")));
    }

    @Test
    @DisplayName("a first payment shows nothing paid previously, never a negative")
    void firstPaymentAndEdges() {
        BigDecimal total = InvoiceService.totalCollected(bd("0"), bd("5000"), false);
        assertEquals(0, total.compareTo(bd("5000")));
        assertEquals(0, InvoiceService.paidBefore(total, bd("5000")).compareTo(BigDecimal.ZERO));

        // a payment recorded outside the schedule must not print a negative "previously paid"
        assertEquals(0, InvoiceService.paidBefore(bd("1000"), bd("5000")).compareTo(BigDecimal.ZERO));
        assertEquals(0, InvoiceService.totalCollected(null, null, false).compareTo(BigDecimal.ZERO));
        assertEquals(0, InvoiceService.paidBefore(null, null).compareTo(BigDecimal.ZERO));
    }
}
