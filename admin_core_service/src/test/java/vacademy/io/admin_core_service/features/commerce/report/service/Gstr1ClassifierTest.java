package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.service.Gstr1Classifier.ExempBucket;
import vacademy.io.admin_core_service.features.commerce.report.service.Gstr1Classifier.Section;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The GSTR-1 section of a document line. */
class Gstr1ClassifierTest {

    private static final BigDecimal LIMIT = new BigDecimal("100000");
    private static final BigDecimal FIVE = new BigDecimal("5");
    private static final String GSTIN = "33BBBBB1111B1Z5";

    private static Section line(String type, String gstin, boolean inter, String total, String rate) {
        return Gstr1Classifier.invoiceLine(type, gstin, inter, new BigDecimal(total), new BigDecimal(rate), LIMIT);
    }

    @Test
    void intraStateB2cIsB2cs() {
        assertEquals(Section.B2CS, line("TAX_INVOICE", null, false, "500000", "5"));
    }

    @Test
    void interStateB2cAtTheLimitIsB2csAndAPaisaAboveIsB2cl() {
        assertEquals(Section.B2CS, line("TAX_INVOICE", null, true, "100000.00", "5"));
        assertEquals(Section.B2CL, line("TAX_INVOICE", null, true, "100000.01", "5"));
        assertEquals(Section.B2CL, Gstr1Classifier.invoiceLine("TAX_INVOICE", null, true, new BigDecimal("500.01"),
                FIVE, new BigDecimal("500")), "the limit is a parameter");
    }

    @Test
    void aBuyerGstinIsB2b() {
        assertEquals(Section.B2B, line("TAX_INVOICE", GSTIN, true, "500000", "5"));
        assertEquals(Section.B2B, line("TAX_INVOICE", GSTIN, false, "10", "12"));
    }

    @Test
    void rateZeroIsExempInFourBuckets() {
        assertEquals(Section.EXEMP, line("TAX_INVOICE", GSTIN, false, "10", "0"));
        assertEquals(Section.EXEMP, line("TAX_INVOICE", null, true, "500000", "0.000"));
        assertEquals(ExempBucket.INTER_REGISTERED, Gstr1Classifier.exempBucket(true, true));
        assertEquals(ExempBucket.INTRA_REGISTERED, Gstr1Classifier.exempBucket(true, false));
        assertEquals(ExempBucket.INTER_UNREGISTERED, Gstr1Classifier.exempBucket(false, true));
        assertEquals(ExempBucket.INTRA_UNREGISTERED, Gstr1Classifier.exempBucket(false, false));
    }

    @Test
    void creditNotesFollowTheirInvoice() {
        assertEquals(Section.CDNUR, Gstr1Classifier.noteLine(Section.B2CL, null, FIVE), "note on a b2cl invoice");
        assertEquals(Section.B2CS, Gstr1Classifier.noteLine(Section.B2CS, null, FIVE), "netted into b2cs");
        assertEquals(Section.CDNR, Gstr1Classifier.noteLine(Section.B2B, GSTIN, FIVE), "note with a GSTIN");
        assertEquals(Section.B2CS, Gstr1Classifier.noteLine(Section.B2CS, "", FIVE),
                "a reissue note copies the empty GSTIN of its B2C invoice");
        assertEquals(Section.EXEMP, Gstr1Classifier.noteLine(Section.B2B, GSTIN, BigDecimal.ZERO));
        assertEquals(Section.NONE, Gstr1Classifier.noteLine(Section.NONE, GSTIN, FIVE));
    }

    @Test
    void aBillOfSupplyOrPlainInvoiceIsInNoSection() {
        assertEquals(Section.NONE, line("BILL_OF_SUPPLY", null, false, "10", "0"));
        assertEquals(Section.NONE, line("INVOICE", GSTIN, false, "10", "5"));
        assertEquals(Section.NONE, Gstr1Classifier.invoiceClass("BILL_OF_SUPPLY", null, false, BigDecimal.TEN, LIMIT));
    }

    @Test
    void interStateFromTheTaxHeadElseTheStates() {
        assertTrue(Gstr1Classifier.interState("IGST", "29", "29"));
        assertFalse(Gstr1Classifier.interState("CGST_SGST", "33", "29"));
        assertTrue(Gstr1Classifier.interState("NONE", "33", "29"));
        assertFalse(Gstr1Classifier.interState(null, "29", "29"));
    }
}
