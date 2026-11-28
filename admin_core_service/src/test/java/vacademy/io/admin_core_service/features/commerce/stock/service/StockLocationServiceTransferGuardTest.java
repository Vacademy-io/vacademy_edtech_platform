package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A location does not go INACTIVE while a DISPATCHED transfer names it (to or from); once that
 * transfer is received it may. The location row is locked before the transfers are read, so a
 * dispatch still in flight (holding the row FOR SHARE) is seen.
 */
class StockLocationServiceTransferGuardTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-wh";

    private StockLocationRepository locations;
    private StockTransferRepository transfers;
    private StockLocationService service;
    private StockLocation location;

    @BeforeEach
    void setUp() {
        locations = mock(StockLocationRepository.class);
        transfers = mock(StockTransferRepository.class);
        service = new StockLocationService(locations, mock(StockLevelRepository.class),
                mock(PackageSessionRepository.class), mock(CommerceStaffLocationRepository.class),
                mock(CommerceAuditService.class));
        service.setTransferRepository(transfers);
        location = new StockLocation();
        location.setId(LOC);
        location.setInstituteId(INST);
        location.setCode("WH-1");
        location.setName("Back warehouse");
        location.setWarehouse(true);
        location.setStatus("ACTIVE");
        when(locations.findByInstituteIdAndId(INST, LOC)).thenReturn(Optional.of(location));
        when(locations.saveAndFlush(any(StockLocation.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private static LocationRequest status(String value) {
        LocationRequest request = new LocationRequest();
        request.setStatus(value);
        return request;
    }

    @Test
    void inactiveIsRefusedWhileATransferIsOnTheWay() {
        when(transfers.findDispatchedTouching(INST, LOC)).thenReturn(List.of("TRF-000042"));
        ConflictException refused = assertThrows(ConflictException.class,
                () -> service.update(INST, "admin-1", LOC, status("INACTIVE")));
        assertTrue(refused.getMessage().startsWith("LOCATION_HAS_TRANSFER_IN_TRANSIT: transfer TRF-000042 "),
                refused.getMessage());
        verify(locations, never()).saveAndFlush(any(StockLocation.class));
        // The row lock first, then the read of the transfers on the way.
        InOrder order = inOrder(locations, transfers);
        order.verify(locations).lockForChange(INST, LOC);
        order.verify(transfers).findDispatchedTouching(INST, LOC);
    }

    @Test
    void inactiveIsAllowedOnceNothingIsOnTheWay() {
        when(transfers.findDispatchedTouching(INST, LOC)).thenReturn(List.of());
        StockLocation saved = service.update(INST, "admin-1", LOC, status("INACTIVE"));
        assertEquals("INACTIVE", saved.getStatus());
        verify(locations).saveAndFlush(location);
    }

    @Test
    void otherChangesDoNotLookAtTransfers() {
        LocationRequest rename = new LocationRequest();
        rename.setName("Front warehouse");
        service.update(INST, "admin-1", LOC, rename);
        verify(transfers, never()).findDispatchedTouching(any(), any());
        verify(locations, never()).lockForChange(any(), any());
        // An inactive place switched on again is not checked either.
        location.setStatus("INACTIVE");
        service.update(INST, "admin-1", LOC, status("ACTIVE"));
        verify(transfers, never()).findDispatchedTouching(any(), any());
    }
}
