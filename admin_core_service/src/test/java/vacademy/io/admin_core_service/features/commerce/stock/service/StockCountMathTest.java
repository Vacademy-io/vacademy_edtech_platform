package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Agreement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.UncountedChoice;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.CountedLine;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.PieceHere;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.PieceSets;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountMath.ScannedOutcome;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StockCountMathTest {

    @Test
    void saleAfterTheCountIsNotReversedAndReceiptDuringTheCountIsKept() {
        // counted 12; then 2 sold and 5 received at the place: on hand 15, moved since +3.
        assertEquals(0, StockCountMath.adjustment(12, 3, 15));
        assertEquals(12, StockCountMath.expectedAtCount(15, 3));
    }

    @Test
    void saleBeforeTheCountIsAlreadyOffTheShelf() {
        // on hand 10 after a sale of 2 that happened before counting; counted 10: no difference.
        assertEquals(0, StockCountMath.adjustment(10, 0, 10));
        assertEquals(-50, StockCountMath.adjustment(150, 0, 200));
        assertEquals(4, StockCountMath.adjustment(14, 0, 10));
    }

    @Test
    void neverBelowNothingOnTheShelf() {
        assertEquals(-3, StockCountMath.adjustment(1, -5, 3));
    }

    @Test
    void scannedPiecesAreSortedOut() {
        assertEquals(ScannedOutcome.HERE, StockCountMath.classifyScanned("IN_STOCK", "L1", "L1"));
        assertEquals(ScannedOutcome.HERE, StockCountMath.classifyScanned("RESERVED", "L1", "L1"));
        assertEquals(ScannedOutcome.MISPLACED, StockCountMath.classifyScanned("IN_STOCK", "L2", "L1"));
        assertEquals(ScannedOutcome.MISPLACED, StockCountMath.classifyScanned("IN_TRANSIT", null, "L1"));
        assertEquals(ScannedOutcome.FOUND, StockCountMath.classifyScanned("WRITTEN_OFF", null, "L1"));
        assertEquals(ScannedOutcome.NOT_IN_STOCK, StockCountMath.classifyScanned("SOLD", null, "L1"));
    }

    @Test
    void unscannedPiecesSkipAndZero() {
        List<PieceHere> here = List.of(
                new PieceHere("p1", "scarf", "IN_STOCK", false),
                new PieceHere("p2", "scarf", "IN_STOCK", false),
                new PieceHere("p3", "scarf", "IN_STOCK", true),
                new PieceHere("p4", "scarf", "RESERVED", false),
                new PieceHere("p5", "shawl", "IN_STOCK", false));
        PieceSets skip = StockCountMath.pieceSets(here, Set.of("p1"), Set.of("scarf"), UncountedChoice.SKIP);
        assertEquals(List.of("p2"), skip.missing());
        assertEquals(List.of("p4"), skip.reservedNotCounted());
        assertEquals(List.of("p3"), skip.arrivedDuringCount());
        PieceSets zero = StockCountMath.pieceSets(here, Set.of("p1"), Set.of("scarf"), UncountedChoice.ZERO);
        assertEquals(List.of("p2", "p5"), zero.missing());
    }

    @Test
    void uncountedItemsAreThoseWithStockAndNoLine() {
        Map<String, Integer> levels = new LinkedHashMap<>();
        levels.put("b", 3);
        levels.put("a", 0);
        levels.put("c", 7);
        assertEquals(List.of("c"), StockCountMath.uncounted(levels, List.of("b")));
    }

    @Test
    void approvalByQuantityOrValue() {
        assertTrue(StockCountMath.overLimit(1, BigDecimal.ONE, 0, BigDecimal.ZERO));
        assertFalse(StockCountMath.overLimit(0, null, 0, BigDecimal.ZERO));
        assertTrue(StockCountMath.overLimit(-2, new BigDecimal("10"), 5, null) == false);
        assertTrue(StockCountMath.overLimit(2, null, 5, new BigDecimal("100")));
        assertFalse(StockCountMath.overLimit(2, new BigDecimal("-80.00"), 5, new BigDecimal("100")));
        assertNull(StockCountMath.value(3, null));
        assertEquals(new BigDecimal("-7.50"), StockCountMath.value(-3, new BigDecimal("2.5")));
    }

    @Test
    void agreementPassesAtNinetyEightPercent() {
        List<CountedLine> main = List.of(new CountedLine("a", null, 5), new CountedLine("s", "p1", 1));
        Agreement full = StockCountMath.agreement(main, List.of(new CountedLine("a", null, 5),
                new CountedLine("s", "p1", 1)));
        assertEquals(2, full.agreeing());
        assertTrue(full.passes());
        Agreement half = StockCountMath.agreement(main, List.of(new CountedLine("a", null, 4),
                new CountedLine("s", "p1", 1)));
        assertEquals(new BigDecimal("50.0"), half.percent());
        assertFalse(half.passes());
        assertFalse(StockCountMath.agreement(main, List.of()).passes());
    }
}
