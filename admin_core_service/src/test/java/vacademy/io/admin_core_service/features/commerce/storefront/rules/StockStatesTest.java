package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StockStates.Level;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StockStates.State;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StockStates.Stock;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** A state, and an exact number only at or below the low threshold. */
class StockStatesTest {

    private static Stock tracked(Integer available, int threshold) {
        return StockStates.ofVariant(new Level(true, available, null), threshold, 1, false);
    }

    @Test
    void aboveTheThresholdTheStateIsInStockAndCarriesNoNumber() {
        for (int available : new int[]{4, 5, 100, 100_000}) {
            Stock stock = tracked(available, 3);
            assertEquals(State.IN_STOCK, stock.state());
            assertNull(stock.left(), "no count above the threshold (available " + available + ")");
            assertTrue(stock.purchasable());
        }
    }

    @Test
    void atOrBelowTheThresholdTheStateIsLowWithTheExactNumber() {
        for (int available : new int[]{1, 2, 3}) {
            Stock stock = tracked(available, 3);
            assertEquals(State.LOW, stock.state());
            assertEquals(available, stock.left());
            assertTrue(stock.purchasable());
        }
    }

    @Test
    void zeroNegativeAndUnknownAreOut() {
        for (Integer available : new Integer[]{0, -2, null}) {
            Stock stock = tracked(available, 3);
            assertEquals(State.OUT, stock.state());
            assertNull(stock.left());
            assertFalse(stock.purchasable());
        }
    }

    @Test
    void aThresholdOfZeroNeverShowsANumber() {
        assertEquals(State.IN_STOCK, tracked(1, 0).state());
        assertNull(tracked(1, 0).left());
    }

    @Test
    void anUntrackedVariantIsMadeToOrderWithItsLeadTime() {
        Stock stock = StockStates.ofVariant(new Level(false, null, 12), 3, 1, false);
        assertEquals(State.MADE_TO_ORDER, stock.state());
        assertEquals(12, stock.leadTimeDays());
        assertTrue(stock.purchasable());
        assertNull(stock.left());
    }

    @Test
    void theLastPieceOfAPieceProductIsOneOfAKind() {
        assertTrue(StockStates.ofVariant(new Level(true, 1, null), 3, 1, true).oneOfAKind());
        assertFalse(StockStates.ofVariant(new Level(true, 2, null), 3, 1, true).oneOfAKind());
        assertFalse(StockStates.ofVariant(new Level(true, 1, null), 3, 1, false).oneOfAKind());
    }

    @Test
    void forMeasuredGoodsTheThresholdIsInWholeUnits() {
        // Cloth by the metre in 10 cm steps: threshold 3 means 3 m = 30 base units.
        assertEquals(State.LOW, StockStates.ofVariant(new Level(true, 30, null), 3, 10, false).state());
        assertEquals(30, StockStates.ofVariant(new Level(true, 30, null), 3, 10, false).left());
        Stock above = StockStates.ofVariant(new Level(true, 31, null), 3, 10, false);
        assertEquals(State.IN_STOCK, above.state());
        assertNull(above.left());
    }

    @Test
    void aProductAddsUpItsTrackedVariants() {
        // 2 + 2 is above a threshold of 3: no number, although each variant alone is low.
        Stock four = StockStates.ofProduct(List.of(new Level(true, 2, null), new Level(true, 2, null)), 3, 1, false);
        assertEquals(State.IN_STOCK, four.state());
        assertNull(four.left());

        Stock two = StockStates.ofProduct(List.of(new Level(true, 2, null), new Level(true, 0, null)), 3, 1, false);
        assertEquals(State.LOW, two.state());
        assertEquals(2, two.left());

        Stock out = StockStates.ofProduct(List.of(new Level(true, 0, null), new Level(true, -1, null)), 3, 1, false);
        assertEquals(State.OUT, out.state());

        Stock madeToOrder = StockStates.ofProduct(List.of(new Level(true, 0, null), new Level(false, null, 7)), 3, 1,
                false);
        assertEquals(State.MADE_TO_ORDER, madeToOrder.state());
        assertEquals(7, madeToOrder.leadTimeDays());

        assertEquals(State.OUT, StockStates.ofProduct(List.of(), 3, 1, false).state());
    }
}
