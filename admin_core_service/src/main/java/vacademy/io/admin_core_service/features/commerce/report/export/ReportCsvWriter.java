package vacademy.io.admin_core_service.features.commerce.report.export;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A report as CSV: UTF-8 with a byte-order mark (Excel then shows Hindi), CRLF line ends, a header
 * of the English column keys, no totals row. Text cells go through {@link ImportSheetWriter#escapeCell}
 * so a spreadsheet never runs them as a formula; numbers are plain ({@code 1234.50}, no separators,
 * no rupee sign); dates {@code yyyy-MM-dd}; times {@code yyyy-MM-dd HH:mm} India.
 *
 * <p>A report made of blocks is written as one table: a first column {@code section} and the
 * union of the blocks' columns in order of first appearance.
 */
public final class ReportCsvWriter implements Closeable {

    /** The first column of a CSV made of blocks. */
    public static final String SECTION_KEY = "section";

    private final CSVPrinter printer;
    private final List<ReportTable.Column> columns;
    private final boolean withSection;
    private final int maxRows;
    private String section;
    private int rows;

    private ReportCsvWriter(OutputStream out, List<ReportTable.Column> columns, boolean withSection, int maxRows) {
        try {
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
            writer.write('﻿');
            // CSVFormat.DEFAULT ends records with CRLF.
            this.printer = new CSVPrinter(writer, CSVFormat.DEFAULT);
            this.columns = new ArrayList<>(columns);
            this.withSection = withSection;
            this.maxRows = maxRows;
            List<String> header = new ArrayList<>(columns.size() + 1);
            if (withSection) {
                header.add(SECTION_KEY);
            }
            for (ReportTable.Column column : columns) {
                header.add(column.key());
            }
            printer.printRecord(header);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** One table; the header row is written at once. */
    public static ReportCsvWriter of(OutputStream out, List<ReportTable.Column> columns, int maxRows) {
        return new ReportCsvWriter(out, columns, false, maxRows);
    }

    /** Several blocks as one table: {@code section} first, then the union of the blocks' columns. */
    public static ReportCsvWriter ofSections(OutputStream out, List<List<ReportTable.Column>> blocks, int maxRows) {
        Map<String, ReportTable.Column> union = new LinkedHashMap<>();
        for (List<ReportTable.Column> block : blocks) {
            for (ReportTable.Column column : block) {
                union.putIfAbsent(column.key(), column);
            }
        }
        return new ReportCsvWriter(out, new ArrayList<>(union.values()), true, maxRows);
    }

    /** The section key written in the first column of the rows that follow. */
    public void section(String key) {
        this.section = key;
    }

    /**
     * Writes one row. The row after the cap is refused with {@code EXPORT_TOO_LARGE}, so a caller
     * that streams rows stops reading at once.
     */
    public void row(Map<String, Object> row) {
        if (rows >= maxRows) {
            throw tooLarge(maxRows);
        }
        List<String> record = new ArrayList<>(columns.size() + 1);
        if (withSection) {
            record.add(ImportSheetWriter.escapeCell(section));
        }
        for (ReportTable.Column column : columns) {
            record.add(cell(column, row.get(column.key())));
        }
        try {
            printer.printRecord(record);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        rows++;
    }

    public int rows() {
        return rows;
    }

    /** Flushes; the stream belongs to the caller and stays open. */
    @Override
    public void close() throws IOException {
        printer.flush();
    }

    /** The text of one cell. */
    public static String cell(ReportTable.Column column, Object value) {
        if (value == null) {
            return "";
        }
        if (value instanceof BigDecimal number) {
            if (column.type() == ReportTable.Type.MONEY) {
                return number.setScale(2, RoundingMode.HALF_UP).toPlainString();
            }
            BigDecimal stripped = number.stripTrailingZeros();
            return (stripped.scale() < 0 ? stripped.setScale(0) : stripped).toPlainString();
        }
        if (value instanceof Number number) {
            return number.toString();
        }
        return ImportSheetWriter.escapeCell(value.toString());
    }

    /** The refusal when an export would pass the row cap. */
    public static InvalidRequestException tooLarge(int maxRows) {
        return new InvalidRequestException("EXPORT_TOO_LARGE: more than " + maxRows
                + " rows; narrow the dates or pick a location");
    }
}
