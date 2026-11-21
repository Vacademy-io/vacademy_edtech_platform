package vacademy.io.admin_core_service.features.commerce.report.export;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The column list of one report table: a key (snake_case, the CSV header and the JSON row key), an
 * English and a Hindi label (the Excel header) and a type that decides how a cell is written.
 *
 * <p>Row values by type: TEXT a String; MONEY a BigDecimal (two places); QTY a BigDecimal in
 * display units; DATE a String {@code yyyy-MM-dd}; TIME a String {@code yyyy-MM-dd HH:mm} (India);
 * INT a Long or Integer; PERCENT a BigDecimal (a tax rate such as 5 or 0.25).
 */
public final class ReportTable {

    /** How a cell is written. */
    public enum Type { TEXT, MONEY, QTY, DATE, TIME, INT, PERCENT }

    /** One column. */
    public record Column(String key, String label, String labelHi, Type type) {
    }

    /** Receives the rows of a table, one at a time. */
    @FunctionalInterface
    public interface RowSink {
        void row(Map<String, Object> row);
    }

    private final List<Column> columns;

    private ReportTable(List<Column> columns) {
        this.columns = Collections.unmodifiableList(new ArrayList<>(columns));
    }

    public static ReportTable of(Column... columns) {
        return new ReportTable(List.of(columns));
    }

    public List<Column> columns() {
        return columns;
    }

    /** The columns as the JSON answer names them. */
    public List<ReportDtos.ColumnDto> dto() {
        return dto(columns);
    }

    public static List<ReportDtos.ColumnDto> dto(List<Column> columns) {
        List<ReportDtos.ColumnDto> out = new ArrayList<>(columns.size());
        for (Column c : columns) {
            out.add(new ReportDtos.ColumnDto(c.key(), c.label(), c.labelHi(), c.type().name()));
        }
        return out;
    }

    public static Column text(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.TEXT);
    }

    public static Column money(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.MONEY);
    }

    public static Column qty(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.QTY);
    }

    public static Column date(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.DATE);
    }

    public static Column time(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.TIME);
    }

    public static Column integer(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.INT);
    }

    public static Column percent(String key, String label, String labelHi) {
        return new Column(key, label, labelHi, Type.PERCENT);
    }

    // ------------------------------------------------------------------ values

    /** Money as the answers carry it: two places, half up; null stays null. */
    public static BigDecimal money(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }

    /** Zero for null, then two places. */
    public static BigDecimal moneyOrZero(BigDecimal value) {
        return money(value == null ? BigDecimal.ZERO : value);
    }

    /** A tax rate without trailing zeros ("5", "0.25", "12"). */
    public static BigDecimal rate(BigDecimal value) {
        if (value == null) {
            return BigDecimal.ZERO;
        }
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }

    /** A new ordered row. */
    public static Map<String, Object> row() {
        return new LinkedHashMap<>();
    }
}
