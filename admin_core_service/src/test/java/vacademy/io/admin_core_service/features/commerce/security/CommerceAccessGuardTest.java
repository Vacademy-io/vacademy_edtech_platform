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
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
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
    private CapabilityResolver resolver;
    private CommerceAccessGuard guard;

    @BeforeEach
    void setUp() {
        policies = mock(InstituteModulePolicyRepository.class);
        entitlements = mock(InstituteModuleEntitlementRepository.class);
        staffLocations = mock(CommerceStaffLocationRepository.class);
        resolver = new CapabilityResolver(new CapabilityCatalogRegistry(), policies, entitlements);
        guard = new CommerceAccessGuard(resolver, staffLocations);
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
    void g3_aPosOnlyShopsManagerReadsLocationsAndBillBooksThroughThePosFeature() {
        // Stock and orders off, the billing counter on.
        grantCommerce(INSTITUTE, row(INSTITUTE, "commerce.stock", false), row(INSTITUTE, "commerce.orders", false));
        CustomUserDetails manager = principal(false, "COMMERCE_STORE_MANAGER");
        assertDoesNotThrow(() -> guard.requireEither(manager, INSTITUTE, CommerceFeature.INVENTORY, TILL,
                CommerceFeature.POS, MANAGER));
        assertDoesNotThrow(() -> guard.requireEither(manager, INSTITUTE, CommerceFeature.ORDERS,
                Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT), CommerceFeature.POS, MANAGER));
        // A cashier is not let in by the POS side (manager or ADMIN only); the first refusal is answered.
        CustomUserDetails cashier = principal(false, "COMMERCE_POS_CASHIER");
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.requireEither(cashier, INSTITUTE, CommerceFeature.ORDERS, MANAGER, CommerceFeature.POS,
                        MANAGER));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, refused.getCode());
        // A feature that is off on both sides stays refused.
        assertThrows(CommerceAccessDeniedException.class, () -> guard.requireEither(manager, INSTITUTE,
                CommerceFeature.INVENTORY, TILL, CommerceFeature.ORDERS, MANAGER));
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
    // ── Work no person starts: on, off, or not readable ──────────────────────

    @Test
    void featureStateTellsOnOffAndUnknownApart() {
        assertEquals(CommerceAccessGuard.FeatureState.ON, guard.featureState(INSTITUTE, CommerceFeature.ORDERS));
        assertTrue(guard.featureOn(INSTITUTE, CommerceFeature.ORDERS));
        when(entitlements.findByInstituteIdOrderByKeyAsc(OTHER_INSTITUTE)).thenReturn(List.of());
        assertEquals(CommerceAccessGuard.FeatureState.OFF, guard.featureState(OTHER_INSTITUTE,
                CommerceFeature.ORDERS));
        assertFalse(guard.featureOn(OTHER_INSTITUTE, CommerceFeature.ORDERS));
        assertEquals(CommerceAccessGuard.FeatureState.OFF, guard.featureState(INSTITUTE, null));

        CapabilityResolver failing = mock(CapabilityResolver.class);
        when(failing.isFeatureGranted(any(), any())).thenThrow(new IllegalStateException("db down"));
        CommerceAccessGuard broken = new CommerceAccessGuard(failing, staffLocations);
        assertEquals(CommerceAccessGuard.FeatureState.UNKNOWN, broken.featureState(INSTITUTE, CommerceFeature.ORDERS));
        assertFalse(broken.featureOn(INSTITUTE, CommerceFeature.ORDERS));
    }

    // ── Institute-wide staff (accounts) ──────────────────────────────────────

    private static final Set<CommerceRole> ACCOUNTS_STAFF = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    /** The guard with scope rows: {@code wideUserIds} have {@code all_locations = true}. */
    private CommerceStaffScopeRepository withScopeRows(boolean wide) {
        CommerceStaffScopeRepository scopes = mock(CommerceStaffScopeRepository.class);
        when(scopes.existsByInstituteIdAndUserIdAndAllLocationsTrue(INSTITUTE, "u-1")).thenReturn(wide);
        guard.setStaffScopeRepository(scopes);
        return scopes;
    }

    private void grantAccounts() {
        grantCommerce(INSTITUTE, row(INSTITUTE, "commerce.accounts", true));
        resolver.evict(INSTITUTE);
    }

    private String wideRefusal(CustomUserDetails user) {
        return assertThrows(CommerceAccessDeniedException.class,
                () -> guard.requireInstituteWide(user, INSTITUTE, CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF)).getCode();
    }

    @Test
    void requireInstituteWideMatrix() {
        grantAccounts();
        withScopeRows(true);
        // ADMIN: always institute-wide.
        assertDoesNotThrow(() -> guard.requireInstituteWide(principal(false, "ADMIN"), INSTITUTE,
                CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF));
        // Manager or accountant with a scope row.
        assertDoesNotThrow(() -> guard.requireInstituteWide(principal(false, "COMMERCE_ACCOUNTANT"), INSTITUTE,
                CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF));
        assertDoesNotThrow(() -> guard.requireInstituteWide(principal(false, "COMMERCE_STORE_MANAGER"), INSTITUTE,
                CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF));
        // Warehouse and counter staff: the role test refuses them first, scope row or not.
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, wideRefusal(principal(false, "COMMERCE_WAREHOUSE_STAFF")));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, wideRefusal(principal(false, "COMMERCE_POS_CASHIER")));
        // A scope row on a warehouse role widens nothing even where the role set allows that role.
        assertFalse(guard.isInstituteWide(principal(false, "COMMERCE_WAREHOUSE_STAFF"), INSTITUTE));
        assertFalse(guard.isInstituteWide(principal(false, "COMMERCE_POS_CASHIER"), INSTITUTE));

        // Without the scope row: the right role is not enough.
        withScopeRows(false);
        assertEquals(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED, wideRefusal(principal(false, "COMMERCE_ACCOUNTANT")));
        assertEquals(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED,
                wideRefusal(principal(false, "COMMERCE_STORE_MANAGER")));
        assertTrue(assertThrows(CommerceAccessDeniedException.class, () -> guard.requireInstituteWide(
                principal(false, "COMMERCE_ACCOUNTANT"), INSTITUTE, CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF))
                .getMessage().startsWith("INSTITUTE_WIDE_REQUIRED: "));
    }

    @Test
    void withoutAScopeRepositoryOnlyTheAdminIsInstituteWide() {
        grantAccounts();
        // The guard of setUp is built by hand with no scope repository.
        assertTrue(guard.isInstituteWide(principal(false, "ADMIN"), INSTITUTE));
        assertFalse(guard.isInstituteWide(principal(false, "COMMERCE_ACCOUNTANT"), INSTITUTE));
        assertEquals(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED, wideRefusal(principal(false, "COMMERCE_STORE_MANAGER")));
        assertFalse(guard.isInstituteWide(null, INSTITUTE));
    }

    @Test
    void instituteWideRefusalsComeInOrder() {
        CommerceStaffScopeRepository scopes = withScopeRows(true);
        // Not a member: ACCESS_DENIED before anything else is read.
        clientIdHeader(OTHER_INSTITUTE);
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED, wideRefusal(principal(false, "COMMERCE_ACCOUNTANT")));
        clientIdHeader(INSTITUTE);
        // Accounts off (the module row alone does not turn it on): FEATURE_DISABLED, even for the ADMIN.
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, wideRefusal(principal(false, "ADMIN")));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, wideRefusal(principal(false, "COMMERCE_ACCOUNTANT")));
        grantAccounts();
        // Wrong role: ROLE_NOT_ALLOWED before the scope.
        CommerceAccessDeniedException role = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.requireInstituteWide(principal(false, "COMMERCE_ACCOUNTANT"), INSTITUTE,
                        CommerceFeature.ACCOUNTS, Set.of(CommerceRole.STORE_MANAGER)));
        assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, role.getCode());
        verify(scopes, never()).existsByInstituteIdAndUserIdAndAllLocationsTrue(any(), any());
        // Right role, one location: INSTITUTE_WIDE_REQUIRED last.
        when(scopes.existsByInstituteIdAndUserIdAndAllLocationsTrue(INSTITUTE, "u-1")).thenReturn(false);
        assertEquals(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED, wideRefusal(principal(false, "COMMERCE_ACCOUNTANT")));
    }

    @Test
    void accountsLocationBypassOnlyForWideStaffAndOnlyAccounts() {
        grantAccounts();
        withScopeRows(true);
        CustomUserDetails accountant = principal(false, "COMMERCE_ACCOUNTANT");
        // Accounts + institute-wide: no staff-location row needed.
        assertDoesNotThrow(() -> guard.require(accountant, INSTITUTE, CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF, "loc-9"));
        verify(staffLocations, never()).existsByInstituteIdAndUserIdAndLocationId(any(), any(), any());
        // Any other feature: the per-location rule as before, scope row or not.
        CustomUserDetails manager = principal(false, "COMMERCE_STORE_MANAGER");
        for (CommerceFeature feature : new CommerceFeature[]{CommerceFeature.INVENTORY, CommerceFeature.POS,
                CommerceFeature.ORDERS}) {
            CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                    () -> guard.require(manager, INSTITUTE, feature, MANAGER, "loc-9"));
            assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, ex.getCode());
        }
        // Accounts without the scope row: the per-location rule applies.
        withScopeRows(false);
        CommerceAccessDeniedException limited = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(accountant, INSTITUTE, CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF, "loc-9"));
        assertEquals(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED, limited.getCode());
        when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INSTITUTE, "u-1", "loc-1")).thenReturn(true);
        assertDoesNotThrow(() -> guard.require(accountant, INSTITUTE, CommerceFeature.ACCOUNTS, ACCOUNTS_STAFF, "loc-1"));
    }

    @Test
    void accountsIsOffWithTheModuleRowAloneAndOnWithItsFeatureRow() {
        CustomUserDetails admin = principal(false, "ADMIN");
        CommerceAccessDeniedException off = assertThrows(CommerceAccessDeniedException.class,
                () -> guard.require(admin, INSTITUTE, CommerceFeature.ACCOUNTS, Set.of()));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, off.getCode());
        // The other five stay on with the module row alone.
        for (CommerceFeature feature : CommerceFeature.values()) {
            if (feature != CommerceFeature.ACCOUNTS) {
                assertDoesNotThrow(() -> guard.require(admin, INSTITUTE, feature, Set.of()));
            }
        }
        grantAccounts();
        assertDoesNotThrow(() -> guard.require(admin, INSTITUTE, CommerceFeature.ACCOUNTS, Set.of()));
        assertEquals("commerce.accounts", CommerceFeature.ACCOUNTS.key());
    }
}
