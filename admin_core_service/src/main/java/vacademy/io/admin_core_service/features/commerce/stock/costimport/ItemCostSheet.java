package vacademy.io.admin_core_service.features.commerce.stock.costimport;

import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The item-costs sheet: its fixed header, the rules of one row and the cost maths. Pure: no
 * database, no Spring. Items are resolved by {@link ItemCostImportService}.
 *
 * <p>Header: {@code sku}, {@code variant_external_ref}, {@code purchase_price},
 * {@code includes_tax}, {@code gst_rate_percent}, {@code note}, in any order. The header row is
 * the first row holding {@code sku} or {@code variant_external_ref}; rows above it are ignored
 * (a title row). A header that is not in the template is refused, as in the product import.
 *
 * <p>Cost = the purchase price when it excludes tax, else price × 100 / (100 + rate), rounded
 * half up to four decimals.
 */
public final class ItemCostSheet {

    /** Most data rows of one file. */
    public static final int MAX_ROWS = ImportLimits.MAX_ROWS;
    /** Highest purchase price. */
    public static final BigDecimal MAX_PRICE = new BigDecimal("99999999.9999");
    /** Highest GST rate accepted. */
    public static final BigDecimal MAX_RATE = new BigDecimal("40");
    static final int COST_SCALE = 4;
    static final int RATE_SCALE = 2;

    public static final String REQUIRED = "REQUIRED";
    public static final String INVALID_NUMBER = "INVALID_NUMBER";
    public static final String INVALID_PRICE = "INVALID_PRICE";
    public static final String TOO_MANY_DECIMALS = "TOO_MANY_DECIMALS";
    public static final String INVALID_INCLUDES_TAX = "INVALID_INCLUDES_TAX";
    public static final String RATE_REQUIRED = "RATE_REQUIRED";
    public static final String INVALID_RATE = "INVALID_RATE";
    public static final String ITEM_KEY_MISSING = "ITEM_KEY_MISSING";

    private static final Pattern NUMBER = Pattern.compile("-?(\\d+(\\.\\d*)?|\\.\\d+)");

    /** The template columns, in template order. */
    public enum Column {
        SKU("sku"),
        VARIANT_EXTERNAL_REF("variant_external_ref"),
        PURCHASE_PRICE("purchase_price"),
        INCLUDES_TAX("includes_tax"),
        GST_RATE_PERCENT("gst_rate_percent"),
        NOTE("note");

        private final String header;

        Column(String header) {
            this.header = header;
        }

        public String header() {
            return header;
        }

        static Column byHeader(String header) {
            for (Column column : values()) {
                if (column.header.equals(header)) {
                    return column;
                }
            }
            return null;
        }
    }

    /**
     * One data row. {@code cost} is set only when the price, the tax flag and the rate are all
     * valid; the item key (sku or external ref) is resolved later.
     */
    public record Row(int rowNumber, String sku, String externalRef, BigDecimal price, Boolean includesTax,
                      BigDecimal rate, BigDecimal cost) {
        public boolean costed() {
            return cost != null;
        }
    }

    /** A problem of one row: spreadsheet row number, template column, code and message. */
    public record Issue(int row, String column, String code, String message) {
    }

    /** The data rows, the row errors found here, and how many blank rows were skipped. */
    public record Parsed(List<Row> rows, List<Issue> errors, int blankRows) {
    }

    private ItemCostSheet() {
    }

    /** Reads a table from {@link ImportFileParser#readTable}. Header problems and the row cap are a 400. */
    public static Parsed read(List<List<String>> table) {
        int headerIndex = findHeader(table);
        Map<Column, Integer> columns = readHeader(table.get(headerIndex));

        List<Row> rows = new ArrayList<>();
        List<Issue> errors = new ArrayList<>();
        int blank = 0;
        for (int i = headerIndex + 1; i < table.size(); i++) {
            List<String> cells = table.get(i);
            Map<Column, String> values = new EnumMap<>(Column.class);
            for (Map.Entry<Column, Integer> entry : columns.entrySet()) {
                if (entry.getKey() == Column.NOTE) {
                    continue; // ignored; a row holding only a note is blank
                }
                String value = cell(cells, entry.getValue());
                if (value != null) {
                    values.put(entry.getKey(), value);
                }
            }
            if (values.isEmpty()) {
                blank++;
                continue;
            }
            if (rows.size() >= MAX_ROWS) {
                throw new InvalidRequestException("the file has more than " + MAX_ROWS
                        + " rows; split it into smaller files");
            }
            rows.add(readRow(i + 1, values, errors));
        }
        return new Parsed(rows, errors, blank);
    }

    /** Cost per unit before tax, four decimals. {@code rate} is ignored when the price excludes tax. */
    public static BigDecimal cost(BigDecimal price, boolean includesTax, BigDecimal rate) {
        if (!includesTax) {
            return price.setScale(COST_SCALE, RoundingMode.HALF_UP);
        }
        BigDecimal hundred = BigDecimal.valueOf(100);
        return price.multiply(hundred).divide(hundred.add(rate), COST_SCALE, RoundingMode.HALF_UP);
    }

    // ------------------------------------------------------------------ header

    private static int findHeader(List<List<String>> table) {
        for (int i = 0; i < table.size(); i++) {
            for (String cell : table.get(i)) {
                String header = normaliseHeader(cell);
                if (Column.SKU.header.equals(header) || Column.VARIANT_EXTERNAL_REF.header.equals(header)) {
                    return i;
                }
            }
        }
        throw new InvalidRequestException("no header row with a \"sku\" or \"variant_external_ref\" column was found. "
                + "Download the template and keep its header row");
    }

    private static Map<Column, Integer> readHeader(List<String> cells) {
        Map<Column, Integer> columns = new EnumMap<>(Column.class);
        List<String> unknown = new ArrayList<>();
        for (int c = 0; c < cells.size(); c++) {
            String header = normaliseHeader(cells.get(c));
            if (header.isEmpty()) {
                continue;
            }
            Column column = Column.byHeader(header);
            if (column == null) {
                unknown.add(header.length() > 40 ? header.substring(0, 40) : header);
                continue;
            }
            if (columns.put(column, c) != null) {
                throw new InvalidRequestException("the column " + header + " appears twice in the header row");
            }
        }
        if (!unknown.isEmpty()) {
            throw new InvalidRequestException("the header row has columns that are not in the template: "
                    + String.join(", ", unknown.subList(0, Math.min(5, unknown.size())))
                    + ". Download the template and keep its header row");
        }
        for (Column required : List.of(Column.PURCHASE_PRICE, Column.INCLUDES_TAX)) {
            if (!columns.containsKey(required)) {
                throw new InvalidRequestException("the header row has no \"" + required.header
                        + "\" column. Download the template and keep its header row");
            }
        }
        return columns;
    }

    static String normaliseHeader(String cell) {
        if (cell == null) {
            return "";
        }
        return cell.replace("﻿", "").trim().toLowerCase(Locale.ROOT).replaceAll("[\\s-]+", "_");
    }

    // --------------------------------------------------------------------- row

    private static Row readRow(int rowNumber, Map<Column, String> values, List<Issue> errors) {
        String sku = values.get(Column.SKU);
        String externalRef = values.get(Column.VARIANT_EXTERNAL_REF);
        if (sku == null && externalRef == null) {
            errors.add(new Issue(rowNumber, Column.SKU.header, ITEM_KEY_MISSING,
                    "enter the sku or the variant_external_ref of the item"));
        }

        BigDecimal price = readPrice(rowNumber, values.get(Column.PURCHASE_PRICE), errors);
        Boolean includesTax = readIncludesTax(rowNumber, values.get(Column.INCLUDES_TAX), errors);
        String rateText = values.get(Column.GST_RATE_PERCENT);
        BigDecimal rate = null;
        boolean rateOk = true;
        if (rateText != null) {
            rate = readRate(rowNumber, rateText, errors);
            rateOk = rate != null;
        } else if (Boolean.TRUE.equals(includesTax)) {
            errors.add(new Issue(rowNumber, Column.GST_RATE_PERCENT.header, RATE_REQUIRED,
                    "the price includes tax, so enter the GST rate (for example 5, 12 or 18)"));
            rateOk = false;
        }

        BigDecimal cost = null;
        if (price != null && includesTax != null && (!includesTax || (rateOk && rate != null))) {
            cost = cost(price, includesTax, rate);
            if (cost.signum() <= 0) {
                errors.add(new Issue(rowNumber, Column.PURCHASE_PRICE.header, INVALID_PRICE,
                        "the cost before tax rounds to zero"));
                cost = null;
            }
        }
        return new Row(rowNumber, sku, externalRef, price, includesTax, rate, cost);
    }

    private static BigDecimal readPrice(int rowNumber, String text, List<Issue> errors) {
        String column = Column.PURCHASE_PRICE.header;
        if (text == null) {
            errors.add(new Issue(rowNumber, column, REQUIRED, "enter the purchase price"));
            return null;
        }
        BigDecimal value = number(text);
        if (value == null) {
            errors.add(new Issue(rowNumber, column, INVALID_NUMBER,
                    "\"" + shorten(text) + "\" is not a number; use digits and a dot, without commas or a currency sign"));
            return null;
        }
        if (value.signum() <= 0) {
            errors.add(new Issue(rowNumber, column, INVALID_PRICE, "the purchase price must be more than zero"));
            return null;
        }
        if (value.scale() > COST_SCALE) {
            errors.add(new Issue(rowNumber, column, TOO_MANY_DECIMALS,
                    "the purchase price has more than " + COST_SCALE + " decimals"));
            return null;
        }
        if (value.compareTo(MAX_PRICE) > 0) {
            errors.add(new Issue(rowNumber, column, INVALID_PRICE,
                    "the purchase price is more than " + MAX_PRICE.toPlainString()));
            return null;
        }
        return value;
    }

    private static Boolean readIncludesTax(int rowNumber, String text, List<Issue> errors) {
        String column = Column.INCLUDES_TAX.header;
        if (text == null) {
            errors.add(new Issue(rowNumber, column, REQUIRED,
                    "enter yes if the purchase price includes GST, no if it does not"));
            return null;
        }
        String value = text.trim().toLowerCase(Locale.ROOT);
        if ("yes".equals(value)) {
            return Boolean.TRUE;
        }
        if ("no".equals(value)) {
            return Boolean.FALSE;
        }
        errors.add(new Issue(rowNumber, column, INVALID_INCLUDES_TAX,
                "\"" + shorten(text) + "\" is not yes or no"));
        return null;
    }

    private static BigDecimal readRate(int rowNumber, String text, List<Issue> errors) {
        String column = Column.GST_RATE_PERCENT.header;
        BigDecimal value = number(text);
        if (value == null) {
            errors.add(new Issue(rowNumber, column, INVALID_NUMBER,
                    "\"" + shorten(text) + "\" is not a number; enter the rate without the % sign"));
            return null;
        }
        if (value.signum() < 0 || value.compareTo(MAX_RATE) > 0 || value.scale() > RATE_SCALE) {
            errors.add(new Issue(rowNumber, column, INVALID_RATE,
                    "the GST rate must be from 0 to " + MAX_RATE.toPlainString() + ", with at most "
                            + RATE_SCALE + " decimals"));
            return null;
        }
        return value;
    }

    /** Plain digits with an optional dot and minus; trailing zeros after the dot do not count as decimals. */
    static BigDecimal number(String text) {
        String value = text.trim();
        if (!NUMBER.matcher(value).matches()) {
            return null;
        }
        BigDecimal number = new BigDecimal(value).stripTrailingZeros();
        return number.scale() < 0 ? number.setScale(0) : number;
    }

    private static String cell(List<String> cells, int index) {
        if (index >= cells.size()) {
            return null;
        }
        String value = cells.get(index);
        if (value == null) {
            return null;
        }
        value = ImportFileParser.unescape(value.trim());
        return value.isBlank() ? null : value;
    }

    private static String shorten(String text) {
        String value = text.trim();
        return value.length() > 40 ? value.substring(0, 40) + "…" : value;
    }
}
