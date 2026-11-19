package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApproverDirectory;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ExportRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The movement export: metres for measured goods, and no formula in a text cell (S-m4). */
class StockOverviewCsvTest {

    @Test
    void everyFormulaLeaderGetsALeadingQuote() {
        for (String leader : List.of("=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠")) {
            String cell = StockOverviewService.cell(leader + "HYPERLINK(\"x\")", true);
            assertEquals('\'', cell.charAt(cell.startsWith("\"") ? 1 : 0), "leader " + (int) leader.charAt(0));
        }
        assertEquals("Wrong delivery", StockOverviewService.cell("Wrong delivery", true));
        assertEquals("-5", StockOverviewService.cell("-5", false), "a number cell is left as it is");
        assertEquals("\"a,b\"", StockOverviewService.cell("a,b", true));
    }

    private static ItemFacts item(String id, String sku, String name, String unit, int scale) {
        return new ItemFacts(id, "pkg-" + id, sku, name, Map.of(), null, "QUANTITY", "TRACKED", "ACTIVE", "ACTIVE",
                unit, scale, 1, null, null, null, null, null);
    }

    private static ExportRow row(String variant, String type, int delta, int balance, String cost) {
        return new ExportRow(LocalDateTime.of(2026, 11, 19, 10, 0), "L1", variant, null, type, delta, balance, null,
                null, null, null, "user-1", cost == null ? null : new BigDecimal(cost));
    }

    /** D10: quantities in display units, a unit column after the item, the cost of one metre. */
    @Test
    void measuredRowsReadInMetresWithTheirUnitAndTheCostPerMetre() {
        StockOpsReadRepository read = mock(StockOpsReadRepository.class);
        when(read.itemFacts(anyString(), any())).thenReturn(Map.of(
                "ps-cloth", item("ps-cloth", "CLOTH-1", "Cotton cloth", "MTR", 10),
                "ps-bottle", item("ps-bottle", "BOTTLE-1", "Steel bottle", "PCS", 1),
                "ps-odd", item("ps-odd", "ODD-1", "=Odd item", "=X", 1)));
        when(read.referenceLabels(anyString(), any(), any())).thenReturn(Map.of());
        StockOverviewService service = new StockOverviewService(read, mock(StockLocationRepository.class),
                mock(CommerceApproverDirectory.class), mock(CommerceDocumentSeriesRepository.class),
                mock(CommerceDocumentSeriesService.class), mock(PlatformTransactionManager.class));

        String csv = service.csv("inst-1", List.of(
                row("ps-cloth", "POS_SALE", -34, 41, "8.0000"),
                row("ps-cloth", "RECEIPT", 100, 100, "8.1234"),
                row("ps-bottle", "SALE", -2, 7, "35.5"),
                row("ps-odd", "ADJUST", 1, 1, null)), true);
        List<String> lines = csv.lines().toList();

        assertEquals("date_time,location_code,sku,item,unit,piece_code,type,qty_in,qty_out,balance_after,reference,"
                + "reason,note,actor_user_id,unit_cost", lines.get(0));
        // The time cell is cut off: it is written in India time from the server's zone.
        assertEquals(",L1,CLOTH-1,Cotton cloth,m,,POS_SALE,,3.4,4.1,,,,user-1,80.0000",
                lines.get(1).replaceFirst("^[^,]*", ""));
        assertEquals(",L1,CLOTH-1,Cotton cloth,m,,RECEIPT,10,,10,,,,user-1,81.2340",
                lines.get(2).replaceFirst("^[^,]*", ""));
        assertEquals(",L1,BOTTLE-1,Steel bottle,,,SALE,,2,7,,,,user-1,35.5", lines.get(3).replaceFirst("^[^,]*", ""),
                "a piece row is unchanged but for the empty unit cell");
        assertEquals(",L1,ODD-1,'=Odd item,'=x,,ADJUST,1,,1,,,,user-1,", lines.get(4).replaceFirst("^[^,]*", ""),
                "the unit cell is a text cell");
    }
}
