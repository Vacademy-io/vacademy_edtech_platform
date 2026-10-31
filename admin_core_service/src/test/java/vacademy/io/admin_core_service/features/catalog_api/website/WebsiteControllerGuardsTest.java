package vacademy.io.admin_core_service.features.catalog_api.website;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Institute routes use requireInstituteAdmin (no root bypass), like the API key routes;
 * super-admin routes use the SUPER_ADMIN_USER_IDS allowlist (unset in tests: everyone refused).
 */
class WebsiteControllerGuardsTest {

    private static final String INSTITUTE = "inst-1";

    private InstituteWebsiteService service;
    private InstituteWebsiteAdminController admin;
    private SuperAdminWebsiteController superAdmin;

    @BeforeEach
    void setUp() {
        service = mock(InstituteWebsiteService.class);
        admin = new InstituteWebsiteAdminController(service, new InstituteAccessValidator());
        superAdmin = new SuperAdminWebsiteController(service);
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

    private static InstituteWebsite row() {
        return InstituteWebsite.builder().id("w1").instituteId(INSTITUTE).host("x.com").status("PENDING")
                .verificationToken("ab".repeat(16)).createdAt(Instant.parse("2026-10-15T10:00:00Z")).build();
    }

    @Test
    void anInstituteAdminCanManageWebsites() {
        when(service.add(eq(INSTITUTE), eq("x.com"), any())).thenReturn(row());
        Map<String, Object> body = admin.add(INSTITUTE,
                new ObjectMapper().createObjectNode().put("host", "x.com"), user(false, "ADMIN")).getBody();
        assertEquals("x.com", body.get("host"));
        assertTrue(body.containsKey("dns_record"));
        assertFalse(body.containsKey("institute_id"));

        when(service.list(INSTITUTE)).thenReturn(List.of(row()));
        assertEquals(1, admin.list(INSTITUTE, user(false, "ADMIN")).getBody().size());
        when(service.verify(eq(INSTITUTE), eq("w1"), any())).thenReturn(row());
        assertEquals(HttpStatus.OK, admin.verify("w1", INSTITUTE, user(false, "ADMIN")).getStatusCode());
        assertEquals(HttpStatus.OK, admin.remove("w1", INSTITUTE, user(false, "ADMIN")).getStatusCode());
        verify(service).remove(eq(INSTITUTE), eq("w1"), any());
    }

    @Test
    void rootLearnersTeachersAndOtherInstitutesAreRefused() {
        var body = new ObjectMapper().createObjectNode().put("host", "x.com");
        assertThrows(ForbiddenException.class, () -> admin.add(INSTITUTE, body, user(true, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> admin.list(INSTITUTE, user(false, "TEACHER")));
        assertThrows(ForbiddenException.class, () -> admin.verify("w1", INSTITUTE, user(true, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> admin.remove("w1", INSTITUTE, user(false, "TEACHER")));
        clientIdHeader("inst-2"); // ADMIN of another institute
        assertThrows(ForbiddenException.class, () -> admin.add(INSTITUTE, body, user(false, "ADMIN")));
        assertThrows(ForbiddenException.class, () -> admin.remove("w1", INSTITUTE, user(false, "ADMIN")));
        verifyNoInteractions(service);
    }

    @Test
    void superAdminRoutesRefuseEveryoneWhenTheAllowlistDoesNotMatch() {
        CustomUserDetails rootAdmin = user(true, "ADMIN");
        assertForbidden(() -> superAdmin.list(rootAdmin, null));
        assertForbidden(() -> superAdmin.revoke(rootAdmin, "w1",
                new ObjectMapper().createObjectNode().put("reason", "x")));
        assertForbidden(() -> superAdmin.restore(rootAdmin, "w1"));
        verifyNoInteractions(service);
    }

    @Test
    void allowlistedStaffReachTheService() {
        try (MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class)) {
            InstituteWebsite r = row();
            r.setStatus("REVOKED");
            r.setRevokedReason("abuse");
            when(service.revoke(eq("w1"), eq("abuse"), any())).thenReturn(r);
            Map<String, Object> out = superAdmin.revoke(user(false), "w1",
                    new ObjectMapper().createObjectNode().put("reason", "abuse")).getBody();
            assertEquals("REVOKED", out.get("status"));
            assertEquals(INSTITUTE, out.get("institute_id"));
            when(service.listAll(null)).thenReturn(List.of(r));
            assertEquals(1, superAdmin.list(user(false), null).getBody().size());
        }
    }

    private static void assertForbidden(org.junit.jupiter.api.function.Executable call) {
        VacademyException ex = assertThrows(VacademyException.class, call);
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }
}
