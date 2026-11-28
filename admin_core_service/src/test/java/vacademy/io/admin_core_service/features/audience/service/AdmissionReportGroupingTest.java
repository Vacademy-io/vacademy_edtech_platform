package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.reports.AdmissionReportDTO;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The Admissions report groups one row per admission in Java, so every table has to add up to the
 * same totals and keep the institute's course group order as its column order.
 */
class AdmissionReportGroupingTest {

    private static AdmissionReportService.AdmissionRow row(String month, String tag, double fee, double paid,
                                                           String source, String counsellor) {
        return new AdmissionReportService.AdmissionRow("u-" + month + tag + fee, month, "p-" + tag, "Course " + tag,
                tag, 1, fee, paid, source, true, counsellor, null);
    }

    private final List<AdmissionReportService.AdmissionRow> rows = List.of(
            row("2026-07", "Doctor", 50000, 40000, "Reference", "c1"),
            row("2026-07", "Doctor", 60000, 60000, "Facebook", "c1"),
            row("2026-07", "Nutrition", 30000, 10000, "Reference", "c2"),
            row("2026-08", "Common", 10000, 10000, "Reference", null),
            row("2026-08", "", 5000, 0, "UNKNOWN", null));

    @Test
    void tagColumnsFollowTheInstituteOrderThenVolume() {
        assertEquals(List.of("Common", "Doctor", "Nutrition", ""),
                AdmissionReportService.orderedTags(rows, List.of("Common", "Missing")));
    }

    @Test
    void totalsAddFeesPaidAndDue() {
        AdmissionReportDTO.Row total = AdmissionReportService.total(rows, List.of("Doctor", "Nutrition", "Common", ""));
        assertEquals(5, total.getAdmissions());
        assertEquals(155000, total.getFees());
        assertEquals(120000, total.getPaid());
        assertEquals(35000, total.getDue());
        assertEquals(Map.of("Doctor", 2L, "Nutrition", 1L, "Common", 1L, "", 1L), total.getTagCounts());
    }

    @Test
    void groupsSumToTheTotalsAndCarryTagCounts() {
        List<String> tags = List.of("Doctor", "Nutrition", "Common", "");
        List<AdmissionReportDTO.Row> bySource = AdmissionReportService.group(
                rows, AdmissionReportService.AdmissionRow::source, k -> null, tags);

        assertEquals(List.of("Reference", "Facebook", "UNKNOWN"),
                bySource.stream().map(AdmissionReportDTO.Row::getKey).toList());
        assertEquals(5, bySource.stream().mapToLong(AdmissionReportDTO.Row::getAdmissions).sum());
        AdmissionReportDTO.Row reference = bySource.get(0);
        assertEquals(3, reference.getAdmissions());
        assertEquals(90000, reference.getFees());
        assertEquals(1L, reference.getTagCounts().get("Doctor"));
        assertEquals(1L, reference.getTagCounts().get("Common"));
        assertEquals(0L, reference.getTagCounts().get(""));
    }
}
