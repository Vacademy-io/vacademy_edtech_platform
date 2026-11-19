package vacademy.io.admin_core_service.features.commerce.report.export;

import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.DataFormat;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.util.WorkbookUtil;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportSheetWriter;

import java.io.Closeable;
import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A report as an Excel workbook, streamed ({@link SXSSFWorkbook} keeps 200 rows in memory and
 * spills the rest to temporary files, removed by {@link #close()}).
 *
 * <p>A sheet holds one or more blocks; a block is an optional title row, a header row in the
 * caller's language, the data rows and a bold totals row. Money is a numeric cell
 * {@code #,##0.00}, quantities numeric with up to 3 decimals, dates real date cells
 * {@code dd-mm-yyyy}; text is escaped like the CSV. The header of the first block of a sheet is
 * frozen. Sheet names are cut to 31 characters.
 */
public final class ReportXlsxWriter implements Closeable {

    /** The label of the totals row. */
    public static final String TOTAL_EN = "Total";
    public static final String TOTAL_HI = "कुल";

    private static final int MAX_TEXT = 32_767;

    private final SXSSFWorkbook workbook = new SXSSFWorkbook(200);
    private final boolean hindi;
    private final int maxRows;
    private final CellStyle header;
    private final CellStyle title;
    private final CellStyle money;
    private final CellStyle moneyBold;
    private final CellStyle quantity;
    private final CellStyle quantityBold;
    private final CellStyle date;
    private final CellStyle integer;
    private final CellStyle integerBold;
    private final CellStyle bold;
    private final Set<String> sheetNames = new HashSet<>();

    private Sheet sheet;
    private int nextRow;
    private boolean frozen;
    private List<ReportTable.Column> columns = List.of();
    private int rows;

    public ReportXlsxWriter(boolean hindi, int maxRows) {
        this.hindi = hindi;
        this.maxRows = maxRows;
        DataFormat format = workbook.createDataFormat();
        Font boldFont = workbook.createFont();
        boldFont.setBold(true);

        header = workbook.createCellStyle();
        header.setFont(boldFont);
        title = workbook.createCellStyle();
        title.setFont(boldFont);
        bold = workbook.createCellStyle();
        bold.setFont(boldFont);

        money = workbook.createCellStyle();
        money.setDataFormat(format.getFormat("#,##0.00"));
        moneyBold = workbook.createCellStyle();
        moneyBold.setDataFormat(format.getFormat("#,##0.00"));
        moneyBold.setFont(boldFont);

        quantity = workbook.createCellStyle();
        quantity.setDataFormat(format.getFormat("0.###"));
        quantityBold = workbook.createCellStyle();
        quantityBold.setDataFormat(format.getFormat("0.###"));
        quantityBold.setFont(boldFont);

        date = workbook.createCellStyle();
        date.setDataFormat(format.getFormat("dd-mm-yyyy"));

        integer = workbook.createCellStyle();
        integer.setDataFormat(format.getFormat("0"));
        integerBold = workbook.createCellStyle();
        integerBold.setDataFormat(format.getFormat("0"));
        integerBold.setFont(boldFont);
    }

    /** A safe sheet name: invalid characters replaced, at most 31 characters, unique in the workbook. */
    public String sheetName(String wanted) {
        String base = WorkbookUtil.createSafeSheetName(wanted == null || wanted.isBlank() ? "report" : wanted);
        String name = base;
        int n = 2;
        while (sheetNames.contains(name.toLowerCase(Locale.ROOT))) {
            String suffix = " " + n++;
            name = (base.length() + suffix.length() > 31 ? base.substring(0, 31 - suffix.length()) : base) + suffix;
        }
        return name;
    }

    /** Starts a new sheet; the blocks that follow go on it. */
    public void sheet(String name) {
        String safe = sheetName(name);
        sheetNames.add(safe.toLowerCase(Locale.ROOT));
        sheet = workbook.createSheet(safe);
        nextRow = 0;
        frozen = false;
        columns = List.of();
    }

    /**
     * Starts a block on the current sheet: a title row when {@code titleText} is not null, then the
     * header row. A blank row separates it from an earlier block.
     */
    public void block(String titleText, List<ReportTable.Column> blockColumns) {
        if (sheet == null) {
            sheet("report");
        }
        if (nextRow > 0) {
            nextRow++;
        }
        if (titleText != null) {
            Row row = sheet.createRow(nextRow++);
            Cell cell = row.createCell(0);
            cell.setCellValue(text(titleText));
            cell.setCellStyle(title);
        }
        columns = new ArrayList<>(blockColumns);
        Row row = sheet.createRow(nextRow++);
        for (int i = 0; i < columns.size(); i++) {
            ReportTable.Column column = columns.get(i);
            Cell cell = row.createCell(i);
            String label = hindi && column.labelHi() != null ? column.labelHi() : column.label();
            cell.setCellValue(text(label));
            cell.setCellStyle(header);
            sheet.setColumnWidth(i, width(column));
        }
        if (!frozen) {
            sheet.createFreezePane(0, nextRow);
            frozen = true;
        }
    }

    /** One data row of the current block. The row after the cap is refused with {@code EXPORT_TOO_LARGE}. */
    public void row(Map<String, Object> values) {
        if (rows >= maxRows) {
            throw ReportCsvWriter.tooLarge(maxRows);
        }
        Row row = sheet.createRow(nextRow++);
        for (int i = 0; i < columns.size(); i++) {
            ReportTable.Column column = columns.get(i);
            write(row, i, column, values.get(column.key()), false);
        }
        rows++;
    }

    /** The bold totals row: a value under every column whose key is in {@code totals}. */
    public void totals(Map<String, Object> totals) {
        Row row = sheet.createRow(nextRow++);
        boolean labelled = false;
        for (int i = 0; i < columns.size(); i++) {
            ReportTable.Column column = columns.get(i);
            Object value = totals == null ? null : totals.get(column.key());
            if (value == null && !labelled && i == 0 && column.type() == ReportTable.Type.TEXT) {
                Cell cell = row.createCell(i);
                cell.setCellValue(hindi ? TOTAL_HI : TOTAL_EN);
                cell.setCellStyle(bold);
                labelled = true;
                continue;
            }
            write(row, i, column, value, true);
        }
    }

    /** A line of text under the current block (a note such as the round-off line). */
    public void note(String textValue) {
        Row row = sheet.createRow(nextRow++);
        row.createCell(0).setCellValue(text(textValue));
    }

    public int rows() {
        return rows;
    }

    public void write(OutputStream out) throws IOException {
        workbook.write(out);
    }

    /** Removes the temporary files. */
    @Override
    public void close() throws IOException {
        workbook.dispose();
        workbook.close();
    }

    // ------------------------------------------------------------------ cells

    private void write(Row row, int index, ReportTable.Column column, Object value, boolean totalsRow) {
        if (value == null) {
            return;
        }
        Cell cell = row.createCell(index);
        switch (column.type()) {
            case MONEY -> {
                if (value instanceof Number number) {
                    cell.setCellValue(toDouble(number));
                    cell.setCellStyle(totalsRow ? moneyBold : money);
                } else {
                    cell.setCellValue(text(value.toString()));
                }
            }
            case QTY, PERCENT -> {
                if (value instanceof Number number) {
                    cell.setCellValue(toDouble(number));
                    cell.setCellStyle(totalsRow ? quantityBold : quantity);
                } else {
                    cell.setCellValue(text(value.toString()));
                }
            }
            case INT -> {
                if (value instanceof Number number) {
                    cell.setCellValue(number.doubleValue());
                    cell.setCellStyle(totalsRow ? integerBold : integer);
                } else {
                    cell.setCellValue(text(value.toString()));
                }
            }
            case DATE -> {
                LocalDate day = toDate(value);
                if (day != null) {
                    cell.setCellValue(day);
                    cell.setCellStyle(date);
                } else {
                    cell.setCellValue(text(value.toString()));
                }
            }
            default -> {
                cell.setCellValue(text(value.toString()));
                if (totalsRow) {
                    cell.setCellStyle(bold);
                }
            }
        }
    }

    /** Escaped like a CSV cell and cut to the cell limit. */
    private static String text(String value) {
        String safe = ImportSheetWriter.escapeCell(value);
        return safe.length() > MAX_TEXT ? safe.substring(0, MAX_TEXT) : safe;
    }

    private static double toDouble(Number number) {
        return number instanceof BigDecimal decimal ? decimal.doubleValue() : number.doubleValue();
    }

    private static LocalDate toDate(Object value) {
        if (value instanceof LocalDate day) {
            return day;
        }
        try {
            return LocalDate.parse(value.toString());
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static int width(ReportTable.Column column) {
        return switch (column.type()) {
            case MONEY -> 14 * 256;
            case QTY, PERCENT, INT -> 10 * 256;
            case DATE -> 12 * 256;
            case TIME -> 17 * 256;
            default -> 22 * 256;
        };
    }
}
