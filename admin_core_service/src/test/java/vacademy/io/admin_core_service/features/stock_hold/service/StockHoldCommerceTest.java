package vacademy.io.admin_core_service.features.stock_hold.service;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.StockInfoProjection;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.HeldTokenRow;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The commerce additions to the hold code: the release token, the configurable hold length,
 * and the three ways a commerce order settles a hold without the legacy give-back.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StockHoldCommerceTest {

    @Mock private StockHoldRepository stockHoldRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PlatformTransactionManager transactionManager;
    @Mock private EntityManager entityManager;
    @InjectMocks private StockHoldService service;

    /** Constructor injection leaves the persistence-context field empty; the service detaches rows through it. */
    @BeforeEach
    void wireEntityManager() {
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
    }

    private static HeldTokenRow held(String id, String packageSessionId, String tokenHash) {
        HeldTokenRow row = mock(HeldTokenRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getPackageSessionId()).thenReturn(packageSessionId);
        when(row.getQuantity()).thenReturn(2);
        when(row.getReleaseTokenHash()).thenReturn(tokenHash);
        return row;
    }

    private static StockHoldRow row(String id, String packageSessionId, String status, String planId) {
        StockHoldRow row = mock(StockHoldRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getPackageSessionId()).thenReturn(packageSessionId);
        when(row.getStatus()).thenReturn(status);
        when(row.getUserPlanId()).thenReturn(planId);
        when(row.getQuantity()).thenReturn(1);
        return row;
    }

    @SuppressWarnings("unchecked")
    private List<StockHold> holdOneTrackedSession(int minutes) {
        StockInfoProjection info = mock(StockInfoProjection.class);
        when(info.getPackageSessionId()).thenReturn("ps-1");
        when(info.getMaxSeats()).thenReturn(10);
        when(info.getAvailableSlots()).thenReturn(10);
        when(info.getPackageType()).thenReturn("PRODUCT");
        when(packageSessionRepository.findIdsOfInstitute(anyCollection(), anyString())).thenReturn(List.of("ps-1"));
        when(packageSessionRepository.findStockInfoByIds(anyCollection())).thenReturn(List.of(info));
        when(packageSessionRepository.takeAvailableSlots("ps-1", 2)).thenReturn(1);
        when(stockHoldRepository.saveAllAndFlush(anyList())).thenAnswer(inv -> new ArrayList<>((List<StockHold>) inv.getArgument(0)));
        return service.hold("inst-1", Map.of("ps-1", 2), StockHoldKind.PURCHASE, minutes);
    }

    @Test
    void holdIssuesATokenAndStoresOnlyItsHash() {
        List<StockHold> holds = holdOneTrackedSession(15);

        StockHold hold = holds.get(0);
        assertNotNull(hold.getReleaseToken());
        assertTrue(hold.getReleaseToken().length() >= 40);
        assertEquals(64, hold.getReleaseTokenHash().length());
        assertNotEquals(hold.getReleaseToken(), hold.getReleaseTokenHash());
        assertEquals(StockHoldService.sha256Hex(hold.getReleaseToken()), hold.getReleaseTokenHash());
    }

    @Test
    void theHoldLengthIsTheCallers() {
        long before = System.currentTimeMillis();
        Date expiresAt = holdOneTrackedSession(15).get(0).getExpiresAt();
        long minutes = (expiresAt.getTime() - before) / 60_000L;
        assertTrue(minutes >= 14 && minutes <= 15, "expected about 15 minutes, got " + minutes);

        assertThrows(InvalidRequestException.class,
                () -> service.hold("inst-1", Map.of("ps-1", 1), StockHoldKind.PURCHASE, 0));
    }

    @Test
    void releaseWithTheRightTokenFreesTheHoldAndGivesTheStockBack() {
        String hash = StockHoldService.sha256Hex("the-token");
        HeldTokenRow heldRow = held("h1", "ps-1", hash);
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(List.of(heldRow));
        when(stockHoldRepository.releaseIfUnpaid("h1")).thenReturn(1);

        assertEquals(1, service.releaseForOrderWithToken("log-1", "the-token"));

        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 2);
        verify(stockHoldRepository).setReleaseReason("h1", StockHoldService.REASON_SHOPPER);
    }

    @Test
    void releaseWithAWrongTokenIsRefusedAndNothingMoves() {
        String hash = StockHoldService.sha256Hex("the-token");
        HeldTokenRow heldRow = held("h1", "ps-1", hash);
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(List.of(heldRow));

        assertThrows(ForbiddenException.class, () -> service.releaseForOrderWithToken("log-1", "a-guess"));
        assertThrows(ForbiddenException.class, () -> service.releaseForOrderWithToken("log-1", " "));

        verify(stockHoldRepository, never()).releaseIfUnpaid(anyString());
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    @Test
    void aHoldFromBeforeTheTokenCannotBeReleasedByAnyToken() {
        HeldTokenRow heldRow = held("h1", "ps-1", null);
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(List.of(heldRow));
        assertThrows(ForbiddenException.class, () -> service.releaseForOrderWithToken("log-1", "anything"));
    }

    @Test
    void aPaidOrSoldOrderHasNothingHeldSoTheAnswerIsZero() {
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(List.of());
        assertEquals(0, service.releaseForOrderWithToken("log-1", "the-token"));
    }

    @Test
    void noReleaseWhileAPaymentAttemptIsInProgress() throws Exception {
        String hash = StockHoldService.sha256Hex("the-token");
        HeldTokenRow heldRow = held("h1", "ps-1", hash);
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(List.of(heldRow));
        StockHoldCommerceHook paying = new StockHoldCommerceHook() {
            @Override
            public boolean paymentInProgress(String orderPaymentLogId) {
                return true;
            }
        };
        var field = StockHoldService.class.getDeclaredField("commerceHooks");
        field.setAccessible(true);
        field.set(service, List.of(paying));

        assertEquals(0, service.releaseForOrderWithToken("log-1", "the-token"));
        verify(stockHoldRepository, never()).releaseIfUnpaid(anyString());
    }

    @Test
    void theOldFormWithoutATokenNeverReleasesAShopProduct() {
        StockHoldRow variantHold = row("h1", "ps-variant", "HELD", "plan-1");
        StockHoldRow bookHold = row("h2", "ps-book", "HELD", "plan-1");
        when(stockHoldRepository.findHeldRowsByPaymentLogId("log-1")).thenReturn(List.of(variantHold, bookHold));
        when(packageSessionRepository.findCommerceVariantSessionIds(anyCollection())).thenReturn(List.of("ps-variant"));
        when(stockHoldRepository.releaseIfUnpaid("h2")).thenReturn(1);

        assertEquals(1, service.releaseForOrderLegacyForm("log-1"));

        verify(stockHoldRepository, never()).releaseIfUnpaid("h1");
        verify(packageSessionRepository).giveBackAvailableSlots("ps-book", 1);
    }

    @Test
    void markSoldNowTurnsHeldIntoSoldOrFailsTheOrder() {
        StockHold a = new StockHold();
        a.setId("h1");
        a.setPackageSessionId("ps-1");
        StockHold b = new StockHold();
        b.setId("h2");
        b.setPackageSessionId("ps-2");
        when(stockHoldRepository.markSold("h1", "HELD", false)).thenReturn(1);
        when(stockHoldRepository.markSold("h2", "HELD", false)).thenReturn(1);

        service.markSoldNow(List.of(b, a));
        assertEquals("SOLD", a.getStatus());
        assertEquals("SOLD", b.getStatus());

        // The expiry job got there first for h2: the order must not be confirmed.
        when(stockHoldRepository.markSold("h2", "HELD", false)).thenReturn(0);
        assertThrows(ConflictException.class, () -> service.markSoldNow(List.of(a, b)));
    }

    @Test
    void recordSoldWritesASoldRowAndTakesNoStock() {
        when(stockHoldRepository.saveAndFlush(any(StockHold.class))).thenAnswer(inv -> inv.getArgument(0));

        service.recordSold("inst-1", "ps-1", "user-1", "plan-1", "log-1", 3, "loc-1");

        ArgumentCaptor<StockHold> saved = ArgumentCaptor.forClass(StockHold.class);
        verify(stockHoldRepository).saveAndFlush(saved.capture());
        assertEquals("SOLD", saved.getValue().getStatus());
        assertEquals(3, saved.getValue().getQuantity());
        assertEquals("loc-1", saved.getValue().getFulfilmentLocationId());
        assertEquals("log-1", saved.getValue().getPaymentLogId());
        verify(packageSessionRepository, never()).takeAvailableSlots(anyString(), anyInt());
    }

    @Test
    void closeWithoutGiveBackClosesSoldRowsAndGivesNothingBack() {
        StockHoldRow sold = row("h1", "ps-1", "SOLD", "plan-1");
        StockHoldRow stillHeld = row("h2", "ps-2", "HELD", "plan-1");
        StockHoldRow otherPlans = row("h3", "ps-3", "SOLD", "plan-9");
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold, stillHeld, otherPlans));
        when(stockHoldRepository.closeSold("h1", "RTO")).thenReturn(1);

        assertEquals(1, service.closeWithoutGiveBack("plan-1", null, "RTO"));

        verify(stockHoldRepository, never()).closeSold("h2", "RTO");
        verify(stockHoldRepository, never()).closeSold("h3", "RTO");
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    // ── a released hold pays off the variant's sellable deficit first ───────

    private void shopVariantWithDeficit(String packageSessionId, int deficit) {
        PackageSessionRepository.CommerceStockCounters counters = mock(PackageSessionRepository.CommerceStockCounters.class);
        when(packageSessionRepository.lockCommerceStockCounters(packageSessionId)).thenReturn(java.util.Optional.of(counters));
        when(packageSessionRepository.commerceSellableDeficit(packageSessionId)).thenReturn(deficit);
    }

    /**
     * 5 on hand, holds of 2 and 1, then 4 written off: 1 on hand, 3 promised, a deficit of 2.
     * When the hold of 2 is released, none of it may go back on sale: the other hold still
     * needs the one unit left. Before, LEAST(0 + 2, 1) put 1 back and that unit was sold twice.
     */
    @Test
    void aReleasedHoldOfAShortVariantGoesToTheDeficitNotBackOnSale() {
        HeldTokenRow row = held("hold-1", "ps-1", StockHoldService.sha256Hex("the-token"));
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(new ArrayList<>(List.of(row)));
        when(stockHoldRepository.releaseIfUnpaid("hold-1")).thenReturn(1);
        shopVariantWithDeficit("ps-1", 2);

        assertEquals(1, service.releaseForOrderWithToken("log-1", "the-token"));

        verify(packageSessionRepository).commerceAddSellableDeficit("ps-1", -2);
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    @Test
    void onlyWhatIsLeftAfterTheDeficitGoesBackOnSale() {
        HeldTokenRow row = held("hold-1", "ps-1", StockHoldService.sha256Hex("the-token"));
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(new ArrayList<>(List.of(row)));
        when(stockHoldRepository.releaseIfUnpaid("hold-1")).thenReturn(1);
        when(packageSessionRepository.giveBackAvailableSlots("ps-1", 1)).thenReturn(1);
        shopVariantWithDeficit("ps-1", 1);

        service.releaseForOrderWithToken("log-1", "the-token");

        verify(packageSessionRepository).commerceAddSellableDeficit("ps-1", -1);
        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 1);
    }

    @Test
    void aCourseSeatOrAVariantWithNoDeficitIsGivenBackInFullAsBefore() {
        // A course batch: the lock query finds no commerce row, so nothing commerce is read or written.
        StockHoldRow course = row("hold-c", "ps-course", "HELD", "plan-1");
        when(stockHoldRepository.findHeldRowsByPaymentLogId("log-c")).thenReturn(List.of(course));
        when(stockHoldRepository.releaseIfUnpaid("hold-c")).thenReturn(1);
        when(packageSessionRepository.lockCommerceStockCounters("ps-course")).thenReturn(java.util.Optional.empty());
        when(packageSessionRepository.giveBackAvailableSlots("ps-course", 1)).thenReturn(1);

        assertEquals(1, service.releaseForOrderLegacyForm("log-c"));

        verify(packageSessionRepository).giveBackAvailableSlots("ps-course", 1);
        verify(packageSessionRepository, never()).commerceSellableDeficit(anyString());
        verify(packageSessionRepository, never()).commerceAddSellableDeficit(anyString(), anyInt());

        // A shop variant with no deficit.
        HeldTokenRow row = held("hold-1", "ps-1", StockHoldService.sha256Hex("the-token"));
        when(stockHoldRepository.findHeldTokenRowsByPaymentLogId("log-1")).thenReturn(new ArrayList<>(List.of(row)));
        when(stockHoldRepository.releaseIfUnpaid("hold-1")).thenReturn(1);
        when(packageSessionRepository.giveBackAvailableSlots("ps-1", 2)).thenReturn(1);
        shopVariantWithDeficit("ps-1", 0);

        service.releaseForOrderWithToken("log-1", "the-token");

        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 2);
        verify(packageSessionRepository, never()).commerceAddSellableDeficit(anyString(), anyInt());
    }
}
