package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The movement export never hands a spreadsheet a text cell it may read as a formula (S-m4). */
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
}
