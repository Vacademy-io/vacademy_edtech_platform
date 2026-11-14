package vacademy.io.admin_core_service.features.institute_api.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyRequest;
import vacademy.io.admin_core_service.features.institute_api.dto.ApiKeyVerifyResponse;
import vacademy.io.admin_core_service.features.institute_api.dto.BulkEnableApiAccessRequest;
import vacademy.io.admin_core_service.features.institute_api.dto.IssueApiKeyRequest;
import vacademy.io.admin_core_service.features.institute_api.entity.InstituteApiKey;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAccessService;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Guards on the three controllers: institute-admin key routes use requireInstituteAdmin
 * (no root bypass), super-admin routes use the SUPER_ADMIN_USER_IDS allowlist (unset in
 * tests, so everyone is refused unless the util is stubbed), and the verify route lives
 * under an exact /internal/ segment so InternalAuthFilter applies.
 */
class InstituteApiControllerGuardsTest {

    private static final String INSTITUTE = "inst-1";

    private InstituteApiKeyService keyService;
    private InstituteApiAccessService accessService;
    private InstituteApiKeyAdminController adminController;
    private SuperAdminApiAccessController superAdminController;
    private InstituteApiKeyInternalController internalController;

    @BeforeEach
    void setUp() {
        keyService = mock(InstituteApiKeyService.class);
        accessService = mock(InstituteApiAccessService.class);
        adminController = new InstituteApiKeyAdminController(keyService, new InstituteAccessValidator());
        superAdminController = new SuperAdminApiAccessController(accessService, keyService);
        internalController = new InstituteApiKeyInternalController(keyService);
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
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

    private static InstituteApiKeyService.IssuedKey issued() {
        InstituteApiKey k = InstituteApiKey.builder().id("k1").instituteId(INSTITUTE).name("ERP")
                .keyPrefix("vak_eval_0123456").keyHash("a".repeat(64))
                .products(new String[]{"evaluation"}).scopes(new String[]{"evaluation:read", "evaluation:write"})
                .status("ACTIVE").createdBy("u-1").createdVia("dashboard")
                .createdAt(Instant.parse("2026-10-01T10:00:00Z")).build();
        return new InstituteApiKeyService.IssuedKey(k, "vak_eval_" + "0".repeat(48));
    }

    // ── institute admin routes ───────────────────────────────────────────────

    @Test
    void adminOfInstituteCanIssueAndSeesKeyOnce() {
        IssueApiKeyRequest body = IssueApiKeyRequest.builder().name("ERP").build();
        when(keyService.issue(eq(INSTITUTE), eq(body), any(), eq("dashboard"))).thenReturn(issued());
        ResponseEntity<Map<String, Object>> res = adminController.issue(INSTITUTE, body, user(true, "ADMIN"));
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals("vak_eval_" + "0".repeat(48), res.getBody().get("key"));
        assertEquals("vak_eval_0123456", res.getBody().get("key_prefix"));
        assertEquals(List.of("evaluation:read", "evaluation:write"), res.getBody().get("scopes"));
        assertFalse(res.getBody().containsKey("key_hash"));
        assertEquals("no-store", res.getHeaders().getCacheControl());
    }

    @Test
    void instituteMayComeFromTheBody() {
        IssueApiKeyRequest body = IssueApiKeyRequest.builder().instituteId(INSTITUTE).name("ERP").build();
        when(keyService.issue(eq(INSTITUTE), eq(body), any(), eq("dashboard"))).thenReturn(issued());
        assertEquals(HttpStatus.OK, adminController.issue(null, body, user(false, "ADMIN")).getStatusCode());
    }

    @Test
    void queryAndBodyInstituteMismatchIs400() {
        IssueApiKeyRequest body = IssueApiKeyRequest.builder().instituteId("other").name("ERP").build();
        VacademyException ex = assertThrows(VacademyException.class,
                () -> adminController.issue(INSTITUTE, body, user(false, "ADMIN")));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
        verifyNoInteractions(keyService);
    }

    @Test
    void rootLearnerTeacherAndOtherInstituteAreRefused() {
        IssueApiKeyRequest body = IssueApiKeyRequest.builder().name("ERP").build();
        assertThrows(ForbiddenException.class, () -> adminController.issue(INSTITUTE, body, user(true, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> adminController.issue(INSTITUTE, body, user(false, "TEACHER")));
        assertThrows(ForbiddenException.class, () -> adminController.list(INSTITUTE, null, user(true, "STUDENT")));
        assertThrows(ForbiddenException.class, () -> adminController.revoke("k1", INSTITUTE, user(false, "TEACHER")));
        // ADMIN of another institute: clientId header names inst-2.
        clientIdHeader("inst-2");
        assertThrows(ForbiddenException.class, () -> adminController.issue(INSTITUTE, body, user(false, "ADMIN")));
        assertThrows(ForbiddenException.class, () -> adminController.list(INSTITUTE, null, user(false, "ADMIN")));
        verifyNoInteractions(keyService);
    }

    @Test
    void revokeMapsOutcomes() {
        when(keyService.revoke(eq(INSTITUTE), eq("k1"), any())).thenReturn(InstituteApiKeyService.RevokeOutcome.REVOKED);
        assertEquals(HttpStatus.OK, adminController.revoke("k1", INSTITUTE, user(false, "ADMIN")).getStatusCode());
        when(keyService.revoke(eq(INSTITUTE), eq("k2"), any())).thenReturn(InstituteApiKeyService.RevokeOutcome.NOT_FOUND);
        assertEquals(HttpStatus.NOT_FOUND, adminController.revoke("k2", INSTITUTE, user(false, "ADMIN")).getStatusCode());
        when(keyService.revoke(eq(INSTITUTE), eq("k3"), any()))
                .thenReturn(InstituteApiKeyService.RevokeOutcome.ALREADY_REVOKED);
        ResponseEntity<Map<String, Object>> res = adminController.revoke("k3", INSTITUTE, user(false, "ADMIN"));
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals(false, res.getBody().get("revoked"));
    }

    @Test
    void listNeverReturnsTheHash() {
        when(keyService.list(INSTITUTE, null)).thenReturn(List.of(issued().key()));
        List<Map<String, Object>> keys = adminController.list(INSTITUTE, null, user(false, "ADMIN")).getBody();
        assertEquals(1, keys.size());
        assertFalse(keys.get(0).toString().contains("a".repeat(64)));
        assertFalse(keys.get(0).containsKey("key"));
    }

    // ── super-admin routes ───────────────────────────────────────────────────

    @Test
    void superAdminRoutesRefuseEveryoneWhenAllowlistDoesNotMatch() {
        // SUPER_ADMIN_USER_IDS is not set for unit tests: requireSuperAdmin fails closed.
        CustomUserDetails rootAdmin = user(true, "ADMIN");
        assertForbidden(() -> superAdminController.getAccess(rootAdmin, INSTITUTE));
        assertForbidden(() -> superAdminController.updateAccess(rootAdmin, INSTITUTE, "evaluation",
                new ObjectMapper().createObjectNode().put("enabled", true).put("reason", "x")));
        assertForbidden(() -> superAdminController.bulkEnable(rootAdmin,
                new BulkEnableApiAccessRequest(List.of(INSTITUTE), "evaluation", "school", "x")));
        assertForbidden(() -> superAdminController.issueKey(rootAdmin, INSTITUTE,
                IssueApiKeyRequest.builder().name("x").build()));
        assertForbidden(() -> superAdminController.revokeKey(rootAdmin, INSTITUTE, "k1"));
        assertForbidden(() -> superAdminController.revokeAll(rootAdmin, INSTITUTE, null));
        verifyNoInteractions(accessService, keyService);
    }

    private static void assertForbidden(org.junit.jupiter.api.function.Executable call) {
        VacademyException ex = assertThrows(VacademyException.class, call);
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void allowlistedStaffReachTheServices() {
        CustomUserDetails staff = user(false);
        try (MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class)) {
            when(accessService.overview(INSTITUTE)).thenReturn(Map.of("products", List.of()));
            assertEquals(HttpStatus.OK, superAdminController.getAccess(staff, INSTITUTE).getStatusCode());

            when(keyService.issue(eq(INSTITUTE), any(), eq(staff), eq("super_admin"))).thenReturn(issued());
            ResponseEntity<Map<String, Object>> issuedRes = superAdminController.issueKey(staff, INSTITUTE,
                    IssueApiKeyRequest.builder().name("Vendor").build());
            assertTrue(issuedRes.getBody().containsKey("key"));
            assertEquals("no-store", issuedRes.getHeaders().getCacheControl());

            when(keyService.revokeAll(INSTITUTE, staff, "leak")).thenReturn(3);
            ResponseEntity<Map<String, Object>> all = superAdminController.revokeAll(staff, INSTITUTE,
                    new ObjectMapper().createObjectNode().put("reason", "leak"));
            assertEquals(3, all.getBody().get("revoked_count"));

            util.verify(() -> SuperAdminAuthUtil.requireSuperAdmin(staff), org.mockito.Mockito.times(3));
        }
    }

    @Test
    void superAdminIssueRejectsBodyInstituteMismatch() {
        try (MockedStatic<SuperAdminAuthUtil> ignored = mockStatic(SuperAdminAuthUtil.class)) {
            VacademyException ex = assertThrows(VacademyException.class, () -> superAdminController.issueKey(
                    user(false), INSTITUTE, IssueApiKeyRequest.builder().instituteId("other").name("x").build()));
            assertEquals(HttpStatus.BAD_REQUEST, ex.getStatus());
            verifyNoInteractions(keyService);
        }
    }

    // ── internal verify ──────────────────────────────────────────────────────

    @Test
    void verifyRouteIsUnderAnInternalSegment() {
        String base = InstituteApiKeyInternalController.class.getAnnotation(RequestMapping.class).value()[0];
        assertEquals("/admin-core-service/internal/api-keys/v1", base);
        assertTrue(List.of(base.split("/")).contains("internal"));
    }

    @Test
    void verifyReturns200Or404() {
        String hash = "b".repeat(64);
        ApiKeyVerifyResponse body = new ApiKeyVerifyResponse("k1", INSTITUTE, "ERP", List.of("evaluation"),
                List.of("evaluation:read"), "ACTIVE", null, null, null, "standard", 2000, 5000, 200,
                null, null, BigDecimal.ZERO, false, true);
        when(keyService.verify(hash, "1.2.3.4")).thenReturn(Optional.of(body));
        ResponseEntity<?> ok = internalController.verify(new ApiKeyVerifyRequest(hash, "1.2.3.4"));
        assertEquals(HttpStatus.OK, ok.getStatusCode());
        assertSame(body, ok.getBody());

        when(keyService.verify("c".repeat(64), null)).thenReturn(Optional.empty());
        assertEquals(HttpStatus.NOT_FOUND,
                internalController.verify(new ApiKeyVerifyRequest("c".repeat(64), null)).getStatusCode());
        verify(keyService).verify("c".repeat(64), null);
    }
}
