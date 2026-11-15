package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceStaffController;
import vacademy.io.admin_core_service.features.commerce.security.CommerceStaffService;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffLocationsRequest;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository.LevelQuantity;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository.LocationFacts;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository.CommerceStockCounters;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Locations belong to one institute, and the website counters follow the sells_online flag. */
class StockLocationServiceTest {

    private static final String INST = "inst-1";

    private StockLocationRepository locations;
    private StockLevelRepository levels;
    private PackageSessionRepository packageSessions;
    private CommerceStaffLocationRepository staffLocations;
    private StockLocationService service;

    @BeforeEach
    void setUp() {
        locations = mock(StockLocationRepository.class);
        levels = mock(StockLevelRepository.class);
        packageSessions = mock(PackageSessionRepository.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        service = new StockLocationService(locations, levels, packageSessions, staffLocations,
                mock(CommerceAuditService.class));
        when(locations.saveAndFlush(any(StockLocation.class))).thenAnswer(inv -> {
            StockLocation location = inv.getArgument(0);
            if (location.getId() == null) {
                location.setId("loc-new");
            }
            return location;
        });
    }

    private static LocationRequest store(String code) {
        LocationRequest request = new LocationRequest();
        request.setCode(code);
        request.setName("Main store");
        request.setIsStore(true);
        return request;
    }

    @Test
    void aForeignLocationIdIsRefused() {
        when(locations.findIdsOfInstitute(anyString(), anyCollection())).thenReturn(List.of("loc-1"));

        assertDoesNotThrow(() -> service.requireLocationsOfInstitute(INST, List.of("loc-1")));
        InvalidRequestException refused = assertThrows(InvalidRequestException.class,
                () -> service.requireLocationsOfInstitute(INST, List.of("loc-1", "loc-of-another-institute")));
        assertTrue(refused.getMessage().startsWith("LOCATION_NOT_FOUND"));
    }

    @Test
    void assigningStaffToAForeignLocationWritesNothing() {
        when(locations.findIdsOfInstitute(anyString(), anyCollection())).thenReturn(List.of());
        CommerceStaffService staffService = mock(CommerceStaffService.class);
        CommerceStaffController controller = new CommerceStaffController(mock(CommerceAccessGuard.class),
                staffService, service);
        CustomUserDetails manager = mock(CustomUserDetails.class);
        StaffLocationsRequest request = new StaffLocationsRequest();
        request.setUserId("staff-1");
        request.setLocationIds(List.of("loc-of-another-institute"));

        assertThrows(InvalidRequestException.class, () -> controller.setLocations(manager, INST, request));

        verifyNoInteractions(staffService);
    }

    @Test
    void aManagerWhoCreatesALocationIsAssignedToItAndAnAdminIsNot() {
        service.create(INST, "manager-1", false, store("JBP"));
        verify(staffLocations).save(any(CommerceStaffLocation.class));

        service.create(INST, "admin-1", true, store("WH1"));
        verify(staffLocations).save(any(CommerceStaffLocation.class)); // still the one from before
    }

    @Test
    void aSecondCodeOrASecondOnlineLocationIsRefused() {
        when(locations.existsByInstituteIdAndCode(INST, "JBP")).thenReturn(true);
        assertThrows(ConflictException.class, () -> service.create(INST, "admin-1", true, store("jbp")));

        when(locations.findOtherOnlineLocationIds(anyString(), anyString())).thenReturn(List.of("loc-1"));
        LocationRequest online = store("WEB");
        online.setSellsOnline(true);
        assertThrows(ConflictException.class, () -> service.create(INST, "admin-1", true, online));
        verify(locations, never()).saveAndFlush(any());
    }

    @Test
    void aLocationMustBeAStoreAWarehouseOrASource() {
        LocationRequest request = store("X1");
        request.setIsStore(false);
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "admin-1", true, request));

        LocationRequest badGstin = store("X2");
        badGstin.setStateCode("23");
        badGstin.setGstin("27ABCDE1234F1Z5");
        assertThrows(InvalidRequestException.class, () -> service.create(INST, "admin-1", true, badGstin));
    }

    private void lockedLocation(boolean sellsOnline) {
        LocationFacts facts = mock(LocationFacts.class);
        when(facts.getStatus()).thenReturn("ACTIVE");
        when(facts.getSellsOnline()).thenReturn(sellsOnline);
        when(locations.lockForChange(INST, "loc-1")).thenReturn(Optional.of(facts));
    }

    private void stocked(String packageSessionId, int onHand, Integer availableSlots) {
        LevelQuantity level = mock(LevelQuantity.class);
        when(level.getPackageSessionId()).thenReturn(packageSessionId);
        when(level.getOnHand()).thenReturn(onHand);
        when(levels.lockStockedLevelsOfLocation(INST, "loc-1")).thenReturn(List.of(level));
        CommerceStockCounters counters = mock(CommerceStockCounters.class);
        when(counters.getAvailableSlots()).thenReturn(availableSlots);
        when(packageSessions.lockCommerceStockCounters(packageSessionId)).thenReturn(Optional.of(counters));
    }

    @Test
    void startingToSellOnlineAddsTheStockOnHandToTheWebsiteCounters() {
        lockedLocation(false);
        stocked("ps-1", 7, 0);

        service.setSellsOnline(INST, "admin-1", "loc-1", true);

        verify(packageSessions).commerceStockIn("ps-1", 7, 7);
        verify(locations).setSellsOnline(INST, "loc-1", true);
    }

    @Test
    void stoppingTakesItAwayAgain() {
        lockedLocation(true);
        stocked("ps-1", 7, 7);

        service.setSellsOnline(INST, "admin-1", "loc-1", false);

        verify(packageSessions).commerceStockOutFloored("ps-1", 7);
        verify(locations).setSellsOnline(INST, "loc-1", false);
    }

    @Test
    void stoppingIsRefusedWhileUnitsHereAreHeldOrSoldOnline() {
        lockedLocation(true);
        stocked("ps-1", 7, 5); // two of the seven are in a checkout or sold and not shipped

        ConflictException refused = assertThrows(ConflictException.class,
                () -> service.setSellsOnline(INST, "admin-1", "loc-1", false));

        assertTrue(refused.getMessage().startsWith("LOCATION_HAS_OPEN_ORDERS"));
        verify(packageSessions, never()).commerceStockOutFloored(anyString(), anyInt());
        verify(locations, never()).setSellsOnline(anyString(), anyString(), anyBoolean());
    }

    @Test
    void noChangeMeansNoWrite() {
        lockedLocation(true);

        service.setSellsOnline(INST, "admin-1", "loc-1", true);

        verify(locations, never()).setSellsOnline(anyString(), anyString(), anyBoolean());
        verify(packageSessions, never()).commerceStockIn(anyString(), anyInt(), anyInt());
    }
}
