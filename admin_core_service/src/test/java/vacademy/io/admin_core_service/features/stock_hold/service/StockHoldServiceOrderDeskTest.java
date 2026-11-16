package vacademy.io.admin_core_service.features.stock_hold.service;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;
import vacademy.io.common.exceptions.ConflictException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The order desk's hold steps: {@code giveBackSold} (whole SOLD row, part of it, an unpaid HELD
 * row, an oversold row) runs in the caller's transaction and pays the sellable deficit first;
 * {@code reopenShipped} reopens only rows a shipment closed and moves no counter.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StockHoldServiceOrderDeskTest {

    @Mock private StockHoldRepository stockHoldRepository;
    @Mock private PackageSessionRepository packageSessionRepository;
    @Mock private PlatformTransactionManager transactionManager;
    @Mock private EntityManager entityManager;
    @InjectMocks private StockHoldService service;

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
        // A shop variant with no deficit: everything given back goes on sale.
        when(packageSessionRepository.lockCommerceStockCounters("ps-1")).thenReturn(Optional.of(
                mock(PackageSessionRepository.CommerceStockCounters.class)));
        when(packageSessionRepository.commerceSellableDeficit("ps-1")).thenReturn(0);
        when(packageSessionRepository.giveBackAvailableSlots(anyString(), anyInt())).thenReturn(1);
    }

    private static StockHoldRow row(String id, String status, int quantity) {
        StockHoldRow row = mock(StockHoldRow.class);
        when(row.getId()).thenReturn(id);
        when(row.getPackageSessionId()).thenReturn("ps-1");
        when(row.getStatus()).thenReturn(status);
        when(row.getUserPlanId()).thenReturn("plan-1");
        when(row.getKind()).thenReturn("PURCHASE");
        when(row.getQuantity()).thenReturn(quantity);
        return row;
    }

    @Test
    void bothStepsJoinTheCallersTransactionOnly() throws Exception {
        for (String name : List.of("giveBackSold", "reopenShipped")) {
            java.lang.reflect.Method method = name.equals("giveBackSold")
                    ? StockHoldService.class.getMethod(name, String.class, String.class, int.class, String.class)
                    : StockHoldService.class.getMethod(name, String.class, String.class);
            assertEquals(Propagation.MANDATORY, method.getAnnotation(Transactional.class).propagation(), name);
        }
    }

    @Test
    void aWholeSoldRowIsRestoredAndItsUnitsGoBackOnSale() {
        StockHoldRow sold = row("h-1", "SOLD", 2);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(false);
        when(stockHoldRepository.transitionStatus("h-1", "SOLD", "RESTORED")).thenReturn(1);

        assertEquals(2, service.giveBackSold("plan-1", "ps-1", 2, "CANCELLED"));
        verify(stockHoldRepository).setReleaseReason("h-1", "CANCELLED");
        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 2);
        verify(stockHoldRepository, never()).reduceQuantity(anyString(), anyString(), anyInt());
    }

    @Test
    void partOfASoldRowShrinksItAndOnlyThoseUnitsGoBack() {
        StockHoldRow sold = row("h-1", "SOLD", 3);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(false);
        when(stockHoldRepository.reduceQuantity("h-1", "SOLD", 1)).thenReturn(1);

        assertEquals(1, service.giveBackSold("plan-1", "ps-1", 1, "LINE_CANCELLED"));
        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 1);
        verify(stockHoldRepository, never()).transitionStatus(anyString(), anyString(), anyString());
        verify(stockHoldRepository, never()).setReleaseReason(anyString(), anyString());
    }

    @Test
    void theDeficitIsPaidBeforeAnythingGoesBackOnSale() {
        StockHoldRow sold = row("h-1", "SOLD", 3);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(false);
        when(stockHoldRepository.transitionStatus("h-1", "SOLD", "RESTORED")).thenReturn(1);
        when(packageSessionRepository.commerceSellableDeficit("ps-1")).thenReturn(2);

        assertEquals(3, service.giveBackSold("plan-1", "ps-1", 3, "CANCELLED"));
        verify(packageSessionRepository).commerceAddSellableDeficit("ps-1", -2);
        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 1);
    }

    @Test
    void anUnpaidHeldRowIsReleasedWithItsGiveBack() {
        StockHoldRow held = row("h-1", "HELD", 2);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(held));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(false);
        when(stockHoldRepository.transitionStatus("h-1", "HELD", "RELEASED")).thenReturn(1);

        assertEquals(2, service.giveBackSold("plan-1", "ps-1", 2, "CANCELLED"));
        verify(packageSessionRepository).giveBackAvailableSlots("ps-1", 2);
    }

    @Test
    void anOversoldRowIsClosedWithNothingGivenBack() {
        StockHoldRow sold = row("h-1", "SOLD", 1);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(true);
        when(stockHoldRepository.transitionStatus("h-1", "SOLD", "RESTORED")).thenReturn(1);

        assertEquals(0, service.giveBackSold("plan-1", "ps-1", 1, "CANCELLED"));
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
        verify(packageSessionRepository, never()).commerceAddSellableDeficit(anyString(), anyInt());
    }

    @Test
    void noRowThatFitsIsStockNotSettled() {
        // Too few units, a closed row, another item: nothing fits.
        StockHoldRow small = row("h-1", "SOLD", 1);
        StockHoldRow closed = row("h-2", "RESTORED", 5);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(small, closed));

        ConflictException e = assertThrows(ConflictException.class,
                () -> service.giveBackSold("plan-1", "ps-1", 2, "CANCELLED"));
        assertTrue(e.getMessage().startsWith("STOCK_NOT_SETTLED"));
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    @Test
    void aRowThatChangedMeanwhileGivesNothingBack() {
        StockHoldRow sold = row("h-1", "SOLD", 2);
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(sold));
        when(stockHoldRepository.isOversold("h-1")).thenReturn(false);
        when(stockHoldRepository.transitionStatus("h-1", "SOLD", "RESTORED")).thenReturn(0);

        assertThrows(ConflictException.class, () -> service.giveBackSold("plan-1", "ps-1", 2, "CANCELLED"));
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
    }

    @Test
    void reopenShippedReopensOnlyTheRowsOfTheItemAndMovesNoCounter() {
        StockHoldRow shipped = row("h-1", "RESTORED", 2);
        StockHoldRow other = mock(StockHoldRow.class);
        when(other.getId()).thenReturn("h-2");
        when(other.getPackageSessionId()).thenReturn("ps-2");
        when(other.getStatus()).thenReturn("RESTORED");
        when(other.getUserPlanId()).thenReturn("plan-1");
        when(stockHoldRepository.findRowsOwnedOrClaimedByPlan("plan-1")).thenReturn(List.of(shipped, other));
        when(stockHoldRepository.reopenShipped("h-1")).thenReturn(1);

        assertEquals(1, service.reopenShipped("plan-1", "ps-1"));
        verify(stockHoldRepository).reopenShipped("h-1");
        verify(stockHoldRepository, never()).reopenShipped("h-2");
        verify(packageSessionRepository, never()).giveBackAvailableSlots(anyString(), anyInt());
        verify(packageSessionRepository, never()).commerceAddSellableDeficit(anyString(), anyInt());
    }
}
