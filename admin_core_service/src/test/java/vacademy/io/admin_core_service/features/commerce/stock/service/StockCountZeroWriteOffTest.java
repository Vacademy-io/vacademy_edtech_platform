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
        assertEquals(StockCountService.zeroHash(Map.of("b", 1, "a", 2), List.of("p2", "p1")),
                StockCountService.zeroHash(new java.util.TreeMap<>(Map.of("a", 2, "b", 1)), List.of("p1", "p2")));
        assertNotEquals(StockCountService.zeroHash(Map.of("a", 2), List.of()),
                StockCountService.zeroHash(Map.of("a", 1), List.of()));
    }
}
