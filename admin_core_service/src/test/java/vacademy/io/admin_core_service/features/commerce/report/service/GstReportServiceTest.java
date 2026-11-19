package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.CreditNoteTotals;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterTotals;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.DAY;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.GSTIN_BUYER;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.GSTIN_SELLER;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.d;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.inv;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.note;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.query;

/** Sales register, credit notes, tax by rate and GSTR-1 on fixed rows. */
class GstReportServiceTest {

    private ReportFixtures.FakeRepository repo;
    private GstReportService service;

    @BeforeEach
    void setUp() {
        repo = new ReportFixtures.FakeRepository();
        service = new GstReportService(repo, new DocumentsIssuedService(repo));
    }

    // ------------------------------------------------------------------ sales register

    private static SalesRegisterRow sale(String id, String number, int group, boolean cancelled, LocalDate cancelledOn,
                                         String hsn, String rate, String taxable, String tax) {
        BigDecimal half = d(tax).divide(d("2"));
        return new SalesRegisterRow(id, number, null, DAY, "TAX_INVOICE", "POS", "L1", "ORD-" + id, null, "29",
                GSTIN_SELLER, d("1102.00"), d("-0.40"), cancelled, cancelledOn, group,
                group == 1 ? "{\"buyer_name\":\"=HYPERLINK(\\\"http://x\\\")\",\"order_number\":\"ORD\"}" : null,
                group == 1 ? "CASH+UPI" : null, hsn, d(rate), d(taxable), half, half, d("0"), d("0"));
    }

    @Test
    void invoiceCellsAreOnTheFirstRowOnlyAndTheCustomerComesFromTheSnapshot() {
        repo.salesRows.add(sale("inv-1", "INV/2627-00001", 1, false, null, "5208", "5", "1000.00", "50.00"));
        repo.salesRows.add(sale("inv-1", "INV/2627-00001", 2, false, null, "9965", "18", "44.00", "7.92"));
        repo.salesTotals = new SalesRegisterTotals(d("1044.00"), d("28.96"), d("28.96"), d("0"), d("0"), d("-0.40"),
                d("1101.52"), 1, 0, d("0"));

        ReportAnswer a = service.salesRegister(query());

        assertEquals("sales-register", a.getReport());
        assertEquals(2, a.getRows().size());
        Map<String, Object> first = a.getRows().get(0);
        Map<String, Object> second = a.getRows().get(1);
        assertEquals("INV/2627-00001", first.get("invoice_number"));
        assertEquals("2026-11-10", first.get("date"));
        assertEquals(d("1102.00"), first.get("invoice_total"));
        assertEquals(d("-0.40"), first.get("round_off"));
        assertEquals("CASH+UPI", first.get("payment_mode"));
        assertEquals("ACTIVE", first.get("status"));
        assertEquals("=HYPERLINK(\"http://x\")", first.get("customer"), "JSON keeps the raw text; files escape it");
        assertEquals("29-Karnataka", first.get("place_of_supply"));
        for (String key : List.of("invoice_number", "date", "invoice_total", "round_off", "payment_mode", "status")) {
            assertNull(second.get(key), key + " only on the first row");
        }
        assertEquals("=HYPERLINK(\"http://x\")", second.get("customer"), "other invoice cells on every row");
        assertEquals("9965", second.get("hsn"));
        assertEquals(d("18"), second.get("rate"));
        assertEquals(d("3.96"), second.get("cgst"));

        assertEquals(d("1101.52"), a.getTotals().get("invoice_total"));
        assertEquals(1L, a.getTotals().get("invoices"));
        assertEquals(d("0.00"), a.getCheck().get("difference"));
        assertTrue(a.getWarnings().isEmpty());
    }

    @Test
    void aCancelledInvoiceIsListedAsCancelledAndWarnedWhenVoidedInALaterMonth() {
        repo.salesRows.add(sale("inv-9", "INV/2627-00009", 1, true, LocalDate.of(2026, 12, 1), "5208", "5", "100.00",
                "5.00"));
        repo.salesTotals = new SalesRegisterTotals(d("0"), d("0"), d("0"), d("0"), d("0"), d("0"), d("0"), 0, 1,
                d("1102.00"));

        ReportAnswer a = service.salesRegister(query());

        assertEquals("CANCELLED", a.getRows().get(0).get("status"));
        assertEquals(d("0.00"), a.getTotals().get("invoice_total"), "a cancelled invoice is out of the totals");
        assertEquals(1L, a.getTotals().get("cancelled_invoices"));
        assertEquals(d("1102.00"), a.getTotals().get("cancelled_total"));
        assertEquals("CANCELLED_AFTER_MONTH", a.getWarnings().get(0).getCode());
        assertEquals("INV/2627-00009", a.getWarnings().get(0).getRef());
    }

    @Test
    void aPageStopsAtSizeInvoicesAndHandsBackACursor() {
        repo.salesRows.add(sale("inv-1", "INV/2627-00001", 1, false, null, "5208", "5", "1", "0"));
        repo.salesRows.add(sale("inv-1", "INV/2627-00001", 2, false, null, "9965", "18", "1", "0"));
        repo.salesRows.add(sale("inv-2", "INV/2627-00002", 1, false, null, "5208", "5", "1", "0"));
        repo.salesRows.add(sale("inv-3", "INV/2627-00003", 1, false, null, "5208", "5", "1", "0"));

        ReportAnswer a = service.salesRegister(query().toBuilder().size(2).build());

        assertEquals(3, a.getRows().size(), "two invoices, three groups");
        assertNotNull(a.getNextCursor());
        Keyset keyset = ReportCursor.decode(a.getNextCursor());
        assertEquals("INV/2627-00002", keyset.number());
        assertEquals("inv-2", keyset.id());
        assertEquals(DAY, keyset.date());

        repo.salesRows.remove(3);
        assertNull(service.salesRegister(query().toBuilder().size(2).build()).getNextCursor(), "last page");
    }

    @Test
    void twoGstinsWithoutOneNamedIsRefused() {
        repo.gstins.addAll(List.of("29AAAAA0000A1Z5", "33BBBBB1111B1Z5"));
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> service.salesRegister(query()));
        assertTrue(e.getMessage().startsWith("GSTIN_REQUIRED:"));
        assertTrue(e.getMessage().contains("33BBBBB1111B1Z5"));

        ReportAnswer named = service.salesRegister(query().toBuilder().sellerGstin("33BBBBB1111B1Z5").build());
        assertEquals("33BBBBB1111B1Z5", named.getFilters().get("seller_gstin"));
        assertEquals("33BBBBB1111B1Z5", repo.filters.get(repo.filters.size() - 1).sellerGstin());
    }

    // ------------------------------------------------------------------ credit notes

    private static CreditNoteRow noteRow(String id, int group, String roundOff, long quantity, Integer scale,
                                         String unit, String unitPrice, boolean service) {
        return new CreditNoteRow(id, "CN/2627-00001", DAY, "INV/2627-00001", DAY.minusDays(3), "RET-1", null, "33",
                "Returned", "POS", "L1", GSTIN_SELLER, d("100.00"), d(roundOff), group, "5208", d("5"), unit,
                unitPrice == null ? null : d(unitPrice), scale, service, quantity, d("95.24"), d("0"), d("0"),
                d("4.76"), d("0"), d("100.00"));
    }

    @Test
    void creditNotesCarryANegativeRoundOffAndShowMeasuredQuantities() {
        repo.noteRows.add(noteRow("cn-1", 1, "-0.36", 12, 10, "MTR", "12.34", false));
        repo.noteRows.add(noteRow("cn-1", 2, "-0.36", 2, 1, "PCS", "250.00", false));
        repo.noteTotals = new CreditNoteTotals(d("190.48"), d("0"), d("0"), d("9.52"), d("0"), d("200.36"),
                d("-0.36"), d("200.00"), 1);

        ReportAnswer a = service.creditNotes(query());

        Map<String, Object> first = a.getRows().get(0);
        assertEquals("CN/2627-00001", first.get("note_number"));
        assertEquals(d("-0.36"), first.get("round_off"));
        assertEquals(d("100.00"), first.get("note_total"));
        assertEquals("1.2 m", first.get("quantity_text"));
        assertEquals(0, d("1.2").compareTo((BigDecimal) first.get("quantity")));
        assertEquals("₹123.40 / m", first.get("rate_text"));
        assertEquals(d("123.40"), first.get("rate_per_unit"));
        assertEquals("33-Tamil Nadu", first.get("place_of_supply"));
        assertEquals("INV/2627-00001", first.get("invoice_number"));

        Map<String, Object> second = a.getRows().get(1);
        assertNull(second.get("note_number"));
        assertNull(second.get("round_off"));
        assertEquals("2 PCS", second.get("quantity_text"));
        assertEquals("₹250.00", second.get("rate_text"));

        assertEquals(d("-0.36"), a.getTotals().get("round_off"));
        assertEquals(d("0.00"), a.getCheck().get("difference"), "lines 200.36 + round-off -0.36 = 200.00");
    }

    @Test
    void anUnknownScaleCountsAsOneWithAWarning() {
        repo.noteRows.add(noteRow("cn-1", 1, "0", 12, null, "MTR", "12.34", false));
        repo.noteRows.add(noteRow("cn-1", 2, "0", 1, null, null, "40.00", true));
        ReportAnswer a = service.creditNotes(query());
        assertEquals("12 MTR", a.getRows().get(0).get("quantity_text"));
        assertEquals(1, a.getWarnings().size(), "a service line has no scale to know");
        assertEquals("SCALE_UNKNOWN", a.getWarnings().get(0).getCode());
    }

    // ------------------------------------------------------------------ tax by rate

    @Test
    void taxByRateNetsCreditNotesByRateLocationAndChannel() {
        InvoiceLine cloth = inv().total("1050.00", "0").value("1000.00", "50.00").build();
        InvoiceLine shipping = inv().line("line-2").total("1050.00", "0").hsn("9965", null, "18")
                .service("COMMERCE_SHIPPING", "Delivery").value("0", "0").build();
        repo.invoiceLines.add(cloth);
        repo.invoiceLines.add(shipping);
        repo.invoiceLines.add(inv().id("inv-2", "INV/2627-00002").type("BILL_OF_SUPPLY").value("10", "0").build());
        repo.noteLines.add(note("cn-1", "CN/2627-00001", cloth, "105.00", "0", 10, "100.00", "5.00"));

        ReportAnswer a = service.taxByRate(query());

        assertEquals(List.of("invoices", "credit_notes", "net"),
                a.getSections().stream().map(ReportDtos.Section::getKey).toList());
        ReportDtos.Section net = a.getSections().get(2);
        Map<String, Object> five = net.getRows().stream().filter(r -> d("5").equals(r.get("rate"))).findFirst()
                .orElseThrow();
        assertEquals(d("900.00"), five.get("taxable_value"));
        assertEquals(d("22.50"), five.get("cgst"));
        assertEquals(d("45.00"), five.get("total_tax"));
        assertEquals("L1", five.get("location"));
        assertEquals("POS", five.get("channel"));
        assertEquals(d("900.00"), a.getTotals().get("taxable_value"));
        assertEquals("NOT_A_TAX_INVOICE", a.getWarnings().get(0).getCode());
    }

    // ------------------------------------------------------------------ GSTR-1

    @Test
    void gstr1SectionsAddUpToTheDocuments() {
        InvoiceLine b2b = inv().id("inv-b2b", "INV/2627-00001").b2b(GSTIN_BUYER).total("105.00", "0")
                .value("100.00", "5.00").build();
        InvoiceLine b2cl = inv().id("inv-b2cl", "INV/2627-00002").inter("33").total("2100.00", "0")
                .value("2000.00", "100.00").build();
        InvoiceLine b2cs = inv().id("inv-b2cs", "INV/2627-00003").total("525.00", "0").value("500.00", "25.00")
                .build();
        InvoiceLine zero = inv().id("inv-zero", "INV/2627-00004").hsn("5007", "PCS", "0").total("80.00", "0")
                .value("80.00", "0").build();
        repo.invoiceLines.addAll(List.of(b2b, b2cl, b2cs, zero));
        repo.noteLines.add(note("cn-b2cl", "CN/2627-00001", b2cl, "210.00", "0", 1, "200.00", "10.00"));
        repo.noteLines.add(note("cn-b2cs", "CN/2627-00002", b2cs, "52.50", "0", 1, "50.00", "2.50"));
        repo.noteLines.add(note("cn-b2b", "CN/2627-00003", b2b, "10.50", "0", 1, "10.00", "0.50"));
        repo.snapshots.put("inv-b2b", "{\"buyer_name\":\"Plain buyer\"}");

        ReportAnswer a = service.gstr1(query().toBuilder().b2clLimit(d("1000")).build());

        Map<String, ReportDtos.Section> s = new java.util.HashMap<>();
        a.getSections().forEach(x -> s.put(x.getKey(), x));
        assertEquals(List.of("b2b", "b2cl", "b2cs", "b2cs_credit_notes", "cdnr", "cdnur", "exemp", "hsn_b2b",
                "hsn_b2c", "docs", "docs_bill_books"), a.getSections().stream().map(ReportDtos.Section::getKey).toList());
        assertEquals("Plain buyer", s.get("b2b").getRows().get(0).get("receiver_name"));
        assertEquals("Plain buyer", s.get("cdnr").getRows().get(0).get("receiver_name"));
        assertEquals("INV/2627-00002", s.get("b2cl").getRows().get(0).get("invoice_number"));
        assertEquals(d("450.00"), s.get("b2cs").getRows().get(0).get("taxable_value"), "500 net of the 50 note");
        assertEquals("OE", s.get("b2cs").getRows().get(0).get("type"));
        assertEquals("CN/2627-00002", s.get("b2cs_credit_notes").getRows().get(0).get("note_number"));
        assertEquals("B2CL", s.get("cdnur").getRows().get(0).get("ur_type"));
        assertEquals(d("80.00"), s.get("exemp").getRows().get(3).get("nil_or_exempt"), "intra-state, unregistered");
        assertEquals(d("0.00"), a.getCheck().get("difference"));
        assertEquals("1000", a.getFilters().get("b2cl_limit"));
        assertTrue(a.getWarnings().stream().anyMatch(w -> w.getCode().equals("ZERO_RATE_SPLIT_UNKNOWN")));
        assertTrue(a.getWarnings().stream().noneMatch(w -> w.getCode().equals("GSTR1_DOES_NOT_ADD_UP")));

        // The same invoice with the default limit (1,00,000) is B2C small, and its note is netted there.
        ReportAnswer byDefault = service.gstr1(query());
        Map<String, ReportDtos.Section> t = new java.util.HashMap<>();
        byDefault.getSections().forEach(x -> t.put(x.getKey(), x));
        assertTrue(t.get("b2cl").getRows().isEmpty());
        assertTrue(t.get("cdnur").getRows().isEmpty());
        assertEquals(d("0.00"), byDefault.getCheck().get("difference"));
    }

    @Test
    void placeOfSupplyText() {
        assertEquals("29-Karnataka", GstReportService.placeOfSupply("29"));
        assertEquals("99", GstReportService.placeOfSupply("99"));
        assertNull(GstReportService.placeOfSupply(null));
    }
}
