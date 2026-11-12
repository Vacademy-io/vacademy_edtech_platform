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
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.StockInfoProjection;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A MEMBERSHIP package's max_seats is "books per period" and its available_slots "books at
 * once"; a charge (shipping / deposit) has no copies. Neither is stock: activating, holding,
 * reporting or restoring must never move them. Book sessions keep their stock behaviour.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StockHoldMembershipTest {

    private static final String PLAN = "plan-1";

    @Mock private StockHoldRepository stockHoldRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PlatformTransactionManager transactionManager;
    @Mock private EntityManager entityManager;
    @InjectMocks private StockHoldService service;

    /** Home Delivery membership (20 per period, 1 at once), a deposit, and a book with 3 copies. */
    private static final Map<String, StockInfoProjection> SESSIONS = Map.of(
            "ps-mem", session("ps-mem", "MEMBERSHIP", 20, 1),
            "ps-dep", session("ps-dep", "SECURITY_DEPOSIT", 5, 5),
            "ps-book", session("ps-book", "COURSE", 10, 3));

    private static StockInfoProjection session(String id, String packageType, Integer maxSeats, Integer slots) {
        StockInfoProjection info = mock(StockInfoProjection.class);
        when(info.getPackageSessionId()).thenReturn(id);
        when(info.getPackageType()).thenReturn(packageType);
        when(info.getMaxSeats()).thenReturn(maxSeats);
        when(info.getAvailableSlots()).thenReturn(slots);
        when(info.getPackageName()).thenReturn(id);
        return info;
    }

    private static StockHoldRow soldRow(String id, String packageSessionId) {
        StockHoldRow row = mock(StockHoldRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getPackageSessionId()).thenReturn(packageSessionId);
        when(row.getUserPlanId()).thenReturn(PLAN);
        when(row.getKind()).thenReturn(StockHoldKind.PURCHASE.name());
        when(row.getStatus()).thenReturn("SOLD");
        when(row.getQuantity()).thenReturn(1);
        return row;
    }

    private static UserPlan plan() {
        UserPlan plan = new UserPlan();
        plan.setId(PLAN);
        plan.setUserId("u-1");
        plan.setQuantity(1);
        return plan;
    }

    @BeforeEach
    void setUp() {
        when(packageSessionRepository.findStockInfoByIds(anyCollection())).thenAnswer(invocation -> {
            Collection<String> ids = invocation.getArgument(0);
            List<StockInfoProjection> rows = new ArrayList<>();
            for (String id : ids) {
                if (SESSIONS.containsKey(id)) {
                    rows.add(SESSIONS.get(id));
                }
            }
            return rows;
        });
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan(PLAN)).thenReturn(List.of());
        when(stockHoldRepository.save(any(StockHold.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void activatingAMembershipOrADepositTakesNoStock() {
        service.onPlanActivated(plan(), List.of("ps-mem", "ps-dep"));

        verify(packageSessionRepository, never()).takeAvailableSlots(anyString(), anyInt());
        verify(stockHoldRepository, never()).save(any(StockHold.class));
        verify(stockHoldRepository, never()).findUnclaimedSoldRentPreferences(anyString());
    }

    @Test
    void activatingABookStillTakesItsStock() {
        when(packageSessionRepository.takeAvailableSlots("ps-book", 1)).thenReturn(1);

        service.onPlanActivated(plan(), List.of("ps-mem", "ps-book"));

        verify(packageSessionRepository).takeAvailableSlots("ps-book", 1);
        verify(packageSessionRepository, never()).takeAvailableSlots(eq("ps-mem"), anyInt());
        ArgumentCaptor<StockHold> sold = ArgumentCaptor.forClass(StockHold.class);
        verify(stockHoldRepository).save(sold.capture());
        assertEquals("ps-book", sold.getValue().getPackageSessionId());
        assertEquals("SOLD", sold.getValue().getStatus());
        assertFalse(sold.getValue().getOversold());
    }

    @Test
    void restoringAMembershipPlanGivesNothingBackButItsBookStillDoes() {
        // Rows an activation wrote on the membership before this rule, plus a real book row.
        StockHoldRow membershipRow = soldRow("row-mem", "ps-mem");
        StockHoldRow bookRow = soldRow("row-book", "ps-book");
        when(stockHoldRepository.existsByUserPlanIdOrClaimedByUserPlanId(PLAN, PLAN)).thenReturn(true);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan(PLAN)).thenReturn(List.of(membershipRow, bookRow));
        when(stockHoldRepository.restoreUnclaimed("row-book")).thenReturn(1);
        when(packageSessionRepository.giveBackAvailableSlots("ps-book", 1)).thenReturn(1);

        assertTrue(service.restoreForPlan(PLAN, null));

        verify(stockHoldRepository, never()).restoreUnclaimed("row-mem");
        verify(packageSessionRepository, never()).giveBackAvailableSlots(eq("ps-mem"), anyInt());
        verify(packageSessionRepository).giveBackAvailableSlots("ps-book", 1);
    }

    @Test
    void aMembershipIsNeverHeldNorRefusedAsSoldOut() {
        when(packageSessionRepository.findIdsOfInstitute(anyCollection(), eq("inst-1")))
                .thenReturn(List.of("ps-mem", "ps-dep"));

        List<StockHold> holds = service.hold("inst-1", Map.of("ps-mem", 1, "ps-dep", 1), StockHoldKind.PURCHASE);

        assertTrue(holds.isEmpty());
        verify(packageSessionRepository, never()).takeAvailableSlots(anyString(), anyInt());
    }

    @Test
    void theStockCheckReportsBooksOnly() {
        assertEquals(Map.of("ps-book", 3), service.availableStock(List.of("ps-mem", "ps-dep", "ps-book")));
    }

    @Test
    void onlyPackagesWithCopiesAreStock() {
        assertTrue(StockHoldService.isStockPackageType("COURSE"));
        assertTrue(StockHoldService.isStockPackageType(null));
        assertFalse(StockHoldService.isStockPackageType("MEMBERSHIP"));
        assertFalse(StockHoldService.isStockPackageType(" membership "));
        assertFalse(StockHoldService.isStockPackageType("DELIVERY_CHARGE"));
        assertFalse(StockHoldService.isStockPackageType("SECURITY_DEPOSIT"));
    }
}
