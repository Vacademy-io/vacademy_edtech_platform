package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCostAdjustmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.CommerceStockCounters;
import vacademy.io.common.exceptions.ConflictException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A counter sale (POS_SALE) at a location that also sells online: refused when the units are
 * promised online, unless the posting is a paper bill keyed later ({@code allowShortfall}),
 * which takes the floored outflow and answers the shortfall.
 */
class StockLedgerServicePosTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final String PS = "ps-1";

    private StockLevelRepository levels;
    private StockMovementRepository movements;
    private PackageSessionRepository packageSessions;
    private StockLocationRepository locations;
    private StockVariantRepository variants;
    private StockLedgerService ledger;

    @BeforeEach
    void setUp() {
        locations = mock(StockLocationRepository.class);
        levels = mock(StockLevelRepository.class);
        movements = mock(StockMovementRepository.class);
        CommercePieceRepository pieces = mock(CommercePieceRepository.class);
        variants = mock(StockVariantRepository.class);
        StockCostAdjustmentRepository adjustments = mock(StockCostAdjustmentRepository.class);
        StockReceiptLineRepository lines = mock(StockReceiptLineRepository.class);
        packageSessions = mock(PackageSessionRepository.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(LocalDate.of(2026, 11, 18));
        ledger = new StockLedgerService(locations, levels, movements, pieces, variants, adjustments, lines,
                packageSessions, clock);
        AtomicInteger ids = new AtomicInteger();
        when(movements.save(any(StockMovement.class))).thenAnswer(inv -> {
            StockMovement movement = inv.getArgument(0);
            movement.setId("mov-" + ids.incrementAndGet());
            return movement;
        });
        when(movements.findByInstituteIdAndIdempotencyKey(anyString(), anyString())).thenReturn(Optional.empty());

        VariantFacts facts = mock(VariantFacts.class);
        when(facts.getPackageSessionId()).thenReturn(PS);
        when(facts.getStockMode()).thenReturn("QUANTITY");
        when(facts.getStockPolicy()).thenReturn("TRACKED");
        when(facts.getCostPrice()).thenReturn(new BigDecimal("40.0000"));
        when(variants.findFacts(INST, PS)).thenReturn(Optional.of(facts));
        LocationFacts location = mock(LocationFacts.class);
        when(location.getId()).thenReturn(LOC);
        when(location.getStatus()).thenReturn("ACTIVE");
        when(location.getSellsOnline()).thenReturn(true);
        when(locations.lockForPosting(INST, LOC)).thenReturn(Optional.of(location));
        when(levels.lockOnHand(INST, LOC, PS)).thenReturn(Optional.of(5));
        when(levels.applyDelta(eq(INST), eq(LOC), eq(PS), anyInt())).thenReturn(1);
        CommerceStockCounters counters = mock(CommerceStockCounters.class);
        when(counters.getMaxSeats()).thenReturn(5);
        when(counters.getAvailableSlots()).thenReturn(1);
        when(packageSessions.lockCommerceStockCounters(PS)).thenReturn(Optional.of(counters));
    }

    private static StockPosting.StockPostingBuilder sale(int delta, String key) {
        return StockPosting.builder().instituteId(INST).locationId(LOC).packageSessionId(PS)
                .type(StockMovementType.POS_SALE).quantityDelta(delta).idempotencyKey(key).actorUserId("user-1")
                .referenceType("ORDER_LINE").referenceId("line-1");
    }

    @Test
    void aCounterSaleOfPromisedUnitsIsRefusedWithoutAllowShortfall() {
        when(packageSessions.commerceStockSoldAtCounter(PS, 3)).thenReturn(0);

        ConflictException e = assertThrows(ConflictException.class, () -> ledger.post(sale(-3, "POS_SALE:a").build()));

        assertTrue(e.getMessage().startsWith("SOLD_ONLINE"));
        verify(packageSessions, never()).commerceStockOutFloored(anyString(), anyInt());
    }

    @Test
    void theDefaultIsNotToAllowAShortfall() {
        assertFalse(sale(-1, "k").build().isAllowShortfall());
    }

    @Test
    void aPaperBillTakesTheFlooredOutflowAndAnswersTheShortfall() {
        when(packageSessions.commerceStockSoldAtCounter(PS, 3)).thenReturn(0);

        StockPostResult result = ledger.post(sale(-3, "POS_SALE:b").allowShortfall(true).build());

        // available_slots was 1: one unit was unpromised, two were promised online.
        assertEquals(2, result.sellableShortfall());
        verify(packageSessions).commerceStockOutFloored(PS, 3);
        verify(packageSessions).commerceAddSellableDeficit(PS, 2);
        assertEquals(-3, result.movement().getQuantityDelta());
        assertEquals("POS_SALE", result.movement().getType());
    }

    @Test
    void aPaperBillOfUnpromisedUnitsTakesBothCountersAsASaleDoes() {
        when(packageSessions.commerceStockSoldAtCounter(PS, 1)).thenReturn(1);

        StockPostResult result = ledger.post(sale(-1, "POS_SALE:c").allowShortfall(true).build());

        assertEquals(0, result.sellableShortfall());
        verify(packageSessions, never()).commerceStockOutFloored(anyString(), anyInt());
        verify(packageSessions, never()).commerceAddSellableDeficit(anyString(), anyInt());
    }

    @Test
    void aReversalGivesTheUnitsBackThroughSellableIn() {
        StockMovement original = new StockMovement();
        original.setId("mov-sale");
        original.setInstituteId(INST);
        original.setLocationId(LOC);
        original.setPackageSessionId(PS);
        original.setType("POS_SALE");
        original.setQuantityDelta(-2);
        original.setUnitCost(new BigDecimal("40.0000"));
        when(movements.findByInstituteIdAndId(INST, "mov-sale")).thenReturn(Optional.of(original));
        when(movements.sumReversed(INST, "mov-sale")).thenReturn(0L);
        when(packageSessions.commerceSellableDeficit(PS)).thenReturn(0);
        StockVariantRepository.VariantCost cost = mock(StockVariantRepository.VariantCost.class);
        when(cost.getCostPrice()).thenReturn(new BigDecimal("40.0000"));
        when(variants.lockCost(INST, PS)).thenReturn(Optional.of(cost));
        when(levels.sumOnHand(INST, PS)).thenReturn(7L);
        when(movements.sumInTransit(INST, PS)).thenReturn(0L);

        StockPostResult result = ledger.post(sale(2, "POS_VOID:mov-sale").reversesMovementId("mov-sale").build());

        assertEquals(0, result.sellableShortfall());
        verify(packageSessions).commerceStockIn(PS, 2, 2);
        verify(packageSessions, never()).commerceStockSoldAtCounter(anyString(), anyInt());
    }
}
