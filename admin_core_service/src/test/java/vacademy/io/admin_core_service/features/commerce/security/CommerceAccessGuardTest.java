package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The commerce access guard: a shopper, a learner, a root user and another institute's admin
 * are refused; an admin and a role-holder pass; an institute without the commerce grant is
 * refused even in LEGACY mode; a location that is not the caller's is refused.
 * The entitlement side is the real resolver over the shipped catalogue, with mocked tables.
 */
class CommerceAccessGuardTest {

    private static final String INSTITUTE = "inst-1";
    private static final String OTHER_INSTITUTE = "inst-2";
    private static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);
    private static final Set<CommerceRole> TILL = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.POS_CASHIER);

    private InstituteModulePolicyRepository policies;
    private InstituteModuleEntitlementRepository entitlements;
    private CommerceStaffLocationRepository staffLocations;
    private CommerceAccessGuard guard;

    @BeforeEach
    void setUp() {
        policies = mock(InstituteModulePolicyRepository.class);
        entitlements = mock(InstituteModuleEntitlementRepository.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        guard = new CommerceAccessGuard(
                new CapabilityResolver(new CapabilityCatalogRegistry(), policies, entitlements), staffLocations);
        // Default: a LEGACY institute (no policy row) that HAS the commerce module row.
        when(policies.findById(any())).thenReturn(Optional.empty());
        grantCommerce(INSTITUTE);
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void grantCommerce(String instituteId, InstituteModuleEntitlement... extraRows) {
        List<InstituteModuleEntitlement> rows = new java.util.ArrayList<>();
        rows.add(row(instituteId, "commerce", true));
        rows.addAll(List.of(extraRows));
        when(entitlements.findByInstituteIdOrderByKeyAsc(instituteId)).thenReturn(rows);
    }

    private static InstituteModuleEntitlement row(String instituteId, String key, boolean enabled) {
        return InstituteModuleEntitlement.builder().instituteId(instituteId).key(key).enabled(enabled)
                .updatedAt(Instant.parse("2026-11-12T00:00:00Z")).build();
    }

    private static void clientIdHeader(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (instituteId != null) {
            request.addHeader("clientId", instituteId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails principal(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private String refusal(CustomUserDetails user, String instituteId, Set<CommerceRole> roles) {
        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(user, instituteId, CommerceFeature.CATALOGUE, roles));
        return ex.getCode();
    }

    // ── Refused ──────────────────────────────────────────────────────────────

    @Test
    void shopperWithNoRoleInTheInstituteIsRefused() {
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, refusal(principal(false), INSTITUTE, MANAGER));
    }

    @Test
    void learnerIsRefused() {
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(false, "STUDENT"), INSTITUTE, MANAGER));
        // A learner who may create courses carries TEACHER too; still no commerce role.
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(false, "STUDENT", "TEACHER"), INSTITUTE, TILL));
    }

    @Test
    void rootUserGetsNoBypass() {
        // Root with no authorities: the root flag opens nothing here.
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, refusal(principal(true), INSTITUTE, MANAGER));
        // The root flag with a learner role only.
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(true, "STUDENT"), INSTITUTE, MANAGER));
        // Root with no clientId header at all.
        clientIdHeader(null);
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(principal(true, "ADMIN"), INSTITUTE, MANAGER));
    }

    @Test
    void anotherInstitutesAdminIsRefused() {
        // The token was minted for inst-2 (clientId header), the request names inst-1.
        clientIdHeader(OTHER_INSTITUTE);
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(principal(false, "ADMIN"), INSTITUTE, MANAGER));
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(principal(true, "ADMIN", "COMMERCE_STORE_MANAGER"), INSTITUTE, MANAGER));
    }

    @Test
    void outsiderLearnsNothingAboutTheInstitutesFeatures() {
        // Membership is tested before the feature, so a stranger never sees FEATURE_DISABLED.
        clientIdHeader(OTHER_INSTITUTE);
        refusal(principal(false, "ADMIN"), INSTITUTE, MANAGER);
        verify(entitlements, never()).findByInstituteIdOrderByKeyAsc(INSTITUTE);
    }

    @Test
    void missingUserOrInstituteIsRefused() {
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, refusal(null, INSTITUTE, MANAGER));
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(principal(false, "ADMIN"), null, MANAGER));
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(principal(false, "ADMIN"), " ", MANAGER));
    }

    @Test
    void aCommerceRoleThatIsNotAllowedForTheActionIsRefused() {
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(false, "COMMERCE_POS_CASHIER"), INSTITUTE, MANAGER));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE, Set.of()));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                refusal(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE, null));
    }

    @Test
    void refusalsAreForbiddenExceptionsSoTheSharedHandlerAnswers403() {
        ForbiddenException ex = assertThrows(ForbiddenException.class,
                () -> guard.require(principal(false, "STUDENT"), INSTITUTE, CommerceFeature.CATALOGUE, MANAGER));
        assertTrue(ex.getMessage().startsWith("ROLE_NOT_ALLOWED: "));
    }

    // ── Allowed ──────────────────────────────────────────────────────────────

    @Test
    void instituteAdminPassesEveryRoleTest() {
        assertDoesNotThrow(() -> guard.require(principal(false, "ADMIN"), INSTITUTE,
                CommerceFeature.CATALOGUE, MANAGER));
        assertDoesNotThrow(() -> guard.require(principal(false, "admin"), INSTITUTE,
                CommerceFeature.POS, Set.of()));
    }

    @Test
    void roleHolderPasses() {
        assertDoesNotThrow(() -> guard.require(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE,
                CommerceFeature.CATALOGUE, MANAGER));
        assertDoesNotThrow(() -> guard.require(principal(false, "COMMERCE_POS_CASHIER"), INSTITUTE,
                CommerceFeature.POS, TILL));
        // The root flag neither helps nor hurts a real role-holder.
        assertDoesNotThrow(() -> guard.require(principal(true, "COMMERCE_POS_CASHIER"), INSTITUTE,
                CommerceFeature.POS, TILL));
    }

    // ── Feature ──────────────────────────────────────────────────────────────

    @Test
    void legacyInstituteWithoutTheGrantIsRefused() {
        // LEGACY mode switches every other module on; commerce stays off without its row.
        when(entitlements.findByInstituteIdOrderByKeyAsc(INSTITUTE)).thenReturn(List.of());
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(principal(false, "ADMIN"), INSTITUTE, MANAGER));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE, MANAGER));
    }

    @Test
    void managedInstituteWithoutTheGrantIsRefused() {
        when(policies.findById(INSTITUTE)).thenReturn(Optional.of(InstituteModulePolicy.builder()
                .instituteId(INSTITUTE).mode(InstituteModulePolicy.MODE_MANAGED).build()));
        when(entitlements.findByInstituteIdOrderByKeyAsc(INSTITUTE))
                .thenReturn(List.of(row(INSTITUTE, "commerce", false)));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(principal(false, "ADMIN"), INSTITUTE, MANAGER));
    }

    @Test
    void oneFeatureSwitchedOffIsRefusedWhileTheOthersPass() {
        grantCommerce(INSTITUTE, row(INSTITUTE, "commerce.pos", false));
        CustomUserDetails admin = principal(false, "ADMIN");
        assertDoesNotThrow(() -> guard.require(admin, INSTITUTE, CommerceFeature.CATALOGUE, MANAGER));
        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(admin, INSTITUTE, CommerceFeature.POS, MANAGER));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, ex.getCode());
    }

    @Test
    void requireFeatureForPublicEndpoints() {
        RequestContextHolder.resetRequestAttributes();
        assertDoesNotThrow(() -> guard.requireFeature(INSTITUTE, CommerceFeature.CATALOGUE));
        when(entitlements.findByInstituteIdOrderByKeyAsc(OTHER_INSTITUTE)).thenReturn(List.of());
        for (String instituteId : new String[]{OTHER_INSTITUTE, null, ""}) {
            CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                    () -> guard.requireFeature(instituteId, CommerceFeature.CATALOGUE));
            assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, ex.getCode());
        }
    }

    // ── Location ─────────────────────────────────────────────────────────────

    @Test
    void locationMismatchIsRefused() {
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INSTITUTE, "u-1", "loc-1")).thenReturn(true);
        CustomUserDetails cashier = principal(false, "COMMERCE_POS_CASHIER");
        assertDoesNotThrow(() -> guard.require(cashier, INSTITUTE, CommerceFeature.POS, TILL, "loc-1"));
        for (String locationId : new String[]{"loc-2", null, " "}) {
            CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                    () -> guard.require(cashier, INSTITUTE, CommerceFeature.POS, TILL, locationId));
            assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, ex.getCode());
        }
    }

    @Test
    void storeManagerIsAlsoHeldToAssignedLocations() {
        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE,
                        CommerceFeature.INVENTORY, MANAGER, "loc-9"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, ex.getCode());
    }

    @Test
    void instituteAdminActsAtEveryLocation() {
        assertDoesNotThrow(() -> guard.require(principal(false, "ADMIN"), INSTITUTE,
                CommerceFeature.INVENTORY, MANAGER, "loc-9"));
        verify(staffLocations, never()).existsByInstituteIdAndUserIdAndLocationId(any(), any(), any());
    }

    @Test
    void locationIsNotLookedUpForACallerWhoFailsTheRoleTest() {
        assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(principal(false, "STUDENT"), INSTITUTE, CommerceFeature.POS, TILL, "loc-1"));
        verify(staffLocations, never()).existsByInstituteIdAndUserIdAndLocationId(any(), any(), any());
    }

    // ── Helpers used by the capability /me read ──────────────────────────────

    @Test
    void holdsCommerceRoleNeedsMembershipAndARole() {
        assertTrue(CommerceAccessGuard.holdsCommerceRole(principal(false, "COMMERCE_ACCOUNTANT"), INSTITUTE));
        assertFalse(CommerceAccessGuard.holdsCommerceRole(principal(false, "ADMIN"), INSTITUTE));
        assertFalse(CommerceAccessGuard.holdsCommerceRole(principal(true), INSTITUTE));
        assertFalse(CommerceAccessGuard.holdsCommerceRole(principal(false, "COMMERCE_ACCOUNTANT"), OTHER_INSTITUTE));
        assertEquals(Set.of(CommerceRole.ACCOUNTANT, CommerceRole.POS_CASHIER),
                CommerceAccessGuard.rolesOf(principal(false, "commerce_accountant", "COMMERCE_POS_CASHIER", "X")));
    }

    @Test
    void roleAndFeatureNamesMatchTheContract() {
        assertEquals("COMMERCE_STORE_MANAGER", CommerceRole.STORE_MANAGER.authority());
        assertEquals("COMMERCE_WAREHOUSE_STAFF", CommerceRole.WAREHOUSE_STAFF.authority());
        assertEquals("COMMERCE_POS_CASHIER", CommerceRole.POS_CASHIER.authority());
        assertEquals("COMMERCE_ACCOUNTANT", CommerceRole.ACCOUNTANT.authority());
        CapabilityCatalogRegistry registry = new CapabilityCatalogRegistry();
        for (CommerceFeature feature : CommerceFeature.values()) {
            assertTrue(registry.isFeature(feature.key()), feature.key() + " is not in catalog.json");
        }
    }
}
