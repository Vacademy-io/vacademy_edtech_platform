package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.StringReader;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The redirect file: UTF-8 CSV with the columns {@code from_path,to_path,status_code,match_type}
 * ({@code match_type} may be left out). The export writes the same columns, so an export is a
 * file the import takes back unchanged.
 *
 * <p>Every exported cell goes through the formula guard of the product export
 * ({@link ImportSheetWriter#escapeCell}); the parser drops that apostrophe again.
 */
public final class SiteRedirectCsv {

    /** Largest upload, in bytes. */
    public static final int MAX_FILE_BYTES = 2 * 1024 * 1024;
    /** Most data rows in one file. */
    public static final int MAX_ROWS = 20_000;
    /** Longest cell; a stored path holds at most 1,024 characters, a full old URL a little more. */
    public static final int MAX_CELL_CHARS = 4096;

    public static final String FROM_PATH = "from_path";
    public static final String TO_PATH = "to_path";
    public static final String STATUS_CODE = "status_code";
    public static final String MATCH_TYPE = "match_type";
    public static final List<String> COLUMNS = List.of(FROM_PATH, TO_PATH, STATUS_CODE, MATCH_TYPE);
    /** Key of the header map that holds the header's width (no column has an empty name). */
    private static final String WIDTH = "";

    /** One data row as typed; {@code row} is the spreadsheet row number (the header is row 1). */
    public record Row(int row, String fromPath, String toPath, String statusCode, String matchType) {
    }

    /** The data rows and the number of blank rows skipped. */
    public record Parsed(List<Row> rows, int blankRows) {
    }

    /** One stored row, as the export writes it. */
    public record ExportRow(String fromPath, String toPath, int statusCode, String matchType) {
    }

    private SiteRedirectCsv() {
    }

    public static Parsed parse(byte[] content) {
        if (content == null || content.length == 0) {
            throw new InvalidRequestException("the file is empty");
        }
        if (content.length > MAX_FILE_BYTES) {
            throw tooLarge();
        }
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(content)).toString();
        } catch (CharacterCodingException e) {
            throw new InvalidRequestException(
                    "the file is not UTF-8 text; in Excel choose \"CSV UTF-8\" when saving");
        }
        if (!text.isEmpty() && text.charAt(0) == '﻿') {
            text = text.substring(1);
        }
        Map<String, Integer> header = null;
        List<Row> rows = new ArrayList<>();
        int blank = 0;
        CSVFormat format = CSVFormat.DEFAULT.builder().setIgnoreEmptyLines(false).build();
        try (CSVParser parser = format.parse(new StringReader(text))) {
            int line = 0;
            for (CSVRecord record : parser) {
                line++;
                List<String> cells = new ArrayList<>(record.size());
                for (String cell : record) {
                    cells.add(cell == null ? "" : cell);
                }
                if (header == null) {
                    header = header(cells);
                    continue;
                }
                if (cells.stream().allMatch(cell -> cell.isBlank())) {
                    blank++;
                    continue;
                }
                if (rows.size() >= MAX_ROWS) {
                    throw new InvalidRequestException("the file has more than " + MAX_ROWS
                            + " rows; split it into smaller files");
                }
                for (int i = 0; i < cells.size(); i++) {
                    if (cells.get(i).length() > MAX_CELL_CHARS) {
                        throw new InvalidRequestException("row " + line + ": a cell is longer than "
                                + MAX_CELL_CHARS + " characters");
                    }
                    if (i >= header.get(WIDTH) && !cells.get(i).isBlank()) {
                        throw new InvalidRequestException("row " + line + " has more cells than the header");
                    }
                }
                rows.add(new Row(line, cell(cells, header, FROM_PATH), cell(cells, header, TO_PATH),
                        cell(cells, header, STATUS_CODE), cell(cells, header, MATCH_TYPE)));
            }
        } catch (InvalidRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidRequestException("the file could not be read as CSV: check the quotes around cells");
        }
        if (header == null) {
            throw new InvalidRequestException("the file is empty");
        }
        if (rows.isEmpty()) {
            throw new InvalidRequestException("the file has no data rows");
        }
        return new Parsed(List.copyOf(rows), blank);
    }

    /** The header row: the three required columns, match_type optional, nothing else. */
    private static Map<String, Integer> header(List<String> cells) {
        Map<String, Integer> out = new HashMap<>();
        for (int i = 0; i < cells.size(); i++) {
            String name = cells.get(i).trim().toLowerCase(Locale.ROOT);
            if (name.isEmpty()) {
                continue;
            }
            if (!COLUMNS.contains(name)) {
                throw new InvalidRequestException("unknown column \"" + clip(cells.get(i).trim())
                        + "\"; the columns are " + String.join(", ", COLUMNS));
            }
            if (out.put(name, i) != null) {
                throw new InvalidRequestException("the column " + name + " appears twice");
            }
        }
        for (String required : List.of(FROM_PATH, TO_PATH, STATUS_CODE)) {
            if (!out.containsKey(required)) {
                throw new InvalidRequestException("the first row must name the columns " + String.join(", ", COLUMNS)
                        + " (" + MATCH_TYPE + " may be left out); " + required + " is missing");
            }
        }
        int width = cells.size();
        while (width > 0 && cells.get(width - 1).isBlank()) {
            width--;
        }
        out.put(WIDTH, width);
        return out;
    }

    private static String cell(List<String> cells, Map<String, Integer> header, String column) {
        Integer index = header.get(column);
        if (index == null || index >= cells.size()) {
            return "";
        }
        return ImportFileParser.unescape(cells.get(index).trim());
    }

    /**
     * The rows as CSV, UTF-8 with a byte-order mark (what makes Excel show Hindi), every cell
     * guarded against spreadsheet formulas.
     */
    public static void write(OutputStream out, Iterable<ExportRow> rows) throws IOException {
        Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
        writer.write('﻿');
        CSVPrinter printer = new CSVPrinter(writer, CSVFormat.DEFAULT);
        printer.printRecord(COLUMNS);
        for (ExportRow row : rows) {
            printer.printRecord(
                    ImportSheetWriter.escapeCell(row.fromPath()),
                    ImportSheetWriter.escapeCell(row.toPath()),
                    String.valueOf(row.statusCode()),
                    ImportSheetWriter.escapeCell(row.matchType()));
        }
        printer.flush();
    }

    static InvalidRequestException tooLarge() {
        return new InvalidRequestException("the file is larger than "
                + (MAX_FILE_BYTES / (1024 * 1024)) + " MB; split it into smaller files");
    }

    private static String clip(String value) {
        return value.length() > 40 ? value.substring(0, 40) + "…" : value;
    }
}
