package vacademy.io.admin_core_service.features.commerce.catalogue.importer.file;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.poi.openxml4j.opc.OPCPackage;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.util.CellReference;
import org.apache.poi.util.XMLHelper;
import org.apache.poi.xssf.eventusermodel.ReadOnlySharedStringsTable;
import org.apache.poi.xssf.eventusermodel.XSSFReader;
import org.apache.poi.xssf.eventusermodel.XSSFSheetXMLHandler;
import org.apache.poi.xssf.usermodel.XSSFComment;
import org.springframework.stereotype.Component;
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.StringReader;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipInputStream;

/**
 * Reads an upload in the fixed template: .csv (UTF-8, with or without a byte-order mark) or
 * .xlsx (first sheet). Nothing here touches the database.
 *
 * <p>Every failure of the file as a whole (size, type, encoding, header, row cap) is the
 * standard 400. Problems of single rows are left to the planner.
 *
 * <p>The .xlsx reader is the streaming one: the sheet is never built in memory. The workbook
 * reader does keep every part of the archive in memory, and its own zip-bomb guard allows a
 * hundredfold expansion, so before a workbook is opened the archive is unpacked once into
 * nothing and counted ({@link #requireSmallWorkbook}): above
 * {@link ImportLimits#MAX_XLSX_UNPACKED_BYTES} it is refused. The count is of the bytes that
 * really come out, never of the sizes the archive declares. Cell and sheet length are
 * enforced while the sheet is read, and only {@link ImportLimits#MAX_CONCURRENT_XLSX}
 * workbooks are read at a time on a pod, so parallel uploads cannot add up.
 */
@Component
public class ImportFileParser {

    private static final Semaphore XLSX_SLOTS = new Semaphore(ImportLimits.MAX_CONCURRENT_XLSX);

    public ParsedImportFile parse(String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new InvalidRequestException("the file is empty");
        }
        if (content.length > ImportLimits.MAX_FILE_BYTES) {
            throw new InvalidRequestException("the file is larger than "
                    + (ImportLimits.MAX_FILE_BYTES / (1024 * 1024)) + " MB; split it into smaller files");
        }
        String format = detectFormat(fileName, content);
        List<List<String>> table = ParsedImportFile.XLSX.equals(format) ? readXlsxInTurn(content)
                : readCsv(content);
        return toRows(format, table);
    }

    /**
     * The raw cells of an upload (.csv, or the first sheet of an .xlsx), with the same size,
     * type, encoding, row and cell caps as {@link #parse} and the same turn-taking for
     * workbooks, but no template header: for other fixed sheets (the item-costs import).
     * Rows keep their position, blank ones included, so index + 1 is the spreadsheet row.
     */
    public static List<List<String>> readTable(String fileName, byte[] content) {
        if (content == null || content.length == 0) {
            throw new InvalidRequestException("the file is empty");
        }
        if (content.length > ImportLimits.MAX_FILE_BYTES) {
            throw new InvalidRequestException("the file is larger than "
                    + (ImportLimits.MAX_FILE_BYTES / (1024 * 1024)) + " MB; split it into smaller files");
        }
        String format = detectFormat(fileName, content);
        List<List<String>> table = ParsedImportFile.XLSX.equals(format) ? readXlsxInTurn(content)
                : readCsv(content);
        for (int i = 0; i < table.size(); i++) {
            for (String cell : table.get(i)) {
                if (cell != null && cell.length() > ImportLimits.MAX_CELL_CHARS) {
                    throw new InvalidRequestException("row " + (i + 1) + ": a cell is longer than "
                            + ImportLimits.MAX_CELL_CHARS + " characters");
                }
            }
        }
        return table;
    }

    /** The extension and the first bytes must agree; an .xlsx file is a zip archive. */
    static String detectFormat(String fileName, byte[] content) {
        String name = fileName == null ? "" : fileName.trim().toLowerCase(Locale.ROOT);
        boolean zip = content.length >= 4 && content[0] == 'P' && content[1] == 'K'
                && content[2] == 3 && content[3] == 4;
        if (name.endsWith(".xlsx")) {
            if (!zip) {
                throw new InvalidRequestException("the file is named .xlsx but is not an Excel workbook");
            }
            return ParsedImportFile.XLSX;
        }
        if (name.endsWith(".csv")) {
            if (zip) {
                throw new InvalidRequestException("the file is named .csv but is not a text file");
            }
            return ParsedImportFile.CSV;
        }
        throw new InvalidRequestException("only .csv (UTF-8) and .xlsx files are accepted");
    }

    // --------------------------------------------------------------------- csv

    private static List<List<String>> readCsv(byte[] content) {
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(content)).toString();
        } catch (CharacterCodingException e) {
            throw new InvalidRequestException(
                    "the file is not UTF-8 text; in Excel choose \"CSV UTF-8\" when saving, or upload the .xlsx");
        }
        if (!text.isEmpty() && text.charAt(0) == '﻿') {
            text = text.substring(1);
        }
        List<List<String>> table = new ArrayList<>();
        CSVFormat format = CSVFormat.DEFAULT.builder().setIgnoreEmptyLines(false).build();
        try (CSVParser parser = format.parse(new StringReader(text))) {
            for (CSVRecord record : parser) {
                List<String> cells = new ArrayList<>(record.size());
                for (String cell : record) {
                    cells.add(cell);
                }
                table.add(cells);
                requireUnderRowCap(table.size());
            }
        } catch (InvalidRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidRequestException("the file could not be read as CSV: check the quotes around text cells");
        }
        return table;
    }

    // -------------------------------------------------------------------- xlsx

    private static List<List<String>> readXlsxInTurn(byte[] content) {
        requireSmallWorkbook(content);
        boolean acquired;
        try {
            acquired = XLSX_SLOTS.tryAcquire(ImportLimits.XLSX_WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            acquired = false;
        }
        if (!acquired) {
            throw new InvalidRequestException(
                    "other Excel files are being read right now; try again in a minute, or upload the file as CSV");
        }
        try {
            return readXlsx(content);
        } finally {
            XLSX_SLOTS.release();
        }
    }

    /**
     * Unpacks the archive into nothing and counts what comes out. Nothing is kept, so the cost
     * is CPU for at most {@link ImportLimits#MAX_XLSX_UNPACKED_BYTES} bytes and a 16 KB buffer.
     */
    static void requireSmallWorkbook(byte[] content) {
        long total = 0;
        int parts = 0;
        byte[] buffer = new byte[16 * 1024];
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(content))) {
            while (zip.getNextEntry() != null) {
                if (++parts > ImportLimits.MAX_XLSX_PARTS) {
                    throw workbookTooLarge();
                }
                int read;
                while ((read = zip.read(buffer)) > 0) {
                    total += read;
                    if (total > ImportLimits.MAX_XLSX_UNPACKED_BYTES) {
                        throw workbookTooLarge();
                    }
                }
            }
        } catch (InvalidRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidRequestException("the file could not be read as an Excel workbook (.xlsx)");
        }
        if (parts == 0) {
            throw new InvalidRequestException("the file could not be read as an Excel workbook (.xlsx)");
        }
    }

    private static InvalidRequestException workbookTooLarge() {
        return new InvalidRequestException("the Excel file is too large once unpacked (more than "
                + (ImportLimits.MAX_XLSX_UNPACKED_BYTES / (1024 * 1024))
                + " MB); remove unused sheets and formatting, split it, or upload it as CSV");
    }

    private static List<List<String>> readXlsx(byte[] content) {
        List<List<String>> table = new ArrayList<>();
        try (OPCPackage pkg = OPCPackage.open(new ByteArrayInputStream(content))) {
            XSSFReader reader = new XSSFReader(pkg);
            ReadOnlySharedStringsTable strings = new ReadOnlySharedStringsTable(pkg);
            Iterator<InputStream> sheets = reader.getSheetsData();
            if (!sheets.hasNext()) {
                throw new InvalidRequestException("the workbook has no sheet");
            }
            try (InputStream sheet = sheets.next()) {
                XMLReader xml = XMLHelper.newXMLReader();
                xml.setContentHandler(new XSSFSheetXMLHandler(reader.getStylesTable(), null, strings,
                        new SheetCollector(table), new PlainNumberFormatter(), false));
                xml.parse(new InputSource(sheet));
            }
        } catch (InvalidRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidRequestException("the file could not be read as an Excel workbook (.xlsx)");
        }
        return table;
    }

    /** Collects the cells of the first sheet; rows and cells the sheet leaves out stay blank. */
    private static final class SheetCollector implements XSSFSheetXMLHandler.SheetContentsHandler {
        private final List<List<String>> table;
        private List<String> current;
        private long chars;

        SheetCollector(List<List<String>> table) {
            this.table = table;
        }

        @Override
        public void startRow(int rowNum) {
            while (table.size() < rowNum) {
                table.add(new ArrayList<>());
                requireUnderRowCap(table.size());
            }
            current = new ArrayList<>();
        }

        @Override
        public void endRow(int rowNum) {
            table.add(current);
            requireUnderRowCap(table.size());
        }

        @Override
        public void cell(String cellReference, String formattedValue, XSSFComment comment) {
            int column = cellReference == null ? current.size() : new CellReference(cellReference).getCol();
            if (column > 500) {
                return;
            }
            if (formattedValue != null) {
                // Refused here, while reading, and not after the whole sheet has been collected.
                if (formattedValue.length() > ImportLimits.MAX_CELL_CHARS) {
                    throw new InvalidRequestException("cell " + cellReference + " is longer than "
                            + ImportLimits.MAX_CELL_CHARS + " characters");
                }
                chars += formattedValue.length();
                if (chars > ImportLimits.MAX_SHEET_CHARS) {
                    throw new InvalidRequestException("the sheet holds too much text; split the file");
                }
            }
            while (current.size() < column) {
                current.add(null);
            }
            if (current.size() == column) {
                current.add(formattedValue);
            } else {
                current.set(column, formattedValue);
            }
        }
    }

    /**
     * Numbers as plain digits whatever the cell format: 8901234567890 stays a barcode and
     * does not become 8.90123E+12, 1350.50 stays 1350.5.
     */
    private static final class PlainNumberFormatter extends DataFormatter {
        @Override
        public String formatRawCellContents(double value, int formatIndex, String formatString,
                                            boolean use1904Windowing) {
            if (Double.isNaN(value) || Double.isInfinite(value)) {
                return "";
            }
            return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
        }
    }

    // ------------------------------------------------------------------- shape

    /** Blank lines between rows are tolerated, so the raw cap is generous; data rows are capped in toRows. */
    private static void requireUnderRowCap(int rawRows) {
        if (rawRows > ImportLimits.MAX_ROWS * 4 + 1) {
            throw tooManyRows();
        }
    }

    private static InvalidRequestException tooManyRows() {
        return new InvalidRequestException("the file has more than " + ImportLimits.MAX_ROWS
                + " rows; split it into smaller files");
    }

    private static ParsedImportFile toRows(String format, List<List<String>> table) {
        int headerIndex = -1;
        for (int i = 0; i < table.size(); i++) {
            if (!isBlank(table.get(i))) {
                headerIndex = i;
                break;
            }
        }
        if (headerIndex < 0) {
            throw new InvalidRequestException("the file is empty");
        }
        List<ImportColumn> columns = readHeader(table.get(headerIndex));

        List<ImportRow> rows = new ArrayList<>();
        int blank = 0;
        for (int i = headerIndex + 1; i < table.size(); i++) {
            List<String> cells = table.get(i);
            ImportRow row = new ImportRow(i + 1);
            for (int c = 0; c < cells.size() && c < columns.size(); c++) {
                ImportColumn column = columns.get(c);
                String value = cells.get(c);
                if (column == null || value == null) {
                    continue;
                }
                if (value.length() > ImportLimits.MAX_CELL_CHARS) {
                    throw new InvalidRequestException("row " + (i + 1) + ", column " + column.header()
                            + ": the cell is longer than " + ImportLimits.MAX_CELL_CHARS + " characters");
                }
                row.set(column, unescape(value));
            }
            if (row.isBlank()) {
                blank++;
                continue;
            }
            rows.add(row);
            if (rows.size() > ImportLimits.MAX_ROWS) {
                throw tooManyRows();
            }
        }
        return new ParsedImportFile(format, rows, blank);
    }

    /** One entry per file column; null for the ignored "errors" column and for blank trailing headers. */
    private static List<ImportColumn> readHeader(List<String> cells) {
        List<ImportColumn> columns = new ArrayList<>();
        Set<ImportColumn> seen = new LinkedHashSet<>();
        List<String> unknown = new ArrayList<>();
        for (String cell : cells) {
            String header = normaliseHeader(cell);
            if (header.isEmpty() || ImportColumn.ERRORS_HEADER.equals(header)) {
                columns.add(null);
                continue;
            }
            ImportColumn column = ImportColumn.byHeader(header);
            if (column == null) {
                unknown.add(header.length() > 40 ? header.substring(0, 40) : header);
                columns.add(null);
                continue;
            }
            if (!seen.add(column)) {
                throw new InvalidRequestException("the column " + header + " appears twice in the header row");
            }
            columns.add(column);
        }
        if (!unknown.isEmpty()) {
            throw new InvalidRequestException("the header row has columns that are not in the template: "
                    + String.join(", ", unknown.subList(0, Math.min(5, unknown.size())))
                    + ". Download the template and keep its header row");
        }
        for (ImportColumn column : ImportColumn.values()) {
            if (column.required() && !seen.contains(column)) {
                throw new InvalidRequestException("the header row has no \"" + column.header()
                        + "\" column. Download the template and keep its header row");
            }
        }
        return columns;
    }

    private static String normaliseHeader(String cell) {
        if (cell == null) {
            return "";
        }
        return cell.replace("﻿", "").trim().toLowerCase(Locale.ROOT).replaceAll("[\\s-]+", "_");
    }

    /**
     * Undoes the export's formula guard: a leading apostrophe in front of = + - @ is dropped,
     * so a value that went out as '=A1 comes back as =A1 (as text, never as a formula).
     */
    public static String unescape(String value) {
        if (value.length() > 1 && value.charAt(0) == '\'' && ImportSheetWriter.startsLikeFormula(value.substring(1))) {
            return value.substring(1);
        }
        return value;
    }

    private static boolean isBlank(List<String> cells) {
        for (String cell : cells) {
            if (cell != null && !cell.isBlank()) {
                return false;
            }
        }
        return true;
    }
}
