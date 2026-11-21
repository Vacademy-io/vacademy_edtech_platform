package vacademy.io.admin_core_service.features.audience.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadReportProjections;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The Lead Reports summary reads every figure in one query and splits the rows back into the
 * six shapes it used to get from six queries; each figure must land where the old query put it.
 */
class LeadReportSummaryPartsTest {

    private record Row(String getKind, String getGroupKey, Boolean getFlag, Long getN1, Long getN2, Long getN3,
                       Long getN4, Long getN5, Double getD1, Double getD2)
            implements LeadReportProjections.SummaryAggregateProjection { }

    private static Row row(String kind, String key, Boolean flag, Long n1, Long n2) {
        return new Row(kind, key, flag, n1, n2, null, null, null, null, null);
    }

    @Test
    void splitsEveryKindIntoItsOldShape() {
        LeadReportService.SummaryParts p = LeadReportService.SummaryParts.of(List.of(
                new Row("TOTALS", null, null, 100L, 5L, 10L, 85L, 7L, null, null),
                new Row("RESPONSE", null, null, 40L, 30L, null, null, null, 12.5, 8.0),
                row("STATUS", "NEW", null, 60L, null),
                row("STATUS", "__NO_STATUS__", null, 40L, null),
                row("SOURCE", "Website", false, 20L, 1L),
                row("SOURCE", "Facebook", true, 70L, 3L),
                row("SOURCE", "UNKNOWN", false, 10L, 1L),
                row("TIER", "HOT", null, 30L, null),
                row("DAY", "2026-11-02", null, 4L, 1L),
                row("DAY", "2026-11-01", null, 6L, 0L)));

        assertEquals(100L, p.totals().getTotalLeads());
        assertEquals(5L, p.totals().getConvertedLeads());
        assertEquals(10L, p.totals().getLostLeads());
        assertEquals(85L, p.totals().getActiveLeads());
        assertEquals(7L, p.totals().getOverdueLeads());

        assertEquals(40L, p.response().getRespondedLeads());
        assertEquals(30L, p.response().getTatMetCount());
        assertEquals(12.5, p.response().getAvgResponseMinutes());
        assertEquals(8.0, p.response().getMedianResponseMinutes());

        assertEquals(2, p.status().size());
        assertEquals(1, p.tiers().size());
        assertEquals("HOT", p.tiers().get(0).getTier());

        // Sources by lead count, highest first (the old ORDER BY totalCount DESC).
        assertEquals(List.of("Facebook", "Website", "UNKNOWN"),
                p.sources().stream().map(LeadReportProjections.SourceCountProjection::getSourceType).toList());
        assertTrue(p.sources().get(0).getFromCampaignType());
        assertEquals(3L, p.sources().get(0).getConvertedCount());

        // Trend by day (the old ORDER BY day).
        assertEquals(java.sql.Date.valueOf("2026-11-01"), p.trend().get(0).getDay());
        assertEquals(6L, p.trend().get(0).getSubmittedCount());
        assertEquals(1L, p.trend().get(1).getConvertedCount());
    }

    @Test
    void emptyResultKeepsNullTotalsLikeBefore() {
        LeadReportService.SummaryParts p = LeadReportService.SummaryParts.of(List.of());
        assertNull(p.totals());
        assertNull(p.response());
        assertTrue(p.status().isEmpty() && p.sources().isEmpty() && p.tiers().isEmpty() && p.trend().isEmpty());
    }
}
