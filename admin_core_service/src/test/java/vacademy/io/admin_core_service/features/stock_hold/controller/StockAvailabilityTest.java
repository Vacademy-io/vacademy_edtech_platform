package vacademy.io.admin_core_service.features.stock_hold.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The cart asks this before opening the checkout form, usually without a login. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class StockAvailabilityTest {

    @Mock private PackageSessionRepository packageSessionRepository;
    @InjectMocks private StockHoldService service;

    private StockHoldReleaseController controller;

    @BeforeEach
    void setUp() {
        controller = new StockHoldReleaseController(service);
    }

    private static PackageSessionRepository.StockInfoProjection session(String id, Integer maxSeats, Integer slots) {
        PackageSessionRepository.StockInfoProjection info = mock(PackageSessionRepository.StockInfoProjection.class);
        when(info.getPackageSessionId()).thenReturn(id);
        when(info.getMaxSeats()).thenReturn(maxSeats);
        when(info.getAvailableSlots()).thenReturn(slots);
        return info;
    }

    @Test
    void reportsCopiesLeftAndLeavesOutSessionsWithNoLimit() {
        List<PackageSessionRepository.StockInfoProjection> rows = List.of(
                session("limited", 10, 1), session("sold-out", 10, 0), session("unlimited", null, null));
        when(packageSessionRepository.findStockInfoByIds(anyCollection())).thenReturn(rows);

        Map<String, Integer> left = controller.availability(List.of("limited", "sold-out", "unlimited", "unknown")).getBody();

        assertEquals(Map.of("limited", 1, "sold-out", 0), left);
    }

    @Test
    void anOversoldCountOrMissingCountReadsAsNoneLeft() {
        List<PackageSessionRepository.StockInfoProjection> rows = List.of(session("oversold", 10, -2), session("blank", 10, null));
        when(packageSessionRepository.findStockInfoByIds(anyCollection())).thenReturn(rows);

        assertEquals(Map.of("oversold", 0, "blank", 0), controller.availability(List.of("oversold", "blank")).getBody());
    }

    @Test
    void anEmptyCartAsksNothing() {
        assertEquals(Map.of(), controller.availability(List.of()).getBody());
        assertEquals(Map.of(), controller.availability(null).getBody());
        verify(packageSessionRepository, never()).findStockInfoByIds(anyCollection());
    }

    @Test
    void tooManyIdsIsABadRequest() {
        List<String> ids = new ArrayList<>(Collections.nCopies(StockHoldReleaseController.MAX_AVAILABILITY_IDS + 1, "id"));
        assertThrows(InvalidRequestException.class, () -> controller.availability(ids));
        verify(packageSessionRepository, never()).findStockInfoByIds(anyCollection());
    }
}
