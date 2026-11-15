package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Worked cases of the moving-average cost rules, to four places. */
class StockCostMathTest {

    private static BigDecimal n(String value) {
        return new BigDecimal(value);
    }

    @Test
    void threeReceiptsAtDifferentCostsWithASaleBetween() {
        BigDecimal average = StockCostMath.afterInflow(null, 0, n("100"), 10);
        assertEquals(n("100.0000"), average);

        average = StockCostMath.afterInflow(average, 10, n("120"), 10);
        assertEquals(n("110.0000"), average);

        // 5 are sold: a sale leaves the average alone, so only Q changes (20 to 15).
        average = StockCostMath.afterInflow(average, 15, n("150"), 5);
        assertEquals(n("120.0000"), average);
    }

    @Test
    void anAverageThatDoesNotDivideEvenlyIsRoundedToFourPlaces() {
        // (10 x 3 + 11 x 4) / 7 = 10.571428...
        assertEquals(n("10.5714"), StockCostMath.afterInflow(n("10"), 3, n("11"), 4));
    }

    @Test
    void firstReceiptOrEmptyShelfTakesTheReceiptCost() {
        assertEquals(n("42.5000"), StockCostMath.afterInflow(null, 7, n("42.5"), 3));
        assertEquals(n("42.5000"), StockCostMath.afterInflow(n("99"), 0, n("42.5"), 3));
        assertEquals(n("42.5000"), StockCostMath.afterInflow(n("99"), -2, n("42.5"), 3));
    }

    @Test
    void aReceiptWithNoCostLeavesTheAverageAlone() {
        assertEquals(n("100.0000"), StockCostMath.afterInflow(n("100"), 5, null, 10));
        assertNull(StockCostMath.afterInflow(null, 5, null, 10));
    }

    @Test
    void billAt150AfterNineOfTenProvisionalUnitsWereSold() {
        // Average 100, receive 10 provisional, sell 9, bill at 150: one unit left.
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 1, n("100"), n("150"), 10);
        assertEquals(n("150.0000"), change.newAverage());
        assertEquals(n("450.00"), change.variance());
    }

    @Test
    void billAt60AfterEightOfTenProvisionalUnitsWereSold() {
        // Q = 2: 100 + (60 - 100) x 2 / 2 = 60, and -40 x 8 falls on units already gone.
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 2, n("100"), n("60"), 10);
        assertEquals(n("60.0000"), change.newAverage());
        assertEquals(n("-320.00"), change.variance());
    }

    @Test
    void costKnownLaterWithOtherStockOnHandMovesTheAverageByTheReceiptsShare() {
        // 30 on hand at 100, of which 10 came provisionally; they turn out to cost 130.
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 30, n("100"), n("130"), 10);
        assertEquals(n("110.0000"), change.newAverage());
        assertEquals(n("0.00"), change.variance());
    }

    @Test
    void costKnownLaterWithNothingOnHandTakesTheNewCostAndPutsAllOfItInVariance() {
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 0, n("100"), n("150"), 10);
        assertEquals(n("150.0000"), change.newAverage());
        assertEquals(n("500.00"), change.variance());

        change = StockCostMath.costKnownLater(null, 4, null, n("80"), 4);
        assertEquals(n("80.0000"), change.newAverage());
        assertEquals(n("0.00"), change.variance());
    }

    @Test
    void unitsReceivedWithNoCostCarryTheAverageUntilTheirCostIsKnown() {
        // 10 came with no cost while there was no average; 10 more at 100 made the average 100.
        // The first 10 turn out to cost 50: (10 x 50 + 10 x 100) / 20 = 75.
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 20, null, n("50"), 10);
        assertEquals(n("75.0000"), change.newAverage());
    }

    @Test
    void twoCostChangesOnOneVariantReachTheSameAverageInEitherOrder() {
        // 20 on hand at 100: line A (10 units at 100) becomes 130, line B (10 at 100) becomes 90.
        BigDecimal aThenB = StockCostMath.costKnownLater(
                StockCostMath.costKnownLater(n("100"), 20, n("100"), n("130"), 10).newAverage(),
                20, n("100"), n("90"), 10).newAverage();
        BigDecimal bThenA = StockCostMath.costKnownLater(
                StockCostMath.costKnownLater(n("100"), 20, n("100"), n("90"), 10).newAverage(),
                20, n("100"), n("130"), 10).newAverage();
        assertEquals(n("110.0000"), aThenB);
        assertEquals(aThenB, bThenA);
    }

    @Test
    void aBillAmendedTwiceEndsWhereOneAmendToTheFinalCostWouldEnd() {
        // 10 of 10 still here at 100. Bill 120, amended to 110, amended to 125.
        BigDecimal average = StockCostMath.costKnownLater(n("100"), 10, n("100"), n("120"), 10).newAverage();
        average = StockCostMath.costKnownLater(average, 10, n("120"), n("110"), 10).newAverage();
        average = StockCostMath.costKnownLater(average, 10, n("110"), n("125"), 10).newAverage();
        assertEquals(n("125.0000"), average);
    }

    @Test
    void aTransferInTransitStaysInsideQ() {
        // 6 on hand and 4 on the road, all at 100; a receipt of 10 at 100 gets a bill at 120.
        // The caller passes Q = on hand + in transit = 10, so the whole difference is absorbed.
        StockCostMath.Change change = StockCostMath.costKnownLater(n("100"), 10, n("100"), n("120"), 10);
        assertEquals(n("120.0000"), change.newAverage());
        assertEquals(n("0.00"), change.variance());
    }

    @Test
    void aCostChangeThatWouldGiveANegativeAverageIsRefusedNotClamped() {
        // 10 on hand at 5; a receipt of 10 stamped at 100 is said to have cost 0.
        assertThrows(StockCostMath.NegativeAverageException.class,
                () -> StockCostMath.costKnownLater(n("5"), 10, n("100"), n("0"), 10));
    }

    @Test
    void purchaseReturnOfTenAt120FromElevenAtAverage100LeavesTheAverageAndBooksVariance200() {
        // (100 x 11 - 120 x 10) / 1 = -100 is not above zero, so the average stays.
        StockCostMath.Change change = StockCostMath.afterRemovalAtCost(n("100"), 11, n("120"), 10);
        assertEquals(n("100.0000"), change.newAverage());
        assertEquals(n("200.00"), change.variance());
    }

    @Test
    void receiptReversalTakesItsOwnCostBackOutOfTheAverage() {
        // 10 at 100, then 10 at 120 (average 110). Reversing the second receipt gives 100 again.
        StockCostMath.Change change = StockCostMath.afterRemovalAtCost(n("110"), 20, n("120"), 10);
        assertEquals(n("100.0000"), change.newAverage());
        assertEquals(n("0.00"), change.variance());
    }

    @Test
    void removingEverythingLeavesTheAverageAndBooksTheDifference() {
        StockCostMath.Change change = StockCostMath.afterRemovalAtCost(n("100"), 10, n("90"), 10);
        assertEquals(n("100.0000"), change.newAverage());
        assertEquals(n("-100.00"), change.variance());
    }

    @Test
    void zeroOrNegativeQuantitiesAndCostsAreProgrammingErrors() {
        assertThrows(IllegalArgumentException.class, () -> StockCostMath.afterInflow(n("1"), 1, n("1"), 0));
        assertThrows(IllegalArgumentException.class,
                () -> StockCostMath.costKnownLater(n("1"), 1, n("1"), n("-1"), 1));
    }
}
