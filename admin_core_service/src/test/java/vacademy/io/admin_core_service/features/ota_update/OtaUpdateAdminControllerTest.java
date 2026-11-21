package vacademy.io.admin_core_service.features.ota_update;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.mockito.MockedStatic;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.ota_update.controller.OtaUpdateAdminController;
import vacademy.io.admin_core_service.features.ota_update.dto.OtaRegisterRequest;
import vacademy.io.admin_core_service.features.ota_update.dto.OtaVersionDTO;
import vacademy.io.admin_core_service.features.ota_update.service.OtaUpdateService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * OTA bundle registration and toggling is for platform super-admins only
 * (SUPER_ADMIN_USER_IDS, unset in tests: everyone refused). A root institute
 * admin is not enough.
 */
class OtaUpdateAdminControllerTest {

    private OtaUpdateService service;
    private OtaUpdateAdminController controller;

    @BeforeEach
    void setUp() {
        service = mock(OtaUpdateService.class);
        controller = new OtaUpdateAdminController(service);
    }

    private static CustomUserDetails user(boolean root) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of("ADMIN"));
        return new CustomUserDetails(dto);
    }

    private static void assertForbidden(Executable call) {
        VacademyException ex = assertThrows(VacademyException.class, call);
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void usersNotOnTheAllowlistAreRefusedOnEveryRoute() {
        CustomUserDetails rootAdmin = user(true);
        assertForbidden(() -> controller.register(rootAdmin, new OtaRegisterRequest()));
        assertForbidden(() -> controller.listVersions(rootAdmin, PageRequest.of(0, 10)));
        assertForbidden(() -> controller.activate(rootAdmin, "v1"));
        assertForbidden(() -> controller.deactivate(rootAdmin, "v1"));
        verifyNoInteractions(service);
    }

    @Test
    void allowlistedUsersReachTheService() {
        try (MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class)) {
            CustomUserDetails admin = user(false);
            OtaVersionDTO dto = new OtaVersionDTO();
            when(service.registerVersion(any(), eq("u-1"))).thenReturn(dto);
            Page<OtaVersionDTO> page = new PageImpl<>(List.of(dto));
            when(service.listVersions(any())).thenReturn(page);

            assertEquals(HttpStatus.OK, controller.register(admin, new OtaRegisterRequest()).getStatusCode());
            assertEquals(page, controller.listVersions(admin, PageRequest.of(0, 10)).getBody());
            assertEquals(HttpStatus.OK, controller.activate(admin, "v1").getStatusCode());
            assertEquals(HttpStatus.OK, controller.deactivate(admin, "v1").getStatusCode());

            verify(service).activateVersion("v1");
            verify(service).deactivateVersion("v1");
            util.verify(() -> SuperAdminAuthUtil.requireSuperAdmin(admin), times(4));
        }
    }
}
