package vacademy.io.admin_core_service.features.commerce.report.export;

import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Writes a finished {@link ReportDtos.ReportAnswer} (a summary report, at most a few thousand
 * rows) as CSV or Excel. Registers do not come here: they stream their rows into the writers.
 */
public final class ReportExports {

    private ReportExports() {
    }

    /** The CSV of an answer; a report made of blocks becomes one table with a {@code section} column. */
    public static int csv(ReportDtos.ReportAnswer answer, OutputStream out, int maxRows) throws IOException {
        if (answer.getSections().isEmpty()) {
            try (ReportCsvWriter writer = ReportCsvWriter.of(out, columns(answer.getColumns()), maxRows)) {
                for (Map<String, Object> row : answer.getRows()) {
                    writer.row(row);
                }
                return writer.rows();
            }
        }
        List<List<ReportTable.Column>> blocks = new ArrayList<>();
        for (ReportDtos.Section section : answer.getSections()) {
            blocks.add(columns(section.getColumns()));
        }
        try (ReportCsvWriter writer = ReportCsvWriter.ofSections(out, blocks, maxRows)) {
            for (ReportDtos.Section section : answer.getSections()) {
                writer.section(section.getKey());
                for (Map<String, Object> row : section.getRows()) {
                    writer.row(row);
                }
            }
            return writer.rows();
        }
    }

    /** The workbook of an answer: one sheet, or one sheet per block, each with its totals row. */
    public static int xlsx(ReportDtos.ReportAnswer answer, boolean hindi, OutputStream out, int maxRows)
            throws IOException {
        try (ReportXlsxWriter writer = new ReportXlsxWriter(hindi, maxRows)) {
            if (answer.getSections().isEmpty()) {
                writer.sheet(answer.getReport());
                writer.block(null, columns(answer.getColumns()));
                for (Map<String, Object> row : answer.getRows()) {
                    writer.row(row);
                }
                writer.totals(answer.getTotals());
            } else {
                for (ReportDtos.Section section : answer.getSections()) {
                    writer.sheet(section.getLabel());
                    addSection(writer, null, section);
                }
            }
            writer.write(out);
            return writer.rows();
        }
    }

    /** One block on the writer's current sheet: optional title, header, rows, totals. */
    public static void addSection(ReportXlsxWriter writer, String title, ReportDtos.Section section) {
        writer.block(title, columns(section.getColumns()));
        for (Map<String, Object> row : section.getRows()) {
            writer.row(row);
        }
        writer.totals(section.getTotals());
    }

    /** The writer's columns back from the answer's. */
    public static List<ReportTable.Column> columns(List<ReportDtos.ColumnDto> dtos) {
        List<ReportTable.Column> out = new ArrayList<>(dtos.size());
        for (ReportDtos.ColumnDto dto : dtos) {
            out.add(new ReportTable.Column(dto.getKey(), dto.getLabel(), dto.getLabelHi(),
                    ReportTable.Type.valueOf(dto.getType())));
        }
        return out;
    }
}
