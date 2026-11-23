package vacademy.io.admin_core_service.features.commerce.report.export;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Excel: money as numbers, a bold totals row equal to the given totals, Hindi header, escaped text, sheet names. */
class ReportXlsxWriterTest {

    private static final List<ReportTable.Column> COLUMNS = List.of(
            ReportTable.text("customer", "Customer", "ग्राहक"),
            ReportTable.date("date", "Date", "तारीख़"),
            ReportTable.qty("quantity", "Quantity", "मात्रा"),
            ReportTable.money("taxable_value", "Taxable value", "कर योग्य मूल्य"),
            ReportTable.integer("invoices", "Invoices", "इनवॉइस"));

    @Test
    void writesNumbersDatesHindiHeaderAndTotals() throws IOException {
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("taxable_value", new BigDecimal("1357.40"));
        totals.put("invoices", 2L);
        totals.put("not_a_column", 9L);
        byte[] bytes;
        try (ReportXlsxWriter writer = new ReportXlsxWriter(true, 100)) {
            writer.sheet("a sales register sheet whose name is far too long for excel");
            writer.block(null, COLUMNS);
            writer.row(row("=HYPERLINK(\"http://x\")", "2026-11-01", new BigDecimal("2.5"), new BigDecimal("1234.50"), 1L));
            writer.row(row("Plain buyer", "2026-11-02", new BigDecimal("12"), new BigDecimal("122.90"), 1L));
            writer.totals(totals);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            writer.write(out);
            bytes = out.toByteArray();
            assertEquals(2, writer.rows());
        }
        try (XSSFWorkbook book = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            Sheet sheet = book.getSheetAt(0);
            assertEquals("a sales register sheet whose na", sheet.getSheetName());
            assertEquals(31, sheet.getSheetName().length());

            Row header = sheet.getRow(0);
            assertEquals("ग्राहक", header.getCell(0).getStringCellValue());
            assertEquals("कर योग्य मूल्य", header.getCell(3).getStringCellValue());
            assertTrue(book.getFontAt(header.getCell(0).getCellStyle().getFontIndex()).getBold());

            Row first = sheet.getRow(1);
            assertEquals("'=HYPERLINK(\"http://x\")", first.getCell(0).getStringCellValue());
            assertEquals(CellType.STRING, first.getCell(0).getCellType());
            Cell date = first.getCell(1);
            assertEquals(CellType.NUMERIC, date.getCellType());
            assertTrue(DateUtil.isCellDateFormatted(date));
            assertEquals(LocalDate.of(2026, 11, 1), date.getLocalDateTimeCellValue().toLocalDate());
            assertEquals(2.5, first.getCell(2).getNumericCellValue(), 0.0001);
            Cell money = first.getCell(3);
            assertEquals(CellType.NUMERIC, money.getCellType());
            assertEquals(1234.50, money.getNumericCellValue(), 0.0001);
            assertEquals("#,##0.00", money.getCellStyle().getDataFormatString());

            Row total = sheet.getRow(3);
            assertEquals("कुल", total.getCell(0).getStringCellValue());
            assertEquals(1357.40, total.getCell(3).getNumericCellValue(), 0.0001);
            assertEquals(2, total.getCell(4).getNumericCellValue(), 0.0001);
            assertTrue(book.getFontAt(total.getCell(3).getCellStyle().getFontIndex()).getBold());
            assertEquals(null, total.getCell(2), "no total for a column the totals do not name");
        }
    }

    @Test
    void englishHeaderAndBlocksOnOneSheet() throws IOException {
        byte[] bytes;
        try (ReportXlsxWriter writer = new ReportXlsxWriter(false, 100)) {
            writer.sheet("b2cs");
            writer.block(null, COLUMNS);
            writer.row(row("A", null, null, BigDecimal.TEN, 1L));
            writer.totals(Map.of("taxable_value", BigDecimal.TEN));
            writer.block("Credit notes netted here", COLUMNS);
            writer.row(row("B", null, null, BigDecimal.ONE, 1L));
            writer.totals(Map.of("taxable_value", BigDecimal.ONE));
            writer.sheet("b2cs");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            writer.write(out);
            bytes = out.toByteArray();
        }
        try (XSSFWorkbook book = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            Sheet sheet = book.getSheetAt(0);
            assertEquals("Customer", sheet.getRow(0).getCell(0).getStringCellValue());
            assertEquals("Total", sheet.getRow(2).getCell(0).getStringCellValue());
            assertEquals("Credit notes netted here", sheet.getRow(4).getCell(0).getStringCellValue());
            assertEquals("Customer", sheet.getRow(5).getCell(0).getStringCellValue());
            assertEquals(1.0, sheet.getRow(7).getCell(3).getNumericCellValue(), 0.0001);
            assertEquals("b2cs 2", book.getSheetAt(1).getSheetName(), "a repeated sheet name is made unique");
        }
    }

    @Test
    void theRowAfterTheCapIsRefused() throws IOException {
        try (ReportXlsxWriter writer = new ReportXlsxWriter(false, 1)) {
            writer.sheet("x");
            writer.block(null, COLUMNS);
            writer.row(row("A", null, null, null, null));
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> writer.row(row("B", null, null, null, null)));
            assertTrue(e.getMessage().startsWith("EXPORT_TOO_LARGE:"));
        }
    }

    private static Map<String, Object> row(String customer, String date, BigDecimal quantity, BigDecimal taxable,
                                           Long invoices) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("customer", customer);
        row.put("date", date);
        row.put("quantity", quantity);
        row.put("taxable_value", taxable);
        row.put("invoices", invoices);
        return row;
    }
}
