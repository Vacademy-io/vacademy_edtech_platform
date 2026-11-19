package vacademy.io.admin_core_service.features.commerce.document.pdf;

import org.junit.jupiter.api.Test;
import org.xml.sax.InputSource;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TestTaxData;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The printed documents: a tax invoice with one tax row per rate and an HSN summary, a bill of
 * supply and a plain invoice without tax, B2B fields, amount in words. Rates are TEST
 * placeholders from {@link TestTaxData}.
 */
class CommerceDocumentHtmlTest {

    private static TaxResult tax(TaxMode mode, String placeOfSupply) {
        return new CommerceTaxCalculator().calculate(TaxRequest.builder()
                .mode(mode).sellerStateCode("09").placeOfSupplyState(placeOfSupply).date(TestTaxData.DATE_TEST)
                .lines(List.of(
                        TaxLineInput.builder().lineRef("l1").lineType(TaxLineType.ITEM).description("Item <A> & co")
                                .unitPrice(new BigDecimal("525.00")).quantity(2)
                                .taxClass(TestTaxData.slabbedClassTest()).build(),
                        TaxLineInput.builder().lineRef("l2").lineType(TaxLineType.ITEM).description("Item B")
                                .unitPrice(new BigDecimal("2240.00")).quantity(1)
                                .taxClass(TestTaxData.slabbedClassTest()).build(),
                        TaxLineInput.builder().lineRef("l3").lineType(TaxLineType.SHIPPING).description("Shipping")
                                .unitPrice(new BigDecimal("118.00")).quantity(1)
                                .taxClass(TestTaxData.flatClassTest()).build()))
                .build());
    }

    private static DocumentView view(DocumentType type, TaxResult tax, String buyerGstin) {
        List<DocumentView.Line> lines = new ArrayList<>();
        for (TaxLineResult line : tax.getLines()) {
            lines.add(DocumentView.Line.builder().description(line.getDescription()).sku("SKU-" + line.getLineRef())
                    .hsnCode(line.getHsnCode()).quantity(line.getQuantity()).qtyScale(line.getQtyScale())
                    .unit(line.getUnit()).unitPrice(line.getUnitPrice()).discount(BigDecimal.ZERO)
                    .taxableValue(line.getTaxableValue()).ratePercent(line.getRatePercent()).amount(line.getNet())
                    .build());
        }
        return DocumentView.builder()
                .documentType(type).number("CC/2627-00042").date(LocalDate.of(2026, 11, 14)).orderNumber("ORD-1001")
                .sellerName("Test Seller TEST").sellerAddress("1 Test Road\nTest Town")
                .sellerGstin(tax.getMode() == TaxMode.UNREGISTERED ? null : "09AAACH7409R1ZZ").sellerStateCode("09")
                .buyerName("Buyer {{line_rows}} TEST").buyerPhone("9000000000").buyerGstin(buyerGstin)
                .billingAddress("2 Test Street").placeOfSupplyState(tax.getPlaceOfSupplyState())
                .taxHead(tax.getTaxHead()).currency("INR").lines(lines)
                .rateRows(tax.getRateRows()).hsnRows(tax.getHsnRows())
                .taxableValue(tax.getTaxableValue()).cgst(tax.getCgst()).sgst(tax.getSgst()).igst(tax.getIgst())
                .cess(tax.getCess()).roundOff(tax.getRoundOff()).total(tax.getTotal())
                .build();
    }

    private static void assertWellFormed(String html) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.newDocumentBuilder().parse(new InputSource(new StringReader(html)));
    }

    private static int count(String text, String part) {
        return text.split(java.util.regex.Pattern.quote(part), -1).length - 1;
    }

    @Test
    void aTaxInvoiceHasOneTaxRowPerRateAnHsnSummaryAndTheAmountInWords() throws Exception {
        String html = CommerceDocumentHtml.build(view(DocumentType.TAX_INVOICE, tax(TaxMode.REGULAR, "09"), null));

        assertWellFormed(html);
        assertTrue(html.contains("<h1>TAX INVOICE</h1>"));
        assertTrue(html.contains("GSTIN: 09AAACH7409R1ZZ"));
        assertTrue(html.contains("Tax by rate"));
        assertTrue(html.contains("HSN summary"));
        assertTrue(html.contains("<th class=\"num\">CGST</th><th class=\"num\">SGST</th>"));
        assertFalse(html.contains(">IGST<"));
        // Three rates (5%, 12%, 18%), each on one item line, one tax row and one HSN row.
        assertEquals(3, count(html, "<td class=\"num\">5%</td><td class=\"num\">"));
        assertEquals(3, count(html, "<td class=\"num\">12%</td><td class=\"num\">"));
        assertEquals(3, count(html, "<td class=\"num\">18%</td><td class=\"num\">"));
        // One row per rate in the tax table: three body rows between its header and the HSN summary.
        String rateTable = html.substring(html.indexOf("Tax by rate"), html.indexOf("HSN summary"));
        assertEquals(3, count(rateTable, "<tr><td class=\"num\">"));
        assertTrue(html.contains("Rupees Three Thousand Four Hundred Eight Only"));
        assertTrue(html.contains("Item &lt;A&gt; &amp; co"), "values are escaped");
        assertTrue(html.contains("Buyer &#123;&#123;line_rows}} TEST"), "a value cannot spell a placeholder");
        assertTrue(html.contains("1 Test Road<br/>Test Town"));
        assertTrue(html.contains("Original for recipient"));
        assertFalse(html.contains("{{"), "every placeholder was filled");
    }

    @Test
    void anInterStateB2bInvoiceShowsIgstAndTheBuyerGstin() throws Exception {
        String html = CommerceDocumentHtml.build(
                view(DocumentType.TAX_INVOICE, tax(TaxMode.REGULAR, "27"), "27AAPFU0939F1ZV"));

        assertWellFormed(html);
        assertTrue(html.contains("<th class=\"num\">IGST</th>"));
        assertFalse(html.contains(">CGST<"));
        assertTrue(html.contains("<b>GSTIN: 27AAPFU0939F1ZV</b>"));
        assertTrue(html.contains("Original for recipient (B2B)"));
        assertTrue(html.contains("Place of supply (state code)"));
    }

    @Test
    void aBillOfSupplyAndAPlainInvoiceCarryNoTax() throws Exception {
        String bill = CommerceDocumentHtml.build(
                view(DocumentType.BILL_OF_SUPPLY, tax(TaxMode.COMPOSITION, "09"), null));
        assertWellFormed(bill);
        assertTrue(bill.contains("<h1>BILL OF SUPPLY</h1>"));
        assertTrue(bill.contains("Composition taxable person, not eligible to collect tax on supplies."));
        assertFalse(bill.contains("Tax by rate"));
        assertFalse(bill.contains(">HSN<"));
        assertFalse(bill.contains("Taxable"));
        assertFalse(bill.contains("CGST"));

        String plain = CommerceDocumentHtml.build(view(DocumentType.INVOICE, tax(TaxMode.UNREGISTERED, "09"), null));
        assertWellFormed(plain);
        assertTrue(plain.contains("<h1>INVOICE</h1>"));
        assertFalse(plain.contains("GSTIN"));
        assertFalse(plain.contains("Tax by rate"));
        assertFalse(plain.contains("Composition"));
    }

    /** A measured line prints its length in metres and its rate per metre; a counted line keeps "2 PCS". */
    @Test
    void aMeasuredLinePrintsMetresAndTheRatePerMetre() throws Exception {
        String money = CommercePdfRenderer.unicodeFontAvailable() ? "₹" : "Rs. ";
        DocumentView view = DocumentView.builder()
                .documentType(DocumentType.INVOICE).number("CC/2627-00043").date(LocalDate.of(2026, 11, 19))
                .orderNumber("ORD-1002").sellerName("Test Seller TEST").sellerStateCode("09").buyerName("Buyer TEST")
                .currency("INR")
                .lines(List.of(
                        DocumentView.Line.builder().description("Cotton cloth").quantity(25).qtyScale(10).unit("MTR")
                                .unitPrice(new BigDecimal("12.34")).discount(BigDecimal.ZERO)
                                .amount(new BigDecimal("308.50")).build(),
                        DocumentView.Line.builder().description("Steel bottle").quantity(2).qtyScale(1).unit("PCS")
                                .unitPrice(new BigDecimal("250.00")).discount(BigDecimal.ZERO)
                                .amount(new BigDecimal("500.00")).build()))
                .total(new BigDecimal("808.50"))
                .build();

        String html = CommerceDocumentHtml.build(view);

        assertWellFormed(html);
        assertTrue(html.contains("<td class=\"num\">2.5 m</td>"), html);
        assertTrue(html.contains("<td class=\"num\">" + money + "123.40 / m</td>"));
        assertTrue(html.contains("<td class=\"num\">" + money + "308.50</td>"));
        assertFalse(html.contains("MTR"), "the stored code is not printed for a measured line");
        assertTrue(html.contains("<td class=\"num\">2 PCS</td>"), "a counted line prints as before");
        assertTrue(html.contains("<td class=\"num\">" + money + "250.00</td>"), "a counted rate has no unit");
    }

    @Test
    void theDocumentIsDrawnAsAPdf() {
        byte[] pdf = new CommercePdfRenderer().render(
                CommerceDocumentHtml.build(view(DocumentType.TAX_INVOICE, tax(TaxMode.REGULAR, "09"), null)));

        assertTrue(pdf.length > 1000);
        assertEquals("%PDF", new String(pdf, 0, 4, StandardCharsets.US_ASCII));
    }
}
