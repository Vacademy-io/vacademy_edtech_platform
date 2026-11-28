package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ZeroWriteOff;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A ZERO post writes off at most what was reviewed: a sale since the review is fine (less is
 * written off), more stock of an uncounted item, a new item or a new piece is not.
 */
class StockCountZeroWriteOffTest {

    private static final ZeroWriteOff REVIEWED = new ZeroWriteOff(Map.of("ps-tray", 5, "ps-cup", 2), List.of("pc-1"));

    @Test
    void aSaleSinceTheReviewDoesNotGrowTheWriteOff() {
        assertFalse(StockCountService.writeOffGrew(new ZeroWriteOff(Map.of("ps-tray", 4, "ps-cup", 2), List.of("pc-1")),
                REVIEWED));
        assertFalse(StockCountService.writeOffGrew(new ZeroWriteOff(Map.of("ps-tray", 5), List.of()), REVIEWED),
                "an item sold out and a piece sold");
    }

    @Test
    void moreStockANewItemOrANewPieceGrowsIt() {
        assertTrue(StockCountService.writeOffGrew(new ZeroWriteOff(Map.of("ps-tray", 7, "ps-cup", 2), List.of("pc-1")),
                REVIEWED));
        assertTrue(StockCountService.writeOffGrew(new ZeroWriteOff(Map.of("ps-tray", 5, "ps-bowl", 1), List.of("pc-1")),
                REVIEWED));
        assertTrue(StockCountService.writeOffGrew(new ZeroWriteOff(Map.of("ps-tray", 5), List.of("pc-1", "pc-2")),
                REVIEWED));
    }

    @Test
    void theHashIsTheSameWhateverTheOrderAndChangesWithAnyUnit() {
        assertEquals(StockCountService.zeroHash(Map.of("b", 1, "a", 2), List.of("p2", "p1"), Map.of("a", 0, "b", 3)),
                StockCountService.zeroHash(new java.util.TreeMap<>(Map.of("a", 2, "b", 1)), List.of("p1", "p2"),
                        new java.util.TreeMap<>(Map.of("b", 3, "a", 0))));
        assertNotEquals(StockCountService.zeroHash(Map.of("a", 2), List.of(), Map.of()),
                StockCountService.zeroHash(Map.of("a", 1), List.of(), Map.of()));
        assertNotEquals(StockCountService.zeroHash(Map.of("a", 2), List.of(), Map.of("a", 0)),
                StockCountService.zeroHash(Map.of("a", 2), List.of(), Map.of("a", 3)), "what came in is bound too");
    }

    /** Re-check R1: reviewed 5, sold 4, received 3 → on hand 4 is not more, but stock came in. */
    @Test
    void aSaleAndADeliveryOfTheSameItemDoNotHideEachOther() {
        ZeroWriteOff reviewed = new ZeroWriteOff(Map.of("ps-tray", 5), List.of(), Map.of("ps-tray", 5));
        ZeroWriteOff soldAndRestocked = new ZeroWriteOff(Map.of("ps-tray", 4), List.of(), Map.of("ps-tray", 8));
        assertFalse(StockCountService.writeOffGrew(soldAndRestocked, reviewed));
        assertTrue(StockCountService.stockCameIn(soldAndRestocked, reviewed));
        ZeroWriteOff soldOnly = new ZeroWriteOff(Map.of("ps-tray", 1), List.of(), Map.of("ps-tray", 5));
        assertFalse(StockCountService.stockCameIn(soldOnly, reviewed), "a sale alone still posts");
    }
}
