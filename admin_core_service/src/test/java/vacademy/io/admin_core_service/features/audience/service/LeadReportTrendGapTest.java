package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadReportSummaryDTO.DailyTrendPoint;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The Overview trend draws one evenly spaced point per element, so a day with no leads has to be
 * a zero point rather than missing — otherwise quiet days vanish from the chart.
 */
class LeadReportTrendGapTest {

    private static LeadReportService.DateRange window(String fromDay, String toDayExclusive) {
        return new LeadReportService.DateRange("ignored", "ignored",
                fromDay + "T00:00", toDayExclusive + "T00:00", "Asia/Kolkata");
    }

    private static DailyTrendPoint point(String day, long submitted, long converted) {
        return DailyTrendPoint.builder().date(day).submitted(submitted).converted(converted).build();
    }

    @Test
    void padsEveryQuietDayOfTheWindowWithZero() {
        List<DailyTrendPoint> filled = LeadReportService.fillTrendGaps(
                List.of(point("2026-10-02", 5, 1), point("2026-10-05", 2, 0)),
                window("2026-10-01", "2026-10-06"));

        assertEquals(List.of("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"),
                filled.stream().map(DailyTrendPoint::getDate).toList());
        assertEquals(List.of(0L, 5L, 0L, 0L, 2L),
                filled.stream().map(DailyTrendPoint::getSubmitted).toList());
        assertEquals(1L, filled.get(1).getConverted());
    }

    @Test
    void returnsAllZerosForAWindowWithNoLeads() {
        List<DailyTrendPoint> filled = LeadReportService.fillTrendGaps(List.of(),
                window("2026-10-01", "2026-10-04"));

        assertEquals(3, filled.size());
        assertEquals(0L, filled.stream().mapToLong(DailyTrendPoint::getSubmitted).sum());
    }

    @Test
    void leavesAnUnboundedWindowAsReturnedBySql() {
        List<DailyTrendPoint> rows = List.of(point("2015-01-01", 1, 0), point("2026-10-01", 3, 1));

        assertEquals(rows, LeadReportService.fillTrendGaps(rows, window("2000-01-01", "2026-10-02")));
    }
}
