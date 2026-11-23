package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosRegister;
import vacademy.io.admin_core_service.features.commerce.pos.entity.PosSession;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosRegisterRepository;
import vacademy.io.admin_core_service.features.commerce.pos.repository.PosSessionRepository;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosAccess;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSettingsService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The counter's role matrix through the real {@link CommerceAccessGuard}: a cashier at their own
 * location only and on their own session only; a manager on any session of their locations;
 * warehouse and accountant kept out; the feature off for everyone; the limits written by an
 * ADMIN only; another institute's register a 404 before the guard says anything.
 */
class PosAccessTest {

    private static final String INST = "inst-1";
    private static final String L1 = "loc-online";
    private static final String L2 = "loc-store";

    private final CapabilityResolver capabilities = mock(CapabilityResolver.class);
    private final CommerceStaffLocationRepository staffLocations = mock(CommerceStaffLocationRepository.class);
    private final PosRegisterRepository registers = mock(PosRegisterRepository.class);
    private final PosSessionRepository sessions = mock(PosSessionRepository.class);
    private final InstituteRepository institutes = mock(InstituteRepository.class);
    private PosAccess access;
    private PosSettingsService settings;

    private final PosRegister registerAtL2 = new PosRegister();
    private final PosSession sessionOfC = new PosSession();

    @BeforeEach
    void setUp() {
        access = new PosAccess(new CommerceAccessGuard(capabilities, staffLocations), registers, sessions,
                mock(PlatformTransactionManager.class));
        settings = new PosSettingsService(mock(InstituteSettingService.class), institutes,
                mock(InstituteSettingWriter.class), mock(CommerceAuditService.class), access);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        lenient().when(capabilities.isFeatureGranted(INST, "commerce.pos")).thenReturn(true);
        // Cashier C works at L1; cashier D at L1 and L2; the manager at L1 only.
        assign("cashier-c", L1);
        assign("cashier-d", L1);
        assign("cashier-d", L2);
        assign("manager-m", L1);
        registerAtL2.setId("reg-2");
        registerAtL2.setInstituteId(INST);
        registerAtL2.setLocationId(L2);
        lenient().when(registers.findByInstituteIdAndId(INST, "reg-2")).thenReturn(Optional.of(registerAtL2));
        sessionOfC.setId("sess-c");
        sessionOfC.setInstituteId(INST);
        sessionOfC.setLocationId(L1);
        sessionOfC.setCashierUserId("cashier-c");
        sessionOfC.setStatus("OPEN");
        lenient().when(sessions.findByInstituteIdAndId(INST, "sess-c")).thenReturn(Optional.of(sessionOfC));
    }

    @AfterEach
    void clear() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void assign(String user, String location) {
        lenient().when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, user, location)).thenReturn(true);
    }

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static String code(Executable call) {
        return assertThrows(CommerceAccessDeniedException.class, call).getCode();
    }

    private final CustomUserDetails cashierC = user("cashier-c", "COMMERCE_POS_CASHIER");
    private final CustomUserDetails cashierD = user("cashier-d", "COMMERCE_POS_CASHIER");
    private final CustomUserDetails manager = user("manager-m", "COMMERCE_STORE_MANAGER");
    private final CustomUserDetails admin = user("admin-a", "ADMIN");

    @Test
    void aCashierWorksAtTheirOwnLocationsOnly() {
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> access.register(cashierC, INST, "reg-2", PosAccess.TILL)));
        assertDoesNotThrow(() -> access.register(cashierD, INST, "reg-2", PosAccess.TILL));
        assertDoesNotThrow(() -> access.register(admin, INST, "reg-2", PosAccess.TILL), "an ADMIN skips the location");
    }

    @Test
    void aCashierOnAnotherCashiersSessionIsRefused() {
        assertDoesNotThrow(() -> access.session(cashierC, INST, "sess-c"));
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> access.session(cashierD, INST, "sess-c"));
        assertEquals(PosAccess.SESSION_NOT_YOURS, e.getCode());
        assertTrue(e.getMessage().startsWith("SESSION_NOT_YOURS: "), e.getMessage());
    }

    @Test
    void aManagerActsOnAnySessionOfTheirLocationsAndNoOther() {
        assertDoesNotThrow(() -> access.session(manager, INST, "sess-c"), "the manager voids or closes C's bills");
        assertTrue(PosAccess.isManager(manager));
        assertTrue(PosAccess.isManager(admin));
        assertTrue(!PosAccess.isManager(cashierC));
        sessionOfC.setLocationId(L2);
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> access.session(manager, INST, "sess-c")));
        assertDoesNotThrow(() -> access.session(admin, INST, "sess-c"));
    }

    @Test
    void warehouseAndAccountantAreNotAtTheTill() {
        for (CustomUserDetails other : List.of(user("w-1", "COMMERCE_WAREHOUSE_STAFF"),
                user("a-1", "COMMERCE_ACCOUNTANT"), user("l-1", "STUDENT"))) {
            assertEquals("ROLE_NOT_ALLOWED", code(() -> access.require(other, INST, PosAccess.TILL)));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> access.register(other, INST, "reg-2", PosAccess.TILL)));
        }
        assertEquals("ROLE_NOT_ALLOWED", code(() -> access.register(cashierD, INST, "reg-2", PosAccess.MANAGER)),
                "a cashier makes no register and moves no cash");
    }

    @Test
    void theFeatureOffRefusesEveryone() {
        when(capabilities.isFeatureGranted(INST, "commerce.pos")).thenReturn(false);
        for (CustomUserDetails anyone : List.of(cashierC, manager, admin)) {
            assertEquals("FEATURE_DISABLED", code(() -> access.require(anyone, INST, PosAccess.TILL)));
        }
    }

    @Test
    void theLimitsAreWrittenByAnAdminOnly() {
        PosDtos.SettingsRequest body = new PosDtos.SettingsRequest(new BigDecimal("10"), new BigDecimal("100"),
                new BigDecimal("10"));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> settings.update(manager, INST, body)));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> settings.update(cashierC, INST, body)));
        verify(institutes, never()).findByIdForUpdate(anyString());
    }

    @Test
    void anotherInstitutesRegisterIsNotFoundBeforeAnyCheck() {
        VacademyException e = assertThrows(VacademyException.class,
                () -> access.register(cashierC, INST, "reg-of-another", PosAccess.TILL));
        assertTrue(e.getMessage().startsWith(PosAccess.REGISTER_NOT_FOUND), e.getMessage());
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        VacademyException s = assertThrows(VacademyException.class,
                () -> access.session(cashierC, INST, "sess-of-another"));
        assertTrue(s.getMessage().startsWith(PosAccess.SESSION_NOT_FOUND), s.getMessage());
        verifyNoInteractions(capabilities);
    }

    @Test
    void anotherInstitutesMemberIsNotAMember() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", "inst-2");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        assertEquals("ACCESS_DENIED", code(() -> access.register(admin, INST, "reg-2", PosAccess.TILL)));
        assertEquals("ACCESS_DENIED", code(() -> access.require(user("shopper-1"), INST, PosAccess.TILL)));
    }
}
