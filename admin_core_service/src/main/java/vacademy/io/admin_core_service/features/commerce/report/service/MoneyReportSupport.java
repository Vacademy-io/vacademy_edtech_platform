package vacademy.io.admin_core_service.features.commerce.report.service;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportCsvWriter;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportExports;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared pieces of the money, counter and sales reports (B2): the answer frame, location labels,
 * the screen row cap and the file export of an answer that has both a main table and blocks.
 */
final class MoneyReportSupport {

    /** Rows one block shows on screen; the rest is in the download (totals always cover every row). */
    static final int SCREEN_ROWS = 5_000;
    /** Warning: a block was cut on screen. */
    static final String ROWS_CUT = "ROWS_CUT";
    /** The label of a row with no location. */
    static final String NO_LOCATION = "No location";

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private MoneyReportSupport() {
    }

    /** A new answer with the report name, range, filters and the time it was read. */
    static ReportAnswer answer(ReportQuery q, String report) {
        ReportAnswer a = new ReportAnswer();
        a.setReport(report);
        a.setFrom(q.range().from().toString());
        a.setTo(q.range().to().toString());
        a.setFilters(q.filters());
        a.setAsOf(ZonedDateTime.now(INDIA).truncatedTo(ChronoUnit.SECONDS).toOffsetDateTime().toString());
        return a;
    }

    /** The document filter of a query (no GSTIN, no status). */
    static DocFilter filter(ReportQuery q) {
        return new DocFilter(q.instituteId(), q.range().from(), q.range().to(), null,
                q.scope() == null ? null : q.scope().locationIn(), q.channel(), null);
    }

    /** Location names by id ("No location" for null). */
    static Map<String, String> locationNames(List<Location> locations) {
        Map<String, String> out = new HashMap<>();
        for (Location location : locations) {
            out.put(location.id(), location.name() == null || location.name().isBlank() ? location.code()
                    : location.name());
        }
        return out;
    }

    static String locationName(Map<String, String> names, String locationId) {
        if (locationId == null) {
            return NO_LOCATION;
        }
        String name = names.get(locationId);
        return name == null ? locationId : name;
    }

    /** A block section. */
    static ReportDtos.Section section(String key, String label, String labelHi, ReportTable table,
                                      List<Map<String, Object>> rows, Map<String, Object> totals) {
        return new ReportDtos.Section(key, label, labelHi, table.dto(), rows, totals);
    }

    static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    static Map<String, Object> totals() {
        return new LinkedHashMap<>();
    }

    /**
     * Collects the rows of one block. On screen the first {@link #SCREEN_ROWS} are kept and the
     * rest only counted (warning {@link #ROWS_CUT}); for a file every row is kept up to the
     * export cap, then {@code EXPORT_TOO_LARGE}.
     */
    static final class Rows {
        private final List<Map<String, Object>> kept = new ArrayList<>();
        private final int limit;
        private final boolean export;
        private long seen;

        Rows(boolean export, int maxExportRows) {
            this.export = export;
            this.limit = export ? maxExportRows : SCREEN_ROWS;
        }

        void add(Map<String, Object> row) {
            seen++;
            if (kept.size() < limit) {
                kept.add(row);
            } else if (export) {
                throw ReportCsvWriter.tooLarge(limit);
            }
        }

        List<Map<String, Object>> list() {
            return kept;
        }

        long seen() {
            return seen;
        }

        /** Adds the {@link #ROWS_CUT} warning when rows were left out. */
        void warnIfCut(ReportWarnings warnings, String block) {
            if (seen > kept.size()) {
                warnings.add(ROWS_CUT, "showing the first " + kept.size() + " of " + seen
                        + " rows; download the file for all of them", block);
            }
        }
    }

    /**
     * The file of an answer. A main table (columns and rows) and blocks are written together: the
     * main table becomes the first block, keyed {@code mainKey}.
     */
    static int export(ReportAnswer answer, String mainKey, String mainLabel, String mainLabelHi, String format,
                      boolean hindi, OutputStream out, int maxRows) throws IOException {
        ReportAnswer file = answer;
        if (!answer.getSections().isEmpty() && !answer.getColumns().isEmpty()) {
            file = new ReportAnswer();
            file.setReport(answer.getReport());
            List<ReportDtos.Section> sections = new ArrayList<>();
            sections.add(new ReportDtos.Section(mainKey, mainLabel, mainLabelHi, answer.getColumns(),
                    answer.getRows(), answer.getTotals()));
            sections.addAll(answer.getSections());
            file.setSections(sections);
        }
        return "csv".equals(format) ? ReportExports.csv(file, out, maxRows)
                : ReportExports.xlsx(file, hindi, out, maxRows);
    }
}
