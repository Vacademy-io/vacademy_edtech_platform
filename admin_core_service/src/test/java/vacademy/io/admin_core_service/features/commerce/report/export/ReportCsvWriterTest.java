package vacademy.io.admin_core_service.features.commerce.report.export;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** CSV: byte-order mark, CRLF, English keys, plain numbers, formula-looking text made plain. */
class ReportCsvWriterTest {

    private static final List<ReportTable.Column> COLUMNS = List.of(
            ReportTable.text("customer", "Customer", "ग्राहक"),
            ReportTable.money("invoice_total", "Invoice total", "इनवॉइस की कुल राशि"),
            ReportTable.qty("quantity", "Quantity", "मात्रा"),
            ReportTable.date("date", "Date", "तारीख़"),
            ReportTable.integer("invoices", "Invoices", "इनवॉइस"),
            ReportTable.percent("rate", "Rate %", "दर %"));

    @Test
    void writesBomHeaderAndPlainNumbers() throws IOException {
        String csv = write(row("Cotton cloth buyer", new BigDecimal("1234.5"), new BigDecimal("5.90"), "2026-11-01",
                3L, new BigDecimal("5.000")));
        assertTrue(csv.startsWith("﻿"), "starts with the byte-order mark");
        assertTrue(csv.contains("\r\n"), "CRLF line ends");
        List<CSVRecord> records = parse(csv);
        assertEquals(List.of("customer", "invoice_total", "quantity", "date", "invoices", "rate"),
                records.get(0).toList());
        assertEquals(List.of("Cotton cloth buyer", "1234.50", "5.9", "2026-11-01", "3", "5"), records.get(1).toList());
    }

    @Test
    void formulaTextBecomesPlainText() throws IOException {
        String csv = write(
                row("=HYPERLINK(\"http://x\")", null, null, null, null, null),
                row("＝SUM(A1)", null, null, null, null, null),
                row("   +91 98", null, null, null, null, null),
                row("@cmd", null, null, null, null, null),
                row("-5", null, null, null, null, null),
                row("Plain \"quoted\" name", null, null, null, null, null));
        List<CSVRecord> records = parse(csv);
        assertEquals("'=HYPERLINK(\"http://x\")", records.get(1).get(0));
        assertEquals("'＝SUM(A1)", records.get(2).get(0));
        assertEquals("'   +91 98", records.get(3).get(0));
        assertEquals("'@cmd", records.get(4).get(0));
        assertEquals("'-5", records.get(5).get(0));
        assertEquals("Plain \"quoted\" name", records.get(6).get(0));
        assertEquals("", records.get(1).get(1), "null is an empty cell");
    }

    @Test
    void numbersAreNeverEscaped() throws IOException {
        String csv = write(row("x", new BigDecimal("-12.40"), new BigDecimal("-1.2"), null, -1L, null));
        CSVRecord record = parse(csv).get(1);
        assertEquals("-12.40", record.get(1));
        assertEquals("-1.2", record.get(2));
        assertEquals("-1", record.get(4));
    }

    @Test
    void theRowAfterTheCapIsRefused() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ReportCsvWriter writer = ReportCsvWriter.of(out, COLUMNS, 2)) {
            writer.row(row("a", null, null, null, null, null));
            writer.row(row("b", null, null, null, null, null));
            InvalidRequestException e = assertThrows(InvalidRequestException.class,
                    () -> writer.row(row("c", null, null, null, null, null)));
            assertEquals("EXPORT_TOO_LARGE: more than 2 rows; narrow the dates or pick a location", e.getMessage());
            assertEquals(2, writer.rows());
        }
    }

    @Test
    void blocksShareOneTableWithASectionColumn() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        List<ReportTable.Column> first = List.of(ReportTable.text("hsn", "HSN", "HSN"),
                ReportTable.money("taxable_value", "Taxable", "कर योग्य"));
        List<ReportTable.Column> second = List.of(ReportTable.text("description", "Description", "विवरण"),
                ReportTable.money("taxable_value", "Taxable", "कर योग्य"));
        try (ReportCsvWriter writer = ReportCsvWriter.ofSections(out, List.of(first, second), 10)) {
            writer.section("hsn_b2b");
            writer.row(Map.of("hsn", "5208", "taxable_value", new BigDecimal("10")));
            writer.section("exemp");
            writer.row(Map.of("description", "Intra", "taxable_value", new BigDecimal("2")));
        }
        List<CSVRecord> records = parse(out.toString(StandardCharsets.UTF_8));
        assertEquals(List.of("section", "hsn", "taxable_value", "description"), records.get(0).toList());
        assertEquals(List.of("hsn_b2b", "5208", "10.00", ""), records.get(1).toList());
        assertEquals(List.of("exemp", "", "2.00", "Intra"), records.get(2).toList());
    }

    private static String write(Map<String, Object>... rows) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ReportCsvWriter writer = ReportCsvWriter.of(out, COLUMNS, 100)) {
            for (Map<String, Object> row : rows) {
                writer.row(row);
            }
        }
        return out.toString(StandardCharsets.UTF_8);
    }

    private static List<CSVRecord> parse(String csv) throws IOException {
        String body = csv.startsWith("﻿") ? csv.substring(1) : csv;
        try (CSVParser parser = CSVParser.parse(new StringReader(body), CSVFormat.DEFAULT)) {
            return parser.getRecords();
        }
    }

    private static Map<String, Object> row(String customer, BigDecimal total, BigDecimal quantity, String date,
                                           Long invoices, BigDecimal rate) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("customer", customer);
        row.put("invoice_total", total);
        row.put("quantity", quantity);
        row.put("date", date);
        row.put("invoices", invoices);
        row.put("rate", rate);
        return row;
    }
}
