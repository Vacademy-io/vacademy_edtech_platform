package vacademy.io.admin_core_service.features.capabilities.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.mockito.MockedStatic;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityQueryService;
import vacademy.io.admin_core_service.features.capabilities.service.InstituteModuleService;
import vacademy.io.admin_core_service.features.capabilities.service.InstituteSettingAdminService;
import vacademy.io.admin_core_service.features.capabilities.service.ModulePresetService;
import vacademy.io.admin_core_service.features.capabilities.service.VersionConflictException;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Guards: every super-admin route refuses anyone not on SUPER_ADMIN_USER_IDS (unset in tests,
 * so everyone — root users and institute admins included) before touching a service; the
 * tenant /me requires staff of that institute (clientId header) with no root bypass.
 */
class CapabilityControllersGuardTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String INSTITUTE = "inst-1";

    private InstituteModuleService moduleService;
    private ModulePresetService presetService;
    private InstituteSettingAdminService settingAdminService;
    private CapabilityQueryService queryService;
    private SuperAdminModuleController moduleController;
    private SuperAdminInstituteSettingController settingController;
    private CapabilityController capabilityController;

    @BeforeEach
    void setUp() {
        moduleService = mock(InstituteModuleService.class);
        presetService = mock(ModulePresetService.class);
        settingAdminService = mock(InstituteSettingAdminService.class);
        queryService = mock(CapabilityQueryService.class);
        moduleController = new SuperAdminModuleController(moduleService, presetService);
        settingController = new SuperAdminInstituteSettingController(settingAdminService);
        capabilityController = new CapabilityController(queryService, new InstituteAccessValidator());
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", clientId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static void assertForbidden(Executable call) {
        VacademyException ex = assertThrows(VacademyException.class, call);
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void everySuperAdminRouteRefusesNonAllowlistedCallers() {
        ObjectNode body = MAPPER.createObjectNode().put("reason", "r");
        for (CustomUserDetails u : List.of(user(true, "ADMIN"), user(false, "ADMIN"), user(true, "STUDENT"))) {
            assertForbidden(() -> moduleController.getModules(u, INSTITUTE));
            assertForbidden(() -> moduleController.updateModules(u, INSTITUTE, body));
            assertForbidden(() -> moduleController.moduleHistory(u, INSTITUTE, 0, 20));
            assertForbidden(() -> moduleController.overview(u, INSTITUTE));
            assertForbidden(() -> moduleController.listPresets(u));
            assertForbidden(() -> moduleController.upsertPreset(u, "crm_suite", body));
            assertForbidden(() -> moduleController.deletePreset(u, "crm_suite"));
            assertForbidden(() -> moduleController.applyPreset(u, "crm_suite", body));
            assertForbidden(() -> settingController.getDisplaySettings(u, INSTITUTE, "ADMIN"));
            assertForbidden(() -> settingController.putDisplaySettings(u, INSTITUTE, "ADMIN", body));
            assertForbidden(() -> settingController.settingHistory(u, INSTITUTE, null, 0, 20));
            assertForbidden(() -> settingController.settingHistoryEntry(u, INSTITUTE, "h1"));
            assertForbidden(() -> settingController.restoreSetting(u, INSTITUTE, "h1", body));
        }
        assertForbidden(() -> moduleController.getModules(null, INSTITUTE));
        verifyNoInteractions(moduleService, presetService, settingAdminService);
    }

    @Test
    void allowlistedCallerReachesTheServices() {
        CustomUserDetails staff = user(false);
        ObjectNode body = MAPPER.createObjectNode().put("reason", "r");
        try (MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class)) {
            when(moduleService.view(INSTITUTE)).thenReturn(Map.of("mode", "LEGACY"));
            assertEquals("LEGACY", moduleController.getModules(staff, INSTITUTE).getBody().get("mode"));
            moduleController.updateModules(staff, INSTITUTE, body);
            verify(moduleService).update(INSTITUTE, body, "u-1");
            moduleController.overview(staff, "a,b");
            verify(moduleService).overview(List.of("a", "b"));
            assertEquals(HttpStatus.NO_CONTENT, moduleController.deletePreset(staff, "x").getStatusCode());
            settingController.putDisplaySettings(staff, INSTITUTE, "CUSTOM:r1", body);
            verify(settingAdminService).putDisplaySettings(INSTITUTE, "CUSTOM:r1", body, "u-1");
            settingController.restoreSetting(staff, INSTITUTE, "h1", body);
            verify(settingAdminService).restore(eq(INSTITUTE), eq("h1"), eq(body), eq("u-1"));
            util.verify(() -> SuperAdminAuthUtil.requireSuperAdmin(any()), org.mockito.Mockito.times(6));
        }
    }

    @Test
    void versionConflictIs409WithCode() {
        ResponseEntity<Map<String, Object>> res = settingController.versionConflict(new VersionConflictException("v2"));
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("VERSION_CONFLICT", res.getBody().get("code"));
        assertEquals("v2", res.getBody().get("current_version"));
    }

    @Test
    void meRequiresStaffOfThatInstituteWithoutRootBypass() {
        when(queryService.me(INSTITUTE)).thenReturn(Map.of("mode", "LEGACY"));
        assertEquals(HttpStatus.OK, capabilityController.me(user(false, "ADMIN"), INSTITUTE).getStatusCode());
        assertEquals(HttpStatus.OK, capabilityController.me(user(false, "TEACHER"), INSTITUTE).getStatusCode());
        assertThrows(ForbiddenException.class, () -> capabilityController.me(user(true, "STUDENT"), INSTITUTE));
        assertThrows(ForbiddenException.class, () -> capabilityController.me(user(true), INSTITUTE));
        clientIdHeader("inst-2");
        assertThrows(ForbiddenException.class, () -> capabilityController.me(user(false, "ADMIN"), INSTITUTE));
        verify(queryService, org.mockito.Mockito.times(2)).me(INSTITUTE);
    }

    @Test
    void catalogNeedsASignedInUser() {
        when(queryService.catalog()).thenReturn(Map.of("catalog", Map.of()));
        assertEquals(HttpStatus.OK, capabilityController.catalog(user(true, "STUDENT")).getStatusCode());
        assertThrows(VacademyException.class, () -> capabilityController.catalog(null));
    }
}
