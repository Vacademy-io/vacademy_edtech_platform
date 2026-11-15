package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCostAdjustment;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostAdjustmentReason;
import vacademy.io.admin_core_service.features.commerce.stock.enums.CostSource;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository.PieceRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCostAdjustmentRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockReceiptLineRepository.LineRow;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantCost;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService.ReceiptCostChange;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.CommerceStockCounters;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The rules of the one stock writer, with the database replaced by mocks: what each statement
 * answers decides what the service does. The real two-connection race is a database test.
 */
class StockLedgerServiceTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-1";
    private static final String PS = "ps-1";

    private StockLocationRepository locations;
    private StockLevelRepository levels;
    private StockMovementRepository movements;
    private CommercePieceRepository pieces;
    private StockVariantRepository variants;
    private StockCostAdjustmentRepository adjustments;
    private StockReceiptLineRepository lines;
    private PackageSessionRepository packageSessions;
    private StockLedgerService ledger;

    @BeforeEach
    void setUp() {
        locations = mock(StockLocationRepository.class);
        levels = mock(StockLevelRepository.class);
        movements = mock(StockMovementRepository.class);
        pieces = mock(CommercePieceRepository.class);
        variants = mock(StockVariantRepository.class);
        adjustments = mock(StockCostAdjustmentRepository.class);
        lines = mock(StockReceiptLineRepository.class);
        packageSessions = mock(PackageSessionRepository.class);
        StockClock clock = mock(StockClock.class);
        when(clock.today(anyString())).thenReturn(LocalDate.of(2026, 11, 14));
        ledger = new StockLedgerService(locations, levels, movements, pieces, variants, adjustments, lines,
                packageSessions, clock);

        AtomicInteger ids = new AtomicInteger();
        when(movements.save(any(StockMovement.class))).thenAnswer(inv -> {
            StockMovement movement = inv.getArgument(0);
            movement.setId("mov-" + ids.incrementAndGet());
            return movement;
        });
        when(adjustments.save(any(StockCostAdjustment.class))).thenAnswer(inv -> inv.getArgument(0));
        when(movements.findByInstituteIdAndIdempotencyKey(anyString(), anyString())).thenReturn(Optional.empty());
        when(adjustments.findByInstituteIdAndIdempotencyKey(anyString(), anyString())).thenReturn(Optional.empty());
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private void variant(String stockMode, String policy, String costPrice) {
        VariantFacts facts = mock(VariantFacts.class);
        when(facts.getPackageSessionId()).thenReturn(PS);
        when(facts.getStockMode()).thenReturn(stockMode);
        when(facts.getStockPolicy()).thenReturn(policy);
        when(facts.getCostPrice()).thenReturn(costPrice == null ? null : new BigDecimal(costPrice));
        when(variants.findFacts(INST, PS)).thenReturn(Optional.of(facts));
    }

    private void location(boolean sellsOnline) {
        LocationFacts facts = mock(LocationFacts.class);
        when(facts.getId()).thenReturn(LOC);
        when(facts.getStatus()).thenReturn("ACTIVE");
        when(facts.getSellsOnline()).thenReturn(sellsOnline);
        when(locations.lockForPosting(INST, LOC)).thenReturn(Optional.of(facts));
    }

    private void onHand(int quantity) {
        when(levels.lockOnHand(INST, LOC, PS)).thenReturn(Optional.of(quantity));
        when(levels.applyDelta(eq(INST), eq(LOC), eq(PS), anyInt()))
                .thenAnswer(inv -> quantity + inv.<Integer>getArgument(3) >= 0 ? 1 : 0);
    }

    private void counters(Integer maxSeats, Integer availableSlots) {
        CommerceStockCounters counters = mock(CommerceStockCounters.class);
        when(counters.getMaxSeats()).thenReturn(maxSeats);
        when(counters.getAvailableSlots()).thenReturn(availableSlots);
        when(packageSessions.lockCommerceStockCounters(PS)).thenReturn(Optional.of(counters));
    }

    private void lockedCost(String costPrice, long everywhereAfter) {
        VariantCost cost = mock(VariantCost.class);
        when(cost.getCostPrice()).thenReturn(costPrice == null ? null : new BigDecimal(costPrice));
        when(variants.lockCost(INST, PS)).thenReturn(Optional.of(cost));
        when(levels.sumOnHand(INST, PS)).thenReturn(everywhereAfter);
        when(movements.sumInTransit(INST, PS)).thenReturn(0L);
    }

    private static StockPosting.StockPostingBuilder posting(StockMovementType type, int delta, String key) {
        return StockPosting.builder().instituteId(INST).locationId(LOC).packageSessionId(PS).type(type)
                .quantityDelta(delta).idempotencyKey(key).actorUserId("user-1");
    }

    /** A movement already in the ledger, for a correction to name. */
    private StockMovement original(String id, StockMovementType type, int delta, String unitCost) {
        StockMovement movement = new StockMovement();
        movement.setId(id);
        movement.setInstituteId(INST);
        movement.setLocationId(LOC);
        movement.setPackageSessionId(PS);
        movement.setType(type.name());
        movement.setQuantityDelta(delta);
        movement.setUnitCost(unitCost == null ? null : new BigDecimal(unitCost));
        when(movements.findByInstituteIdAndId(INST, id)).thenReturn(Optional.of(movement));
        return movement;
    }

    private StockMovement saved() {
        ArgumentCaptor<StockMovement> captor = ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(captor.capture());
        return captor.getValue();
    }

    // ── on hand ─────────────────────────────────────────────────────────────

    @Test
    void aReceiptRaisesOnHandAndWritesOneMovementWithTheBalance() {
        variant("QUANTITY", "TRACKED", null);
        location(false);
        onHand(4);

        StockPostResult result = ledger.post(posting(StockMovementType.RECEIPT, 6, "RECEIPT:line-1").build());

        assertTrue(result.created());
        verify(levels).applyDelta(INST, LOC, PS, 6);
        StockMovement movement = saved();
        assertEquals(6, movement.getQuantityDelta());
        assertEquals(10, movement.getBalanceAfter());
        assertFalse(movement.isAffectsSellable());
        // Not an online location: the website counters are not touched.
        verifyNoInteractions(packageSessions);
    }

    @Test
    void negativeIsRefusedAndNothingIsWritten() {
        variant("QUANTITY", "TRACKED", "10");
        location(false);
        onHand(2);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> ledger.post(posting(StockMovementType.DAMAGE, -3, "ADJ:1").build()));

        assertTrue(refused.getMessage().startsWith("NOT_IN_STOCK"));
        verify(movements, never()).save(any());
    }

    @Test
    void ofTwoDecrementsOfTheLastUnitTheOneWhoseUpdateMatchesNoRowLoses() {
        // Both callers saw one unit when they locked; the conditional UPDATE is the judge.
        variant("QUANTITY", "TRACKED", "10");
        location(false);
        when(levels.lockOnHand(INST, LOC, PS)).thenReturn(Optional.of(1));
        when(levels.applyDelta(INST, LOC, PS, -1)).thenReturn(1, 0);

        StockPostResult winner = ledger.post(posting(StockMovementType.DAMAGE, -1, "ADJ:a").build());
        assertTrue(winner.created());
        assertThrows(ConflictException.class,
                () -> ledger.post(posting(StockMovementType.DAMAGE, -1, "ADJ:b").build()));

        verify(movements, times(1)).save(any());
    }

    @Test
    void aRepeatedKeyPostsOnce() {
        variant("QUANTITY", "TRACKED", null);
        location(false);
        onHand(0);
        StockPostResult first = ledger.post(posting(StockMovementType.RECEIPT, 5, "RECEIPT:line-1").build());
        when(movements.findByInstituteIdAndIdempotencyKey(INST, "RECEIPT:line-1"))
                .thenReturn(Optional.of(first.movement()));

        StockPostResult second = ledger.post(posting(StockMovementType.RECEIPT, 5, "RECEIPT:line-1").build());

        assertFalse(second.created());
        assertSame(first.movement(), second.movement());
        verify(levels, times(1)).applyDelta(INST, LOC, PS, 5);
        verify(movements, times(1)).save(any());
    }

    @Test
    void aTwinThatCommittedWhileWeWaitedForTheLevelRowIsFoundAfterTheLock() {
        variant("QUANTITY", "TRACKED", null);
        location(false);
        onHand(5);
        StockMovement twin = new StockMovement();
        twin.setLocationId(LOC);
        twin.setPackageSessionId(PS);
        twin.setType(StockMovementType.RECEIPT.name());
        twin.setQuantityDelta(5);
        when(movements.findByInstituteIdAndIdempotencyKey(INST, "RECEIPT:line-1"))
                .thenReturn(Optional.empty(), Optional.of(twin));

        StockPostResult result = ledger.post(posting(StockMovementType.RECEIPT, 5, "RECEIPT:line-1").build());

        assertFalse(result.created());
        assertSame(twin, result.movement());
        verify(levels, never()).applyDelta(anyString(), anyString(), anyString(), anyInt());
        verify(movements, never()).save(any());
    }

    @Test
    void aForeignLocationIsRefused() {
        variant("QUANTITY", "TRACKED", null);
        when(locations.lockForPosting(INST, LOC)).thenReturn(Optional.empty());

        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.RECEIPT, 1, "RECEIPT:x").build()));

        verify(levels, never()).insertIfMissing(anyString(), anyString(), anyString(), anyString());
        verify(movements, never()).save(any());
    }

    @Test
    void anItemOfAnotherInstituteIsRefused() {
        when(variants.findFacts(INST, PS)).thenReturn(Optional.empty());

        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.RECEIPT, 1, "RECEIPT:x").build()));

        verifyNoInteractions(levels, locations);
    }

    @Test
    void anUntrackedVariantHasNoLevelsAndNoMovements() {
        variant("QUANTITY", "UNTRACKED", null);

        StockPostResult result = ledger.post(posting(StockMovementType.SALE, -3, "SALE:1").build());

        assertTrue(result.isUntracked());
        verifyNoInteractions(levels, locations, packageSessions);
        verify(movements, never()).save(any());
    }

    @Test
    void aWrongDirectionNeedsTheMovementItCorrects() {
        variant("QUANTITY", "TRACKED", null);
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.RECEIPT, -1, "k1").build()));
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.SALE, 1, "k2").build()));
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.SALE, -1, "k3").reversesMovementId("mov-0").build()));
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.ADJUSTMENT, 0, "k4").build()));
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.ADJUSTMENT, 1, " ").build()));
    }

    // ── corrections ─────────────────────────────────────────────────────────

    @Test
    void aSecondUndoOfTheSameSalePutsNothingBack() {
        // A counter sale of 1 unit, voided twice with two different keys.
        variant("QUANTITY", "TRACKED", "100");
        location(false);
        onHand(4);
        lockedCost("100", 5);
        original("mov-sale", StockMovementType.POS_SALE, -1, "100");

        when(movements.sumReversed(INST, "mov-sale")).thenReturn(0L);
        assertTrue(ledger.post(posting(StockMovementType.POS_SALE, 1, "VOID:a").reversesMovementId("mov-sale").build())
                .created());

        when(movements.sumReversed(INST, "mov-sale")).thenReturn(1L);
        ConflictException refused = assertThrows(ConflictException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "VOID:b").reversesMovementId("mov-sale").build()));

        assertTrue(refused.getMessage().startsWith("ALREADY_REVERSED"));
        verify(levels, times(1)).applyDelta(INST, LOC, PS, 1);
        verify(movements, times(1)).save(any());
    }

    @Test
    void aCorrectionMustNameARealMovementOfTheSameItemPlaceAndKindAndNoMoreThanItMoved() {
        variant("QUANTITY", "TRACKED", "100");
        location(false);
        onHand(10);

        // No such movement in this institute.
        assertThrows(InvalidRequestException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "V1").reversesMovementId("mov-unknown").build()));
        // Another kind.
        original("mov-damage", StockMovementType.DAMAGE, -2, "100");
        assertThrows(InvalidRequestException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "V2").reversesMovementId("mov-damage").build()));
        // Another location.
        original("mov-elsewhere", StockMovementType.POS_SALE, -1, "100").setLocationId("loc-other");
        assertThrows(InvalidRequestException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "V3").reversesMovementId("mov-elsewhere").build()));
        // Another item.
        original("mov-other-item", StockMovementType.POS_SALE, -1, "100").setPackageSessionId("ps-other");
        assertThrows(InvalidRequestException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "V4").reversesMovementId("mov-other-item").build()));
        // A correction of a correction.
        original("mov-correction", StockMovementType.POS_SALE, -1, "100").setReversesMovementId("mov-x");
        assertThrows(InvalidRequestException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 1, "V5").reversesMovementId("mov-correction").build()));
        // More than the movement moved.
        original("mov-sale", StockMovementType.POS_SALE, -1, "100");
        assertThrows(ConflictException.class, () -> ledger.post(
                posting(StockMovementType.POS_SALE, 2, "V6").reversesMovementId("mov-sale").build()));

        verify(levels, never()).applyDelta(anyString(), anyString(), anyString(), anyInt());
        verify(movements, never()).save(any());
    }

    @Test
    void aVoidedSaleComesBackAtTheCostOfTheSaleNotAtTheAverageOfToday() {
        // Sold 1 at 100. A receipt of 10 at 200 then moved the average to 190.9091 (11 units).
        // The void must carry 100, or cost of goods for the pair would be -90.91.
        variant("QUANTITY", "TRACKED", "190.9091");
        location(false);
        onHand(11);
        lockedCost("190.9091", 12); // 11 before, 12 after the unit is back
        original("mov-sale", StockMovementType.POS_SALE, -1, "100");

        ledger.post(posting(StockMovementType.POS_SALE, 1, "VOID:a").reversesMovementId("mov-sale").build());

        assertEquals(new BigDecimal("100.0000"), saved().getUnitCost());
        // (190.9091 x 11 + 100 x 1) / 12 = 183.3333
        verify(variants).setCostPrice(INST, PS, new BigDecimal("183.3333"));
    }

    @Test
    void anUndoneAdjustmentInLeavesAtTheCostItCameInAt() {
        variant("QUANTITY", "TRACKED", "150");
        location(false);
        onHand(10);
        original("mov-adj", StockMovementType.ADJUSTMENT, 3, "100");

        ledger.post(posting(StockMovementType.ADJUSTMENT, -3, "UNDO:adj").reversesMovementId("mov-adj").build());

        assertEquals(new BigDecimal("100.0000"), saved().getUnitCost());
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
    }

    @Test
    void aKeyUsedForAnotherMovementIsRefusedInsteadOfAnsweredAsDone() {
        variant("QUANTITY", "TRACKED", null);
        location(false);
        onHand(5);
        StockMovement first = new StockMovement();
        first.setLocationId(LOC);
        first.setPackageSessionId(PS);
        first.setType(StockMovementType.RECEIPT.name());
        first.setQuantityDelta(5);
        when(movements.findByInstituteIdAndIdempotencyKey(INST, "K")).thenReturn(Optional.of(first));

        assertTrue(assertThrows(ConflictException.class,
                () -> ledger.post(posting(StockMovementType.RECEIPT, 7, "K").build()))
                .getMessage().startsWith("IDEMPOTENCY_KEY_REUSED"));
        verify(levels, never()).applyDelta(anyString(), anyString(), anyString(), anyInt());
    }

    // ── units that leave while they are promised online ─────────────────────

    @Test
    void damageBeyondWhatIsUnpromisedIsRememberedAsADeficit() {
        // 5 on hand, all 5 held or sold online: nothing unpromised. 3 are written off.
        variant("QUANTITY", "TRACKED", "100");
        location(true);
        onHand(5);
        counters(5, 0);

        StockPostResult result = ledger.post(posting(StockMovementType.DAMAGE, -3, "DMG:1").build());

        assertEquals(3, result.sellableShortfall());
        verify(packageSessions).commerceStockOutFloored(PS, 3);
        verify(packageSessions).commerceAddSellableDeficit(PS, 3);
    }

    @Test
    void damageOfUnpromisedUnitsLeavesNoDeficit() {
        variant("QUANTITY", "TRACKED", "100");
        location(true);
        onHand(5);
        counters(5, 4);

        assertEquals(0, ledger.post(posting(StockMovementType.DAMAGE, -3, "DMG:1").build()).sellableShortfall());
        verify(packageSessions, never()).commerceAddSellableDeficit(anyString(), anyInt());
    }

    @Test
    void stockThatComesInPaysOffTheDeficitBeforeAnythingGoesOnSale() {
        // The damage above is corrected: +3 with a deficit of 3. All 5 units are still promised,
        // so nothing becomes sellable. Without the deficit available_slots would rise to 3.
        variant("QUANTITY", "TRACKED", "100");
        location(true);
        onHand(2);
        counters(2, 0);
        when(packageSessions.commerceSellableDeficit(PS)).thenReturn(3);

        ledger.post(posting(StockMovementType.ADJUSTMENT, 3, "ADJ:fix").build());

        verify(packageSessions).commerceAddSellableDeficit(PS, -3);
        verify(packageSessions).commerceStockIn(PS, 3, 0);
    }

    @Test
    void aReceiptLargerThanTheDeficitPutsOnlyTheRestOnSale() {
        variant("QUANTITY", "TRACKED", null);
        location(true);
        onHand(2);
        counters(2, 0);
        when(packageSessions.commerceSellableDeficit(PS)).thenReturn(3);

        ledger.post(posting(StockMovementType.RECEIPT, 10, "RECEIPT:line-9").build());

        verify(packageSessions).commerceAddSellableDeficit(PS, -3);
        verify(packageSessions).commerceStockIn(PS, 10, 7);
    }

    // ── the website counters at an online location ──────────────────────────

    @Test
    void aReceiptAtAnOnlineLocationRaisesBothCounters() {
        variant("QUANTITY", "TRACKED", null);
        location(true);
        onHand(0);
        counters(0, 0);

        ledger.post(posting(StockMovementType.RECEIPT, 8, "RECEIPT:line-1").build());

        verify(packageSessions).commerceStockIn(PS, 8, 8);
        assertTrue(saved().isAffectsSellable());
    }

    @Test
    void aShipmentLowersMaxSeatsOnlyBecauseTheHoldAlreadyTookTheSlot() {
        variant("QUANTITY", "TRACKED", "10");
        location(true);
        onHand(5);
        counters(5, 3);

        ledger.post(posting(StockMovementType.SALE, -2, "SALE:ship-line-1").build());

        verify(packageSessions).commerceStockShipped(PS, 2);
        verify(packageSessions, never()).commerceStockOutFloored(anyString(), anyInt());
        verify(packageSessions, never()).commerceStockSoldAtCounter(anyString(), anyInt());
    }

    @Test
    void aCounterSaleOfUnitsPromisedOnlineIsRefused() {
        variant("QUANTITY", "TRACKED", "10");
        location(true);
        onHand(2);          // two on the shelf...
        counters(2, 0);     // ...both held or sold online
        when(packageSessions.commerceStockSoldAtCounter(PS, 1)).thenReturn(0);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> ledger.post(posting(StockMovementType.POS_SALE, -1, "POS:1").build()));

        assertTrue(refused.getMessage().startsWith("SOLD_ONLINE"));
        verify(movements, never()).save(any());
    }

    @Test
    void damageOfPromisedUnitsStopsAvailableAtZeroAndReportsTheShortfall() {
        variant("QUANTITY", "TRACKED", "10");
        location(true);
        onHand(5);
        counters(5, 1); // four of the five are held or sold online

        StockPostResult result = ledger.post(posting(StockMovementType.DAMAGE, -3, "ADJ:1").build());

        verify(packageSessions).commerceStockOutFloored(PS, 3);
        assertEquals(2, result.sellableShortfall());
    }

    // ── cost ────────────────────────────────────────────────────────────────

    @Test
    void aReceiptWithAKnownCostMovesTheWeightedAverage() {
        variant("QUANTITY", "TRACKED", "100");
        location(false);
        onHand(10);
        lockedCost("100", 20); // 10 before, 10 received

        ledger.post(posting(StockMovementType.RECEIPT, 10, "RECEIPT:line-1").unitCost(new BigDecimal("120")).build());

        verify(variants).setCostPrice(INST, PS, new BigDecimal("110.0000"));
        StockMovement movement = saved();
        assertEquals(new BigDecimal("120.0000"), movement.getUnitCost());
        assertFalse(movement.isCostProvisional());
    }

    @Test
    void aReceiptWithNoCostIsStampedAtTheAverageAsProvisionalAndLeavesItAlone() {
        variant("QUANTITY", "TRACKED", "100");
        location(false);
        onHand(10);

        ledger.post(posting(StockMovementType.RECEIPT, 10, "RECEIPT:line-1").build());

        verify(variants, never()).lockCost(anyString(), anyString());
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
        StockMovement movement = saved();
        assertEquals(new BigDecimal("100.0000"), movement.getUnitCost());
        assertTrue(movement.isCostProvisional());
    }

    @Test
    void anOutgoingMovementIsStampedWithTheCostInForce() {
        variant("QUANTITY", "TRACKED", "110");
        location(false);
        onHand(10);

        ledger.post(posting(StockMovementType.SALE, -4, "SALE:1").build());

        assertEquals(new BigDecimal("110.0000"), saved().getUnitCost());
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
    }

    @Test
    void reversingAReceiptTakesItsCostBackOutOfTheAverageAndRecordsWhy() {
        variant("QUANTITY", "TRACKED", "110");
        location(false);
        onHand(20);
        lockedCost("110", 10); // 20 before, 10 after the reversal
        original("mov-0", StockMovementType.RECEIPT, 10, "120");

        ledger.post(posting(StockMovementType.RECEIPT, -10, "RECEIPT_REVERSAL:line-2")
                .reversesMovementId("mov-0").unitCost(new BigDecimal("120")).reason("RECEIPT_REVERSAL").build());

        verify(variants).setCostPrice(INST, PS, new BigDecimal("100.0000"));
        ArgumentCaptor<StockCostAdjustment> row = ArgumentCaptor.forClass(StockCostAdjustment.class);
        verify(adjustments).save(row.capture());
        assertEquals(CostAdjustmentReason.RECEIPT_REVERSAL.name(), row.getValue().getReason());
        assertEquals(new BigDecimal("110"), row.getValue().getOldAverage());
        assertEquals(new BigDecimal("100.0000"), row.getValue().getNewAverage());
        assertEquals(new BigDecimal("0.00"), row.getValue().getVarianceAmount());
    }

    @Test
    void aReversalThatWouldLeaveNoPositiveAverageKeepsItAndBooksTheVariance() {
        variant("QUANTITY", "TRACKED", "100");
        location(false);
        onHand(11);
        lockedCost("100", 1); // 11 before, 1 after
        original("mov-0", StockMovementType.RECEIPT, 10, "120");

        ledger.post(posting(StockMovementType.RECEIPT, -10, "RECEIPT_REVERSAL:line-2")
                .reversesMovementId("mov-0").unitCost(new BigDecimal("120")).build());

        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
        ArgumentCaptor<StockCostAdjustment> row = ArgumentCaptor.forClass(StockCostAdjustment.class);
        verify(adjustments).save(row.capture());
        assertEquals(new BigDecimal("200.00"), row.getValue().getVarianceAmount());
    }

    // ── cost known later ────────────────────────────────────────────────────

    private void receiptLine(String unitCost, int quantity, String receiptStatus) {
        LineRow line = mock(LineRow.class);
        when(line.getId()).thenReturn("line-1");
        when(line.getPackageSessionId()).thenReturn(PS);
        when(line.getQtyReceived()).thenReturn(quantity);
        when(line.getUnitCost()).thenReturn(unitCost == null ? null : new BigDecimal(unitCost));
        when(line.getReceiptStatus()).thenReturn(receiptStatus);
        when(line.getSourceKind()).thenReturn("OTHER");
        when(lines.findRow(INST, "line-1")).thenReturn(Optional.of(line));
    }

    private static ReceiptCostChange typed(String cost) {
        return new ReceiptCostChange(INST, "line-1", null, new BigDecimal(cost), CostSource.TYPED,
                CostAdjustmentReason.TYPED, null, null, "user-1", "COST:line-1:req-1");
    }

    @Test
    void aCostTypedLaterMovesTheAverageAndPutsThePartOnSoldUnitsInVariance() {
        variant("QUANTITY", "TRACKED", "100");
        receiptLine("100", 10, "POSTED");
        lockedCost("100", 1); // nine of the ten were sold

        List<StockCostAdjustment> written = ledger.applyReceiptCost(typed("150"));

        verify(variants).setCostPrice(INST, PS, new BigDecimal("150.0000"));
        verify(lines).setCost(INST, "line-1", new BigDecimal("150.0000"), "TYPED");
        assertEquals(1, written.size());
        assertEquals(new BigDecimal("450.00"), written.get(0).getVarianceAmount());
        assertEquals(new BigDecimal("100"), written.get(0).getOldUnitCost());
        assertEquals(new BigDecimal("150.0000"), written.get(0).getNewUnitCost());
        // The movement posted at receipt is never touched: the ledger only ever inserts.
        verify(movements, never()).save(any());
    }

    @Test
    void aCostThatWouldMakeTheAverageNegativeIsRefusedAndNothingIsWritten() {
        variant("QUANTITY", "TRACKED", "5");
        receiptLine("100", 10, "POSTED");
        lockedCost("5", 10);

        ConflictException refused = assertThrows(ConflictException.class, () -> ledger.applyReceiptCost(typed("0")));

        assertTrue(refused.getMessage().startsWith("COST_NEGATIVE"));
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
        verify(lines, never()).setCost(anyString(), anyString(), any(), anyString());
        verify(adjustments, never()).save(any());
    }

    @Test
    void aRepeatedCostChangeChangesNothing() {
        variant("QUANTITY", "TRACKED", "100");
        receiptLine("100", 10, "POSTED");
        StockCostAdjustment done = new StockCostAdjustment();
        when(adjustments.findByInstituteIdAndIdempotencyKey(INST, "COST:line-1:req-1")).thenReturn(Optional.of(done));

        List<StockCostAdjustment> written = ledger.applyReceiptCost(typed("150"));

        assertSame(done, written.get(0));
        verify(variants, never()).lockCost(anyString(), anyString());
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
    }

    @Test
    void aReversedReceiptTakesNoCost() {
        variant("QUANTITY", "TRACKED", "100");
        receiptLine("100", 10, "REVERSED");
        lockedCost("100", 10);

        assertThrows(ConflictException.class, () -> ledger.applyReceiptCost(typed("150")));
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
    }

    @Test
    void theFirstStandardCostOfAnItemIsAlsoItsStartingAverage() {
        variant("QUANTITY", "TRACKED", null);
        lockedCost(null, 0);

        StockCostAdjustment row = ledger.setStandardCost(INST, PS, new BigDecimal("80"), "user-1", "STANDARD:ps-1:r1");

        verify(variants).setStandardCost(INST, PS, new BigDecimal("80.0000"));
        verify(variants).setCostPrice(INST, PS, new BigDecimal("80.0000"));
        assertEquals(CostAdjustmentReason.STANDARD_SET.name(), row.getReason());
        assertNull(row.getOldAverage());
    }

    // ── pieces ──────────────────────────────────────────────────────────────

    private void piece(String status, String locationId, String unitCost) {
        PieceRow row = mock(PieceRow.class);
        when(row.getId()).thenReturn("piece-1");
        when(row.getCode()).thenReturn("PABCDEFGH2");
        when(row.getPackageSessionId()).thenReturn(PS);
        when(row.getStatus()).thenReturn(status);
        when(row.getLocationId()).thenReturn(locationId);
        when(row.getUnitCost()).thenReturn(unitCost == null ? null : new BigDecimal(unitCost));
        when(pieces.lockRow(INST, "piece-1")).thenReturn(Optional.of(row));
    }

    @Test
    void aPieceItemMovesOnePieceAtATimeAndNeedsItsPiece() {
        variant("PIECE", "TRACKED", null);
        location(false);
        onHand(1);

        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.DAMAGE, -1, "ADJ:1").build()));
        assertThrows(InvalidRequestException.class,
                () -> ledger.post(posting(StockMovementType.RECEIPT, 2, "RECEIPT:1").pieceId("piece-1").build()));
    }

    @Test
    void damageWritesThePieceOffByCompareAndSetAndStampsItsOwnCost() {
        variant("PIECE", "TRACKED", null);
        location(false);
        onHand(1);
        piece("IN_STOCK", LOC, "2500");
        when(pieces.transition(INST, "piece-1", "IN_STOCK", LOC, "WRITTEN_OFF", null)).thenReturn(1);

        ledger.post(posting(StockMovementType.DAMAGE, -1, "ADJ:1").pieceId("piece-1").build());

        assertEquals(new BigDecimal("2500.0000"), saved().getUnitCost());
        verify(variants, never()).setCostPrice(anyString(), anyString(), any());
    }

    @Test
    void aPieceSomebodyElseMovedFirstIsRefused() {
        variant("PIECE", "TRACKED", null);
        location(false);
        onHand(1);
        piece("IN_STOCK", LOC, null);
        when(pieces.transition(INST, "piece-1", "IN_STOCK", LOC, "SOLD", null)).thenReturn(0);

        ConflictException refused = assertThrows(ConflictException.class,
                () -> ledger.post(posting(StockMovementType.POS_SALE, -1, "POS:1").pieceId("piece-1").build()));

        assertTrue(refused.getMessage().startsWith("PIECE_STATE"));
        verify(movements, never()).save(any());
    }

    @Test
    void whereAPieceGoesWhenItLeaves() {
        assertEquals("VOIDED", StockLedgerService.awayStatus(StockMovementType.RECEIPT).name());
        assertEquals("WRITTEN_OFF", StockLedgerService.awayStatus(StockMovementType.DAMAGE).name());
        assertEquals("IN_TRANSIT", StockLedgerService.awayStatus(StockMovementType.TRANSFER_OUT).name());
        assertEquals("SOLD", StockLedgerService.awayStatus(StockMovementType.SALE).name());
        assertEquals("RETURNED_TO_SUPPLIER", StockLedgerService.awayStatus(StockMovementType.PURCHASE_RETURN).name());
    }
}
