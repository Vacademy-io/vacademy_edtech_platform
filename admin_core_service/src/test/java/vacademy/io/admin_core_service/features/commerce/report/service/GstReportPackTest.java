package vacademy.io.admin_core_service.features.commerce.report.service;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.InvoiceLine;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.SalesRegisterTotals;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.DAY;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.GSTIN_BUYER;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.GSTIN_SELLER;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.d;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.inv;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.note;
import static vacademy.io.admin_core_service.features.commerce.report.service.ReportFixtures.query;

/** The month workbook: its sheets in order, and each sheet's totals row equal to the JSON section. */
class GstReportPackTest {

    private ReportFixtures.FakeRepository repo;
    private GstReportService service;

    @BeforeEach
    void setUp() {
        repo = new ReportFixtures.FakeRepository();
        service = new GstReportService(repo, new DocumentsIssuedService(repo));
        InvoiceLine b2b = inv().id("inv-b2b", "INV/2627-00001").b2b(GSTIN_BUYER).total("105.00", "0")
                .value("100.00", "5.00").build();
        InvoiceLine b2cl = inv().id("inv-b2cl", "INV/2627-00002").inter("33").total("2100.00", "0")
                .value("2000.00", "100.00").build();
        InvoiceLine b2cs = inv().id("inv-b2cs", "INV/2627-00003").qty(25, 10).total("525.00", "0")
                .value("500.00", "25.00").build();
        InvoiceLine zero = inv().id("inv-zero", "INV/2627-00004").hsn("5007", "PCS", "0").total("80.00", "0")
                .value("80.00", "0").build();
        repo.invoiceLines.addAll(List.of(b2b, b2cl, b2cs, zero));
        repo.noteLines.add(note("cn-1", "CN/2627-00001", b2cl, "210.00", "0", 1, "200.00", "10.00"));
        repo.noteLines.add(note("cn-2", "CN/2627-00002", b2cs, "52.50", "0", 10, "50.00", "2.50"));
        repo.noteLines.add(note("cn-3", "CN/2627-00003", b2b, "10.50", "0", 1, "10.00", "0.50"));
        repo.salesRows.add(new SalesRegisterRow("inv-b2b", "INV/2627-00001", null, DAY, "TAX_INVOICE", "POS", "L1",
                "ORD-1", GSTIN_BUYER, "29", GSTIN_SELLER, d("105.00"), d("0"), false, null, 1,
                "{\"buyer_name\":\"Plain buyer\"}", "CASH", "5208", d("5"), d("100.00"), d("2.50"), d("2.50"),
                d("0"), d("0")));
        repo.salesTotals = new SalesRegisterTotals(d("100.00"), d("2.50"), d("2.50"), d("0"), d("0"), d("0"),
                d("105.00"), 1, 0, d("0"));
    }

    @Test
    void sheetsAreInOrderAndEachTotalsRowEqualsItsSection() throws IOException {
        ReportQuery q = query().toBuilder().b2clLimit(d("1000")).build();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int rows = service.gstPack(q, out, 50_000);
        assertTrue(rows > 0);

        ReportAnswer gstr1 = service.gstr1(q);
        ReportAnswer taxByRate = service.taxByRate(q);
        ReportAnswer register = service.salesRegister(q);
        Map<String, ReportDtos.Section> sections = new HashMap<>();
        gstr1.getSections().forEach(s -> sections.put(s.getKey(), s));

        try (XSSFWorkbook book = new XSSFWorkbook(new ByteArrayInputStream(out.toByteArray()))) {
            List<String> names = new ArrayList<>();
            for (int i = 0; i < book.getNumberOfSheets(); i++) {
                names.add(book.getSheetName(i));
            }
            assertEquals(GstReportService.PACK_SHEETS, names);

            Map<String, String> sheetToSection = Map.of("b2b", "b2b", "b2cl", "b2cl", "b2cs", "b2cs", "cdnr", "cdnr",
                    "cdnur", "cdnur", "exemp", "exemp", "hsn(b2b)", "hsn_b2b", "hsn(b2c)", "hsn_b2c", "docs", "docs");
            for (Map.Entry<String, String> e : sheetToSection.entrySet()) {
                ReportDtos.Section section = sections.get(e.getValue());
                assertFirstBlockTotals(book.getSheet(e.getKey()), section.getColumns(), section.getRows().size(),
                        section.getTotals());
            }
            assertFirstBlockTotals(book.getSheet("sales register"), register.getColumns(), register.getRows().size(),
                    register.getTotals());
            ReportDtos.Section invoices = taxByRate.getSections().get(0);
            // tax by rate starts with a title row.
            assertFirstBlockTotals(book.getSheet("tax by rate"), invoices.getColumns(), invoices.getRows().size(),
                    invoices.getTotals(), 1);
        }
        // The section figures the sheets were checked against are the expected ones.
        assertEquals(d("100.00"), sections.get("b2b").getTotals().get("taxable_value"));
        assertEquals(d("450.00"), sections.get("b2cs").getTotals().get("taxable_value"));
        assertEquals(d("80.00"), sections.get("exemp").getTotals().get("nil_or_exempt"));
        assertEquals(d("0.00"), gstr1.getCheck().get("difference"));
    }

    private static void assertFirstBlockTotals(Sheet sheet, List<ReportDtos.ColumnDto> columns, int rows,
                                               Map<String, Object> totals) {
        assertFirstBlockTotals(sheet, columns, rows, totals, 0);
    }

    private static void assertFirstBlockTotals(Sheet sheet, List<ReportDtos.ColumnDto> columns, int rows,
                                               Map<String, Object> totals, int headerRow) {
        Row total = sheet.getRow(headerRow + rows + 1);
        int checked = 0;
        for (int c = 0; c < columns.size(); c++) {
            Object expected = totals.get(columns.get(c).getKey());
            if (expected instanceof Number number) {
                Cell cell = total.getCell(c);
                assertEquals(CellType.NUMERIC, cell.getCellType(), sheet.getSheetName() + " " + columns.get(c).getKey());
                assertEquals(new BigDecimal(number.toString()).doubleValue(), cell.getNumericCellValue(), 0.001,
                        sheet.getSheetName() + " " + columns.get(c).getKey());
                checked++;
            }
        }
        assertTrue(checked > 0, sheet.getSheetName() + ": no total checked");
    }
}
