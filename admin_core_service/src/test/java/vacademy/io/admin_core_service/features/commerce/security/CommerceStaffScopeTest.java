package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.dto.StaffPinRequest;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffScope;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Institute-wide scope: set by an institute ADMIN only, upserted, audited on change; the PIN under accounts. */
class CommerceStaffScopeTest {

    private static final String INST = "inst-1";

    private CommerceStaffScopeRepository scopes;
    private CommerceAuditService audit;
    private CommerceStaffService service;

    @BeforeEach
    void setUp() {
        scopes = mock(CommerceStaffScopeRepository.class);
        audit = mock(CommerceAuditService.class);
        service = new CommerceStaffService(mock(CommerceStaffLocationRepository.class), mock(CommercePinService.class),
                audit, scopes);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails principal(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static CommerceStaffScope row(boolean allLocations) {
        CommerceStaffScope row = new CommerceStaffScope();
        row.setInstituteId(INST);
        row.setUserId("staff-1");
        row.setAllLocations(allLocations);
        row.setSetBy("admin-1");
        row.setUpdatedAt(LocalDateTime.of(2026, 11, 20, 10, 0));
        return row;
    }

    // ── Service ─────────────────────────────────────────────────────────────

    @Test
    void readWithoutARowIsNotInstituteWide() {
        when(scopes.findByInstituteIdAndUserId(INST, "staff-1")).thenReturn(Optional.empty());
        Map<String, Object> view = service.scope(INST, " staff-1 ");
        assertEquals("staff-1", view.get("user_id"));
        assertEquals(false, view.get("all_locations"));
        assertEquals(null, view.get("set_by"));
        assertThrows(InvalidRequestException.class, () -> service.scope(INST, "x".repeat(37)));
        assertThrows(InvalidRequestException.class, () -> service.scope(INST, " "));
    }

    @Test
    void firstWriteUpsertsAndAudits() {
        when(scopes.findByInstituteIdAndUserId(INST, "staff-1")).thenReturn(Optional.empty(), Optional.of(row(true)));
        Map<String, Object> view = service.setScope(INST, "admin-1", "staff-1", true);
        verify(scopes).upsert(anyString(), eq(INST), eq("staff-1"), eq(true), eq("admin-1"));
        verify(audit).record(INST, "admin-1", null, "STAFF_SCOPE_EDIT", "STAFF", "staff-1",
                "{\"all_locations\":false}", "{\"all_locations\":true}", null);
        assertEquals(true, view.get("all_locations"));
        assertEquals("admin-1", view.get("set_by"));
    }

    @Test
    void changingAnExistingRowUpdatesItAndAudits() {
        CommerceStaffScope existing = row(true);
        when(scopes.findByInstituteIdAndUserId(INST, "staff-1")).thenReturn(Optional.of(existing));
        when(scopes.saveAndFlush(existing)).thenReturn(existing);
        Map<String, Object> view = service.setScope(INST, "admin-2", "staff-1", false);
        assertEquals(false, existing.isAllLocations());
        assertEquals("admin-2", existing.getSetBy());
        verify(audit).record(INST, "admin-2", null, "STAFF_SCOPE_EDIT", "STAFF", "staff-1",
                "{\"all_locations\":true}", "{\"all_locations\":false}", null);
        assertEquals(false, view.get("all_locations"));
    }

    @Test
    void unchangedScopeWritesAndAuditsNothing() {
        when(scopes.findByInstituteIdAndUserId(INST, "staff-1")).thenReturn(Optional.of(row(true)));
        assertEquals(true, service.setScope(INST, "admin-1", "staff-1", true).get("all_locations"));
        when(scopes.findByInstituteIdAndUserId(INST, "staff-2")).thenReturn(Optional.empty());
        assertEquals(false, service.setScope(INST, "admin-1", "staff-2", false).get("all_locations"));
        verify(scopes, never()).upsert(any(), any(), any(), anyBoolean(), any());
        verify(scopes, never()).saveAndFlush(any());
        verifyNoInteractions(audit);
        assertThrows(InvalidRequestException.class, () -> service.setScope(INST, "admin-1", "staff-1", null));
    }

    // ── Controller guard ────────────────────────────────────────────────────

    private CommerceStaffController controller(CommerceStaffService staffService, boolean pos, boolean accounts) {
        CapabilityResolver resolver = mock(CapabilityResolver.class);
        when(resolver.isFeatureGranted(INST, CommerceFeature.POS.key())).thenReturn(pos);
        when(resolver.isFeatureGranted(INST, CommerceFeature.ACCOUNTS.key())).thenReturn(accounts);
        CommerceAccessGuard guard = new CommerceAccessGuard(resolver, mock(CommerceStaffLocationRepository.class));
        return new CommerceStaffController(guard, staffService, mock(StockLocationService.class));
    }

    private static String code(Runnable call) {
        return assertThrows(CommerceAccessDeniedException.class, call::run).getCode();
    }

    @Test
    void onlyTheInstituteAdminReadsOrSetsScope() {
        CommerceStaffService staffService = mock(CommerceStaffService.class);
        CommerceStaffController c = controller(staffService, true, true);
        CommerceStaffController.StaffScopeRequest body = new CommerceStaffController.StaffScopeRequest();
        body.setUserId("staff-1");
        body.setAllLocations(true);
        for (String role : new String[]{"COMMERCE_STORE_MANAGER", "COMMERCE_ACCOUNTANT", "COMMERCE_WAREHOUSE_STAFF",
                "COMMERCE_POS_CASHIER", "STUDENT"}) {
            assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> c.setScope(principal(role), INST, body)));
            assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, code(() -> c.scope(principal(role), INST, "staff-1")));
        }
        verifyNoInteractions(staffService);
        assertDoesNotThrow(() -> c.setScope(principal("ADMIN"), INST, body));
        verify(staffService).setScope(INST, "u-1", "staff-1", true);
        assertDoesNotThrow(() -> c.scope(principal("ADMIN"), INST, "staff-1"));

        // Accounts off: refused for the ADMIN too.
        CommerceStaffController off = controller(staffService, true, false);
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, code(() -> off.setScope(principal("ADMIN"), INST, body)));
    }

    @Test
    void pinOpensUnderAccountsWithoutTheBillingCounter() {
        CommerceStaffService staffService = mock(CommerceStaffService.class);
        StaffPinRequest pin = new StaffPinRequest();
        CommerceStaffController accountsOnly = controller(staffService, false, true);
        assertDoesNotThrow(() -> accountsOnly.pinStatus(principal("COMMERCE_STORE_MANAGER"), INST));
        assertDoesNotThrow(() -> accountsOnly.setPin(principal("COMMERCE_STORE_MANAGER"), INST, pin));
        verify(staffService).setOwnPin(eq(INST), eq("u-1"), isNull());
        // Still a manager's action: an accountant is refused (with the first side's refusal, as requireEither answers).
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                code(() -> accountsOnly.setPin(principal("COMMERCE_ACCOUNTANT"), INST, pin)));
        CommerceStaffController both = controller(staffService, true, true);
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                code(() -> both.setPin(principal("COMMERCE_ACCOUNTANT"), INST, pin)));
        // The billing counter alone still opens it, as before.
        CommerceStaffController posOnly = controller(staffService, true, false);
        assertDoesNotThrow(() -> posOnly.pinStatus(principal("COMMERCE_STORE_MANAGER"), INST));
        // Neither feature: the first refusal (billing counter) is answered.
        CommerceStaffController neither = controller(staffService, false, false);
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                code(() -> neither.setPin(principal("COMMERCE_STORE_MANAGER"), INST, pin)));
    }
}
