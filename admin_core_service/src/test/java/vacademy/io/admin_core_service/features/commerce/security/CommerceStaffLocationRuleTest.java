package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A store manager acts only at assigned locations. A manager hands out only the locations they
 * hold, and never to themselves. An institute ADMIN does not go through this rule.
 */
class CommerceStaffLocationRuleTest {

    private static final String INST = "inst-1";
    private static final String MANAGER = "manager-a";

    private CommerceStaffLocationRepository repository;
    private CommerceStaffService service;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceStaffLocationRepository.class);
        service = new CommerceStaffService(repository, mock(CommercePinService.class), mock(CommerceAuditService.class));
        assigned(MANAGER, "loc-a");
    }

    private void assigned(String userId, String... locationIds) {
        List<CommerceStaffLocation> rows = new ArrayList<>();
        for (String locationId : locationIds) {
            CommerceStaffLocation row = new CommerceStaffLocation();
            row.setInstituteId(INST);
            row.setUserId(userId);
            row.setLocationId(locationId);
            rows.add(row);
        }
        when(repository.findByInstituteIdAndUserId(INST, userId)).thenReturn(rows);
    }

    @Test
    void aManagerCannotChangeTheirOwnLocations() {
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.requireManagerMayAssign(INST, MANAGER, MANAGER, List.of("loc-a", "loc-b", "loc-c")));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, refused.getCode());

        // Not even to a list they already hold: the rule is about who, not what.
        assertThrows(CommerceAccessDeniedException.class,
                () -> service.requireManagerMayAssign(INST, MANAGER, " " + MANAGER + " ", List.of("loc-a")));
    }

    @Test
    void aManagerCannotGiveSomeoneALocationTheyDoNotHoldThemselves() {
        assigned("cashier-1");

        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.requireManagerMayAssign(INST, MANAGER, "cashier-1", List.of("loc-a", "loc-b")));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, refused.getCode());
    }

    @Test
    void aManagerCannotStripAnotherManagersLocationsElsewhere() {
        assigned("manager-b", "loc-b", "loc-c");

        assertThrows(CommerceAccessDeniedException.class,
                () -> service.requireManagerMayAssign(INST, MANAGER, "manager-b", List.of()));
        assertThrows(CommerceAccessDeniedException.class,
                () -> service.requireManagerMayAssign(INST, MANAGER, "manager-b", List.of("loc-b")));
    }

    @Test
    void aManagerAssignsAndRemovesTheirOwnLocationForOthersAndLeavesTheRestAlone() {
        assigned("cashier-1", "loc-b");

        // Adds loc-a, keeps the cashier's loc-b (which the manager does not hold) untouched.
        assertDoesNotThrow(() -> service.requireManagerMayAssign(INST, MANAGER, "cashier-1", List.of("loc-a", "loc-b")));

        assigned("cashier-1", "loc-a", "loc-b");
        // Removes loc-a again.
        assertDoesNotThrow(() -> service.requireManagerMayAssign(INST, MANAGER, "cashier-1", List.of("loc-b")));
    }
}
