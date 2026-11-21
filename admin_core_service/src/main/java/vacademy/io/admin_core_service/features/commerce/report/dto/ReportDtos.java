package vacademy.io.admin_core_service.features.commerce.report.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The answer shapes of {@code /commerce/v1/reports/{name}} (JSON). Every key is snake_case.
 *
 * <p>A register (sales register, credit notes, ...) fills {@code columns}, {@code rows} and
 * {@code totals}; a report made of blocks (tax by rate, HSN summary, GSTR-1, documents issued)
 * leaves those empty and fills {@code sections}, each with its own columns, rows and totals. A
 * key of {@code totals} that is also a column key is the sum of that column over the rows the
 * totals describe; other keys (counts, extra figures) are facts of their own. Lists are never
 * null.
 */
public final class ReportDtos {

    private ReportDtos() {
    }

    /** One report answer. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ReportAnswer {
        /** The report name as in the URL ({@code sales-register}). */
        private String report;
        /** India dates {@code yyyy-MM-dd}, both inclusive. */
        private String from;
        private String to;
        /** The filters the answer was computed with (snake_case keys, nulls left out). */
        private Map<String, Object> filters = new LinkedHashMap<>();
        private List<ColumnDto> columns = new ArrayList<>();
        private List<Map<String, Object>> rows = new ArrayList<>();
        private Map<String, Object> totals = new LinkedHashMap<>();
        private List<Section> sections = new ArrayList<>();
        /** A cross-check (GSTR-1, HSN, registers): figures and a {@code difference}; null when none. */
        private Map<String, Object> check;
        private List<Warning> warnings = new ArrayList<>();
        /** Registers only: pass as {@code cursor} for the next page; null on the last page. */
        private String nextCursor;
        /** When the figures were read (India time, ISO with offset). */
        private String asOf;
    }

    /** A column: key, English label, Hindi label, type (TEXT, MONEY, QTY, DATE, TIME, INT, PERCENT). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ColumnDto {
        private String key;
        private String label;
        private String labelHi;
        private String type;
    }

    /** A block of a report (a GSTR-1 section, the invoices block of tax by rate, ...). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Section {
        private String key;
        private String label;
        private String labelHi;
        private List<ColumnDto> columns = new ArrayList<>();
        private List<Map<String, Object>> rows = new ArrayList<>();
        private Map<String, Object> totals = new LinkedHashMap<>();
    }

    /** Something the reader must know about the figures; {@code ref} names the document or group. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Warning {
        private String code;
        private String message;
        private String ref;
    }
}
