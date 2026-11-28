package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceApproval;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceApprovalRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * An approval row is written only when the approver is a manager today, their PIN passes, and
 * only inside the action's transaction.
 */
class CommerceApprovalServiceTest {

    private CommercePinService pinService;
    private CommerceApprovalRepository repository;
    private CommerceStaffLocationRepository staffLocations;
    private AuthService authService;
    private CommerceApprovalService service;

    @BeforeEach
    void setUp() {
        pinService = mock(CommercePinService.class);
        repository = mock(CommerceApprovalRepository.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        authService = mock(AuthService.class);
        service = new CommerceApprovalService(pinService, repository, staffLocations, authService);
        when(repository.save(any(CommerceApproval.class))).thenAnswer(inv -> inv.getArgument(0));
        roles("manager-1", "COMMERCE_STORE_MANAGER");
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId("inst-1", "manager-1", "loc-1")).thenReturn(true);
    }

    private void roles(String userId, String... names) {
        when(authService.getInstituteRoles("inst-1", List.of(userId))).thenReturn(Map.of(userId, List.of(names)));
    }

    private CommerceApproval approve(String requestedBy, String approver, String locationId) {
        return service.approve("inst-1", locationId, requestedBy, approver, "482913", "VOID", "POS_SALE", "sale-1",
                null, null);
    }

    private void assertRefusedAsWrongPin(String requestedBy, String approver, String locationId) {
        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> approve(requestedBy, approver, locationId));
        assertEquals(CommerceAccessDeniedException.PIN_INVALID, ex.getCode());
        verify(repository, never()).save(any(CommerceApproval.class));
    }

    @Test
    void rightPinWritesTheApprovalRow() {
        service.approve("inst-1", "loc-1", "cashier-1", "manager-1", "482913", "DISCOUNT", "POS_SALE", "sale-1",
                new BigDecimal("150.00"), "festival offer");
        verify(pinService).verify("inst-1", "manager-1", "482913");
        ArgumentCaptor<CommerceApproval> saved = ArgumentCaptor.forClass(CommerceApproval.class);
        verify(repository).save(saved.capture());
        CommerceApproval row = saved.getValue();
        assertEquals("inst-1", row.getInstituteId());
        assertEquals("DISCOUNT", row.getAction());
        assertEquals("POS_SALE", row.getReferenceType());
        assertEquals("sale-1", row.getReferenceId());
        assertEquals("cashier-1", row.getRequestedBy());
        assertEquals("manager-1", row.getApprovedBy());
        assertEquals(new BigDecimal("150.00"), row.getAmount());
        assertEquals("festival offer", row.getReason());
    }

    @Test
    void aManagerDemotedToCashierCanNoLongerApproveWithTheOldPin() {
        // The PIN row outlives the role: the right PIN must not be enough.
        roles("manager-1", "COMMERCE_POS_CASHIER");
        assertRefusedAsWrongPin("cashier-1", "manager-1", "loc-1");
        // Their own request too.
        assertRefusedAsWrongPin("manager-1", "manager-1", "loc-1");
        verifyNoInteractions(pinService);
    }

    @Test
    void anApproverWithNoRoleHereOrAFailedLookupIsRefused() {
        when(authService.getInstituteRoles("inst-1", List.of("manager-1"))).thenReturn(Map.of());
        assertRefusedAsWrongPin("cashier-1", "manager-1", "loc-1");
        assertRefusedAsWrongPin("cashier-1", null, "loc-1");
        verifyNoInteractions(pinService);
    }

    @Test
    void aManagerApprovesOnlyAtTheirOwnLocations() {
        assertRefusedAsWrongPin("cashier-1", "manager-1", "loc-2");
        assertDoesNotThrow(() -> approve("cashier-1", "manager-1", "loc-1"));
        // An action with no location needs the role only.
        assertDoesNotThrow(() -> approve("cashier-1", "manager-1", null));
    }

    @Test
    void anAdminApprovesAtEveryLocation() {
        roles("admin-1", "ADMIN");
        assertDoesNotThrow(() -> approve("cashier-1", "admin-1", "loc-2"));
        verify(pinService).verify("inst-1", "admin-1", "482913");
    }

    @Test
    void wrongOrLockedPinWritesNothing() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_LOCKED, "locked"))
                .when(pinService).verify("inst-1", "manager-1", "000000");
        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> service.approve("inst-1", "loc-1", "cashier-1", "manager-1", "000000", "VOID", "POS_SALE",
                        "sale-1", null, null));
        assertEquals(CommerceAccessDeniedException.PIN_LOCKED, ex.getCode());
        verify(repository, never()).save(any(CommerceApproval.class));
    }

    @Test
    void missingReferenceIsRefusedBeforeThePinIsTried() {
        assertThrows(IllegalArgumentException.class,
                () -> service.approve("inst-1", "loc-1", "cashier-1", "manager-1", "482913", "VOID", "POS_SALE", " ",
                        null, null));
        assertThrows(IllegalArgumentException.class,
                () -> service.approve(null, "loc-1", "cashier-1", "manager-1", "482913", "VOID", "POS_SALE", "sale-1",
                        null, null));
        verifyNoInteractions(pinService);
    }

    @Test
    void approveMustRunInsideTheActionsTransaction() throws Exception {
        // MANDATORY: called with no transaction it fails, so a row can never outlive its action.
        Transactional tx = CommerceApprovalService.class.getMethod("approve", String.class, String.class,
                String.class, String.class, String.class, String.class, String.class, String.class,
                BigDecimal.class, String.class).getAnnotation(Transactional.class);
        assertEquals(Propagation.MANDATORY, tx.propagation());
    }

    @Test
    void pinTriesAreCountedOutsideTheActionsTransaction() throws Exception {
        // REQUIRES_NEW: the wrong-try count must survive the roll-back of the refused action.
        Transactional tx = CommercePinAttemptService.class.getMethod("check", String.class, String.class,
                String.class).getAnnotation(Transactional.class);
        assertEquals(Propagation.REQUIRES_NEW, tx.propagation());
    }
}
