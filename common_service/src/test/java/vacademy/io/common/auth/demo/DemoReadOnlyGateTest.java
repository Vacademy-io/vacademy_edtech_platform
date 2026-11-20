package vacademy.io.common.auth.demo;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.UserRoleService;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DemoReadOnlyGateTest {

    private static final String LEADS = "/admin-core-service/v1/audience/leads";
    private static final String ADD_LEAD = "/admin-core-service/v1/audience/lead";

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUsername("demo@example.com");
        dto.setUserId("u-demo");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static Map<String, Object> claim(String instituteId, String... roles) {
        return Map.of(instituteId, Map.of("roles", List.of(roles), "permissions", List.of()));
    }

    private static UserRole userRole(User user, String roleName, String instituteId, String status) {
        Role role = new Role();
        role.setName(roleName);
        UserRole userRole = new UserRole();
        userRole.setUser(user);
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setStatus(status);
        return userRole;
    }

    // ── who is the demo user ──

    @Test
    void roleInTheLoadedAuthoritiesIsTheDemoUser() {
        assertTrue(DemoReadOnlyGate.holdsRole(user(false, "ADMIN", "DEMO_READ_ONLY"), null));
    }

    @Test
    void roleInTheTokenClaimIsTheDemoUserEvenWithNoAuthoritiesLoaded() {
        // clientId header left out or naming another institute: the lookup returns no roles.
        assertTrue(DemoReadOnlyGate.holdsRole(user(false), claim("inst-demo", "ADMIN", "DEMO_READ_ONLY")));
        assertTrue(DemoReadOnlyGate.holdsRole(null, claim("inst-demo", "demo-read-only")));
    }

    @Test
    void usersWithoutTheRoleAreNotTheDemoUser() {
        assertFalse(DemoReadOnlyGate.holdsRole(user(false, "ADMIN", "TEACHER"), claim("inst-1", "ADMIN")));
        assertFalse(DemoReadOnlyGate.holdsRole(user(true, "ADMIN"), null));
        assertFalse(DemoReadOnlyGate.holdsRole(null, null));
        assertFalse(DemoReadOnlyGate.holdsRole(user(false), "DEMO_READ_ONLY"));
        assertFalse(DemoReadOnlyGate.holdsRole(user(false, "DEMO_READ_ONLY_EXTRA"), claim("i", "NOT_DEMO_READ_ONLY")));
    }

    @Test
    void rootUserWithTheRoleIsStillTheDemoUser() {
        assertTrue(DemoReadOnlyGate.holdsRole(user(true, "ADMIN", "DEMO_READ_ONLY"), null));
        assertTrue(DemoReadOnlyGate.holdsRole(user(true), claim("inst-demo", "DEMO_READ_ONLY")));
    }

    @Test
    void adminAndDemoRoleOnOneInstituteBothReachTheTokenAndTheLoadedUser() {
        User account = new User();
        account.setId("u-demo");
        account.setUsername("demo@example.com");
        List<UserRole> roles = List.of(
                userRole(account, "ADMIN", "inst-demo", "ACTIVE"),
                userRole(account, "DEMO_READ_ONLY", "inst-demo", "ACTIVE"));

        Map<String, Object> minted = UserRoleService.createInstituteRoleMap(roles);
        assertTrue(DemoReadOnlyGate.holdsRole(null, minted));

        // Through a real signed token, as the filter reads it.
        JwtService jwt = new JwtService();
        String token = jwt.generateToken(account, roles, List.of());
        Object fromToken = jwt.extractClaim(token, claims -> claims.get("authorities"));
        assertTrue(DemoReadOnlyGate.holdsRole(null, fromToken));

        // auth_service builds the user for the request's institute the same way.
        CustomUserDetails loaded = new CustomUserDetails(account, "inst-demo", roles);
        assertTrue(loaded.getAuthorities().stream().anyMatch(a -> "ADMIN".equals(a.getAuthority())));
        assertTrue(DemoReadOnlyGate.holdsRole(loaded, null));

        // Another institute in the header: nothing loaded, the token still says so.
        CustomUserDetails elsewhere = new CustomUserDetails(account, "inst-other", roles);
        assertFalse(DemoReadOnlyGate.holdsRole(elsewhere, null));
        assertTrue(DemoReadOnlyGate.holdsRole(elsewhere, fromToken));
    }

    @Test
    void revokedDemoRoleIsNotInTheToken() {
        User account = new User();
        account.setId("u-1");
        account.setUsername("someone@example.com");
        Map<String, Object> minted = UserRoleService.createInstituteRoleMap(
                List.of(userRole(account, "DEMO_READ_ONLY", "inst-demo", "DELETED")));
        assertFalse(DemoReadOnlyGate.holdsRole(null, minted));
    }

    // ── what the demo user may do ──

    @Test
    void readsPass() {
        assertFalse(DemoReadOnlyGate.refuses("GET", "/admin-core-service/institute/v1/details/inst-demo", null));
        assertFalse(DemoReadOnlyGate.refuses("HEAD", "/admin-core-service/institute/v1/details/inst-demo", null));
        assertFalse(DemoReadOnlyGate.refuses("OPTIONS", ADD_LEAD, null));
        assertFalse(DemoReadOnlyGate.refuses("get", LEADS, "page=1"));
    }

    @Test
    void writesAreRefusedByDefault() {
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE", "TRACE", "CONNECT", "PROPFIND", "")) {
            assertTrue(DemoReadOnlyGate.refuses(method, ADD_LEAD, null), method);
        }
        assertTrue(DemoReadOnlyGate.refuses(null, ADD_LEAD, null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/auth-service/v1/user-operation/update-password", null));
        assertTrue(DemoReadOnlyGate.refuses("PUT", "/auth-service/v1/user-details/update-user", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/auth-service/v1/user-roles/add-user-roles", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service/v1/telephony/calls/connect", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/media-service/get-signed-url", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/unknown", null));
    }

    @Test
    void allowListedReadsPassOnlyWithTheirOwnMethodAndExactPath() {
        assertFalse(DemoReadOnlyGate.refuses("POST", LEADS, "pageNo=0&pageSize=10"));
        assertFalse(DemoReadOnlyGate.refuses("post", LEADS, null));
        assertFalse(DemoReadOnlyGate.refuses("POST", "/auth-service/v1/refresh-token", null));
        assertFalse(DemoReadOnlyGate.refuses("POST",
                "/admin-core-service/tag-management/institutes/inst-demo/tags/user-counts", null));

        assertTrue(DemoReadOnlyGate.refuses("PUT", LEADS, null));
        assertTrue(DemoReadOnlyGate.refuses("DELETE", LEADS, null));
        assertTrue(DemoReadOnlyGate.refuses("POST", LEADS + "/", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", LEADS + "/extra", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/x" + LEADS, null));
        assertTrue(DemoReadOnlyGate.refuses("POST", LEADS.toUpperCase(), null));
        assertTrue(DemoReadOnlyGate.refuses("POST",
                "/admin-core-service/tag-management/institutes//tags/user-counts", null));
        assertTrue(DemoReadOnlyGate.refuses("POST",
                "/admin-core-service/tag-management/institutes/a/b/tags/user-counts", null));
    }

    @Test
    void anAllowListedPathCannotBeDressedUp() {
        assertTrue(DemoReadOnlyGate.refuses("POST", LEADS + ";x=1", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service/v1/audience/lead%73", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service/v1/audience/../audience/leads", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service/v1//audience/leads", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service\\v1/audience/leads", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "admin-core-service/v1/audience/leads", null));
        assertTrue(DemoReadOnlyGate.refuses("POST",
                "/admin-core-service/tag-management/institutes/..;/tags/user-counts", null));
    }

    @Test
    void credentialReturningListsAreNotOnTheAllowList() {
        assertTrue(DemoReadOnlyGate.refuses("POST", "/admin-core-service/institute/institute_learner/get/v2/all", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/auth-service/v1/user/users-credential", null));
        assertTrue(DemoReadOnlyGate.refuses("POST", "/auth-service/v1/user-roles/users-of-status", null));
        assertTrue(DemoReadOnlyGate.refuses("POST",
                "/admin-core-service/institute/institute_learner/get/v1/basic-details-csv", null));
    }

    @Test
    void getsThatWriteSendSpendOrMintAreRefused() {
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin/learner-portal/v1/access", "userId=u"));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin/learner-portal/v1/send-cred", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/auth-service/v1/user/user-credentials/u-9", null));
        assertTrue(DemoReadOnlyGate.refuses("HEAD", "/auth-service/v1/user/user-credentials/u-9", null));
        assertTrue(DemoReadOnlyGate.refuses("GET",
                "/assessment-service/assessment/export/pdf/ai-student-report", "generate=false"));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/live-sessions/provider/meeting/join", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/payments/user-plan/PHONEPE/status/o-1", null));
        assertTrue(DemoReadOnlyGate.refuses("GET",
                "/community-service/super-admin/v1/app-registry/providers/ios/app-1/sync", null));
        // Its neighbours stay readable.
        assertFalse(DemoReadOnlyGate.refuses("GET", "/auth-service/v1/user/autosuggest-users", null));
        assertFalse(DemoReadOnlyGate.refuses("GET", "/admin-core-service/live-sessions/provider/meeting", null));
    }

    @Test
    void aBlockedGetCannotBeDressedUp() {
        String access = "/admin-core-service/admin/learner-portal/v1/access";
        assertTrue(DemoReadOnlyGate.refuses("GET", access + "/", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", access + ";v=1", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin//learner-portal/v1/access", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin/learner-portal/v1/acces%73", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin;a=b/learner-portal/v1/access", null));
        // Anything that cannot be read as a path is refused rather than waved through.
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/admin/x/../learner-portal/v1/access", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/%zz", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/%2561", null));
        assertTrue(DemoReadOnlyGate.refuses("GET", null, null));
    }

    @Test
    void flagDependentGetsAreRefusedOnlyWithTheFlag() {
        String attempt = "/assessment-service/assessment/manual-evaluation/get/attempt-data";
        assertFalse(DemoReadOnlyGate.refuses("GET", attempt, "attemptId=a-1"));
        assertFalse(DemoReadOnlyGate.refuses("GET", attempt, null));
        assertTrue(DemoReadOnlyGate.refuses("GET", attempt, "attemptId=a-1&markEvaluating=true"));
        assertTrue(DemoReadOnlyGate.refuses("GET", attempt, "MARKEVALUATING=TRUE"));
        assertTrue(DemoReadOnlyGate.refuses("GET", attempt, "mark%45valuating=true"));
        assertTrue(DemoReadOnlyGate.refuses("GET", attempt, "x=%zz"));

        assertFalse(DemoReadOnlyGate.refuses("GET", "/admin-core-service/commerce/v1/reports/sales", "from=2026-01-01"));
        assertTrue(DemoReadOnlyGate.refuses("GET", "/admin-core-service/commerce/v1/reports/sales", "format=csv"));
    }

    @Test
    void listSizesMatchTheDocument() {
        // docs/demo-stage/READ_ALLOWLIST.md states these numbers; change both together.
        assertEquals(93, DemoReadOnlyAllowList.readCount());
        assertEquals(40, DemoReadOnlyAllowList.blockedGetCount());
    }
}
