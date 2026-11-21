package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Writes files in the template: the blank template, the catalogue export and the error rows.
 *
 * <p>Every cell goes through {@link #escapeCell}: text that starts with = + - @ (or a tab or
 * carriage return) gets a leading apostrophe, so a spreadsheet shows it as text and never
 * runs it as a formula. The parser drops that apostrophe again on upload.
 *
 * <p>CSV output is UTF-8 with a byte-order mark, which is what makes Excel show Hindi.
 */
public final class ImportSheetWriter implements Closeable {

    private final CSVPrinter printer;
    private final boolean withErrors;
    private int rows;

    private ImportSheetWriter(OutputStream out, boolean withErrors) throws IOException {
        BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
        writer.write('﻿');
        this.printer = new CSVPrinter(writer, CSVFormat.DEFAULT);
        this.withErrors = withErrors;
        List<String> header = new ArrayList<>(ImportColumn.headers());
        if (withErrors) {
            header.add(ImportColumn.ERRORS_HEADER);
        }
        printer.printRecord(header);
    }

    /** A CSV in the template; the header row is written at once. */
    public static ImportSheetWriter csv(OutputStream out) throws IOException {
        return new ImportSheetWriter(out, false);
    }

    /** As {@link #csv}, with a last column "errors". */
    public static ImportSheetWriter csvWithErrors(OutputStream out) throws IOException {
        return new ImportSheetWriter(out, true);
    }

    public void writeRow(Map<ImportColumn, String> values) throws IOException {
        writeRow(values, null);
    }

    public void writeRow(Map<ImportColumn, String> values, String errors) throws IOException {
        ImportColumn[] columns = ImportColumn.values();
        List<String> record = new ArrayList<>(columns.length + 1);
        for (ImportColumn column : columns) {
            record.add(escapeCell(values.get(column)));
        }
        if (withErrors) {
            record.add(escapeCell(errors));
        }
        printer.printRecord(record);
        rows++;
    }

    public void writeRow(ImportRow row, String errors) throws IOException {
        Map<ImportColumn, String> values = new java.util.EnumMap<>(ImportColumn.class);
        for (ImportColumn column : ImportColumn.values()) {
            String value = row.get(column);
            if (value != null) {
                values.put(column, value);
            }
        }
        writeRow(values, errors);
    }

    public int rowsWritten() {
        return rows;
    }

    public void flush() throws IOException {
        printer.flush();
    }

    /** Flushes; the underlying stream belongs to the caller and stays open. */
    @Override
    public void close() throws IOException {
        printer.flush();
    }

    // ----------------------------------------------------------------- formula

    public static boolean isFormulaTrigger(char c) {
        return c == '=' || c == '+' || c == '-' || c == '@' || c == '\t' || c == '\r'
                // The full-width forms, which spreadsheets fold to the plain signs.
                || c == '\uFF1D' || c == '\uFF0B' || c == '\uFF0D' || c == '\uFF20';
    }

    /**
     * True when a spreadsheet could run the text as a formula: its first character is a
     * trigger, or the first one after leading spaces and line breaks is (they are skipped
     * when a cell is evaluated).
     */
    public static boolean startsLikeFormula(String value) {
        if (value == null || value.isEmpty()) {
            return false;
        }
        if (isFormulaTrigger(value.charAt(0))) {
            return true;
        }
        int i = 0;
        while (i < value.length() && (Character.isWhitespace(value.charAt(i)) || Character.isSpaceChar(value.charAt(i)))) {
            i++;
        }
        return i > 0 && i < value.length() && isFormulaTrigger(value.charAt(i));
    }

    /** Null becomes the empty cell; text a spreadsheet would run as a formula is made plain text. */
    public static String escapeCell(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return startsLikeFormula(value) ? "'" + value : value;
    }

    // ---------------------------------------------------------------- template

    /** The header row only, as CSV. */
    public static void writeTemplateCsv(OutputStream out) throws IOException {
        try (ImportSheetWriter writer = csv(out)) {
            writer.flush();
        }
    }

    /**
     * The header row on the sheet "products", every column formatted as text so a barcode or a
     * SKU of digits is not turned into a number, and a second sheet "guide" that explains each
     * column with an example. Only the first sheet is read on upload.
     */
    public static void writeTemplateXlsx(OutputStream out) throws IOException {
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            CellStyle text = workbook.createCellStyle();
            text.setDataFormat(workbook.createDataFormat().getFormat("@"));
            CellStyle head = workbook.createCellStyle();
            Font bold = workbook.createFont();
            bold.setBold(true);
            head.setFont(bold);
            head.setDataFormat(workbook.createDataFormat().getFormat("@"));

            Sheet products = workbook.createSheet("products");
            Row header = products.createRow(0);
            ImportColumn[] columns = ImportColumn.values();
            for (int i = 0; i < columns.length; i++) {
                products.setDefaultColumnStyle(i, text);
                products.setColumnWidth(i, 22 * 256);
                org.apache.poi.ss.usermodel.Cell cell = header.createCell(i);
                cell.setCellValue(columns[i].header());
                cell.setCellStyle(head);
            }
            products.createFreezePane(1, 1);

            Sheet guide = workbook.createSheet("guide");
            String[] titles = {"column", "level", "required", "what to enter", "example"};
            Row guideHeader = guide.createRow(0);
            for (int i = 0; i < titles.length; i++) {
                org.apache.poi.ss.usermodel.Cell cell = guideHeader.createCell(i);
                cell.setCellValue(titles[i]);
                cell.setCellStyle(head);
            }
            for (int i = 0; i < columns.length; i++) {
                ImportColumn column = columns[i];
                Row row = guide.createRow(i + 1);
                String[] cells = {column.header(), levelLabel(column), column.required() ? "yes" : "",
                        column.description(), escapeCell(column.example())};
                for (int c = 0; c < cells.length; c++) {
                    org.apache.poi.ss.usermodel.Cell cell = row.createCell(c);
                    cell.setCellValue(cells[c]);
                    cell.setCellStyle(text);
                }
            }
            guide.setColumnWidth(0, 26 * 256);
            guide.setColumnWidth(3, 90 * 256);
            guide.setColumnWidth(4, 40 * 256);
            workbook.write(out);
        }
    }

    public static String levelLabel(ImportColumn column) {
        return switch (column.level()) {
            case KEY -> "every row";
            case PRODUCT -> "product (first row of the product)";
            case VARIANT -> "variant (each row)";
        };
    }
}
