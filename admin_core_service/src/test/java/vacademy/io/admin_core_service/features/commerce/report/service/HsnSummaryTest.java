package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.GSTIN_BUYER;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.d;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.inv;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.note;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.query;

/** HSN summary: measured quantities in display units, services, B2B and B2C tables, credit notes, warnings. */
class HsnSummaryTest {

    private ReportFixtures.FakeRepository repo;
    private GstReportService service;

    @BeforeEach
    void setUp() {
        repo = new ReportFixtures.FakeRepository();
        service = new GstReportService(repo, new DocumentsIssuedService(repo));
    }

    private ReportAnswer run() {
        return service.hsnSummary(query());
    }

    private static Map<String, Object> row(ReportAnswer a, String section, String hsn, String uqc) {
        return a.getSections().stream().filter(s -> s.getKey().equals(section)).findFirst().orElseThrow()
                .getRows().stream().filter(r -> hsn.equals(r.get("hsn")) && uqc.equals(r.get("uqc"))).findFirst()
                .orElseThrow(() -> new AssertionError("no row " + hsn + " " + uqc + " in " + section));
    }

    private static Set<String> codes(ReportAnswer a) {
        return a.getWarnings().stream().map(ReportDtos.Warning::getCode).collect(Collectors.toSet());
    }

    @Test
    void measuredClothAddsUpInMetres() {
        repo.invoiceLines.add(inv().id("inv-1", "INV/2627-00001").qty(25, 10).total("324.00", "0.08")
                .value("308.50", "15.42").build());
        repo.invoiceLines.add(inv().id("inv-2", "INV/2627-00002").qty(34, 10).total("440.00", "-0.54")
                .value("419.56", "20.98").build());

        ReportAnswer a = run();

        Map<String, Object> cloth = row(a, "hsn_b2c", "5208", "MTR");
        assertEquals(0, d("5.9").compareTo((BigDecimal) cloth.get("quantity")), "2.5 m + 3.4 m, not 59");
        assertEquals(d("728.06"), cloth.get("taxable_value"));
        assertEquals(d("764.46"), cloth.get("total_value"));
        assertEquals("Cotton cloth", cloth.get("description"));
        assertEquals(d("5"), cloth.get("rate"));
        assertTrue(a.getWarnings().isEmpty(), a.getWarnings().toString());
        // 764.46 of HSN values + round-off -0.46 = the invoice totals 324.00 + 440.00.
        assertEquals(d("-0.46"), a.getTotals().get("round_off"));
        assertEquals(d("0.00"), a.getCheck().get("difference"));
        assertEquals(d("764.00"), a.getTotals().get("documents_total"));
    }

    @Test
    void shippingIsAServiceWithUqcNaAndNoQuantity() {
        repo.invoiceLines.add(inv().line("ship").hsn("9965", "PCS", "18").qty(1, null)
                .service("COMMERCE_SHIPPING", "Delivery").value("50.00", "9.00").total("59.00", "0").build());
        ReportAnswer a = run();
        Map<String, Object> shipping = row(a, "hsn_b2c", "9965", "NA");
        assertEquals(d("0.00"), shipping.get("quantity"));
        assertEquals("Delivery", shipping.get("description"));
        assertEquals(d("59.00"), shipping.get("total_value"));
        assertTrue(a.getWarnings().isEmpty(), "a service needs no scale and no UQC: " + a.getWarnings());
    }

    @Test
    void b2bAndB2cAreSeparateTablesAndCreditNotesSubtract() {
        InvoiceLine b2b = inv().id("inv-b", "INV/2627-00001").b2b(GSTIN_BUYER).qty(30, 10).total("105.00", "0")
                .value("100.00", "5.00").build();
        InvoiceLine b2c = inv().id("inv-c", "INV/2627-00002").qty(59, 10).total("210.00", "0")
                .value("200.00", "10.00").build();
        repo.invoiceLines.addAll(List.of(b2b, b2c));
        repo.noteLines.add(note("cn-1", "CN/2627-00001", b2c, "42.00", "0", 12, "40.00", "2.00"));

        ReportAnswer a = run();

        Map<String, Object> registered = row(a, "hsn_b2b", "5208", "MTR");
        assertEquals(0, d("3").compareTo((BigDecimal) registered.get("quantity")));
        assertEquals(d("100.00"), registered.get("taxable_value"));
        Map<String, Object> unregistered = row(a, "hsn_b2c", "5208", "MTR");
        assertEquals(0, d("4.7").compareTo((BigDecimal) unregistered.get("quantity")), "5.9 m sold - 1.2 m returned");
        assertEquals(d("160.00"), unregistered.get("taxable_value"));
        assertEquals(d("4.00"), unregistered.get("cgst"));
        assertEquals(d("168.00"), unregistered.get("total_value"));

        // Σ total value + round-off = Σ invoice totals − Σ note totals.
        assertEquals(d("273.00"), a.getTotals().get("total_value"));
        assertEquals(d("273.00"), a.getTotals().get("documents_total"));
        assertEquals(d("0.00"), a.getCheck().get("difference"));
        ReportDtos.Section roundOff = a.getSections().get(2);
        assertEquals("round_off", roundOff.getKey());
        assertEquals("Round-off (not part of HSN values)", roundOff.getRows().get(0).get("description"));
    }

    @Test
    void warnsAboutMissingHsnUnknownUnitsUnknownScalesAndRoundedQuantities() {
        repo.invoiceLines.add(inv().id("inv-1", "INV/2627-00001").hsn(null, "PCS", "5").value("10", "0.50").build());
        repo.invoiceLines.add(inv().id("inv-2", "INV/2627-00002").hsn("52", "PCS", "5").value("10", "0.50").build());
        repo.invoiceLines.add(inv().id("inv-3", "INV/2627-00003").hsn("6204", "THAAN", "12").value("10", "1.20")
                .build());
        repo.invoiceLines.add(inv().id("inv-4", "INV/2627-00004").hsn("6205", "MTR", "12").qty(7, null)
                .value("10", "1.20").build());
        repo.invoiceLines.add(inv().id("inv-5", "INV/2627-00005").hsn("7323", "KGS", "18").qty(1235, 1000)
                .value("10", "1.80").build());

        ReportAnswer a = run();

        assertTrue(codes(a).containsAll(Set.of("HSN_MISSING", "HSN_SHORT", "UQC_UNKNOWN", "SCALE_UNKNOWN",
                "QTY_ROUNDED")), codes(a).toString());
        assertEquals(d("1.24"), row(a, "hsn_b2c", "7323", "KGS").get("quantity"), "1.235 kg printed to 2 places");
        assertEquals(0, d("7").compareTo((BigDecimal) row(a, "hsn_b2c", "6205", "MTR").get("quantity")),
                "no scale: counted as 1");
        assertEquals("THAAN", row(a, "hsn_b2c", "6204", "THAAN").get("uqc"), "the stored code is kept");
    }

    @Test
    void everyPieceSpellingIsOnePcsRow() {
        String[] units = {"PCS", "PIECE", "pieces", "PC", "NO", "NOS"};
        int n = 1;
        for (String unit : units) {
            repo.invoiceLines.add(inv().id("inv-" + n, "INV/2627-0000" + n).hsn("6204", unit, "5").qty(2, 1)
                    .value("100", "5.00").build());
            n++;
        }
        ReportAnswer a = run();
        Map<String, Object> pcs = row(a, "hsn_b2c", "6204", "PCS");
        assertEquals(0, d("12").compareTo((BigDecimal) pcs.get("quantity")), "six lines of 2 pieces, one row");
        assertEquals(d("600.00"), pcs.get("taxable_value"));
        assertEquals(1, a.getSections().stream().filter(sec -> sec.getKey().equals("hsn_b2c")).findFirst()
                .orElseThrow().getRows().size());
        assertTrue(!codes(a).contains("UQC_UNKNOWN"), codes(a).toString());
    }

    @Test
    void theGstr1HsnSheetsAreTheSameRows() {
        repo.invoiceLines.add(inv().qty(25, 10).value("308.50", "15.42").total("324.00", "0.08").build());
        ReportAnswer hsn = run();
        ReportAnswer gstr1 = service.gstr1(query());
        ReportDtos.Section fromGstr1 = gstr1.getSections().stream().filter(s -> s.getKey().equals("hsn_b2c"))
                .findFirst().orElseThrow();
        assertEquals(hsn.getSections().get(1).getRows(), fromGstr1.getRows());
        assertEquals(hsn.getSections().get(1).getTotals(), fromGstr1.getTotals());
    }
}
