package vacademy.io.admin_core_service.features.capabilities.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalog;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistryTest;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Resolver truth table (spec §5, §13): LEGACY, MANAGED, core, default_on, expiry, multi-feature. */
class CapabilityResolverTest {

    private static final Instant NOW = Instant.parse("2026-10-13T10:00:00Z");
    private static final CapabilityCatalog CATALOG = CapabilityCatalogRegistryTest.fixture();

    private static InstituteModuleEntitlement row(String key, boolean enabled, Instant expiresAt) {
        return InstituteModuleEntitlement.builder().instituteId("i1").key(key).enabled(enabled)
                .expiresAt(expiresAt).updatedAt(NOW).build();
    }

    private static CapabilityResolver.Resolved resolve(InstituteModuleEntitlement... rows) {
        return CapabilityResolver.resolve(CATALOG, List.of(rows), NOW);
    }

    @Test
    void managedWithNoRowsOnlyCoreIsOn() {
        CapabilityResolver.Resolved r = resolve();
        assertTrue(r.modules().get("core"));
        assertTrue(r.features().get("core.dashboard"));
        assertFalse(r.modules().get("lms"));
        assertFalse(r.modules().get("crm"));
        assertFalse(r.features().get("lms.courses"));
        assertFalse(r.features().get("crm.leads"));
    }

    @Test
    void coreModuleIsOnEvenWithADisabledRow() {
        CapabilityResolver.Resolved r = resolve(row("core", false, null));
        assertTrue(r.modules().get("core"));
        assertTrue(r.features().get("core.dashboard"));
    }

    @Test
    void enabledModuleFeaturesFollowDefaultOnWhenNoRow() {
        CapabilityResolver.Resolved r = resolve(row("lms", true, null));
        assertTrue(r.modules().get("lms"));
        assertTrue(r.features().get("lms.courses"));      // default_on true
        assertFalse(r.features().get("lms.mentorship"));  // default_on false
    }

    @Test
    void featureRowOverridesDefaultOnBothWays() {
        CapabilityResolver.Resolved r = resolve(row("lms", true, null),
                row("lms.courses", false, null), row("lms.mentorship", true, null));
        assertFalse(r.features().get("lms.courses"));
        assertTrue(r.features().get("lms.mentorship"));
    }

    @Test
    void featureRowCannotTurnOnAFeatureOfAnOffModule() {
        CapabilityResolver.Resolved r = resolve(row("crm", false, null), row("crm.leads", true, null));
        assertFalse(r.modules().get("crm"));
        assertFalse(r.features().get("crm.leads"));
    }

    @Test
    void expiredModuleTurnsOffWithItsFeatures() {
        CapabilityResolver.Resolved r = resolve(row("crm", true, NOW.minusSeconds(1)), row("crm.leads", true, null));
        assertFalse(r.modules().get("crm"));
        assertFalse(r.features().get("crm.leads"));
    }

    @Test
    void expiryIsExclusiveAtTheInstant() {
        assertFalse(resolve(row("crm", true, NOW)).modules().get("crm"));
        assertTrue(resolve(row("crm", true, NOW.plusSeconds(1))).modules().get("crm"));
    }

    @Test
    void expiredFeatureRowIsOffNotDefault() {
        CapabilityResolver.Resolved r = resolve(row("crm", true, null),
                row("crm.ai_calling", true, NOW.minusSeconds(60)));
        assertTrue(r.features().get("crm.leads"));
        assertFalse(r.features().get("crm.ai_calling"));
    }

    @Test
    void elementGovernedByManyFeaturesNeedsAllOn() {
        CapabilityResolver.Resolved r = resolve(row("crm", true, null), row("crm.ai_calling", false, null));
        assertTrue(CapabilityResolver.allOn(r.features(), List.of("crm.leads")));
        assertFalse(CapabilityResolver.allOn(r.features(), List.of("crm.leads", "crm.ai_calling")));
        assertTrue(CapabilityResolver.allOn(r.features(), List.of()));
        assertFalse(CapabilityResolver.allOn(r.features(), List.of("no.such")));
    }

    @Test
    void unknownRowKeysAreIgnored() {
        CapabilityResolver.Resolved r = resolve(row("gone_module", true, null));
        assertFalse(r.modules().containsKey("gone_module"));
    }

    // ── Snapshot: LEGACY vs MANAGED, caching ─────────────────────────────────

    private record Fixture(CapabilityResolver resolver, InstituteModulePolicyRepository policies,
                           InstituteModuleEntitlementRepository rows) {
    }

    private static Fixture fixture(String mode, InstituteModuleEntitlement... rows) {
        return fixture(CATALOG, mode, rows);
    }

    private static Fixture fixture(CapabilityCatalog catalog, String mode, InstituteModuleEntitlement... rows) {
        CapabilityCatalogRegistry registry = new CapabilityCatalogRegistry(catalog.raw(), null);
        InstituteModulePolicyRepository policies = mock(InstituteModulePolicyRepository.class);
        InstituteModuleEntitlementRepository entitlements = mock(InstituteModuleEntitlementRepository.class);
        when(policies.findById("i1")).thenReturn(mode == null ? Optional.empty()
                : Optional.of(InstituteModulePolicy.builder().instituteId("i1").mode(mode).updatedAt(NOW).build()));
        when(entitlements.findByInstituteIdOrderByKeyAsc("i1")).thenReturn(List.of(rows));
        CapabilityResolver resolver = new CapabilityResolver(registry, policies, entitlements);
        resolver.setClock(java.time.Clock.fixed(NOW, java.time.ZoneOffset.UTC));
        return new Fixture(resolver, policies, entitlements);
    }

    @Test
    void legacyMakesEverythingOnButResolvedStillShowsManagedState() {
        CapabilityResolver.Snapshot s = fixture(null).resolver().snapshot("i1");
        assertEquals("LEGACY", s.mode());
        Map<String, Boolean> features = s.effective().features();
        assertTrue(features.values().stream().allMatch(Boolean::booleanValue));
        assertEquals(5, features.size());
        assertFalse(s.resolved().modules().get("crm"));   // what MANAGED would apply
    }

    @Test
    void explicitLegacyRowBehavesLikeNoRow() {
        CapabilityResolver.Snapshot s = fixture("LEGACY", row("crm", false, null)).resolver().snapshot("i1");
        assertTrue(s.effective().modules().get("crm"));
    }

    @Test
    void managedAppliesTheResolution() {
        Fixture f = fixture("MANAGED", row("crm", true, null));
        assertTrue(f.resolver().isFeatureEnabled("i1", "crm.leads"));
        assertFalse(f.resolver().isFeatureEnabled("i1", "lms.courses"));
        assertTrue(f.resolver().isFeatureEnabled("i1", "core.dashboard"));
    }

    // ── Opt-in modules (commerce) and the strict check ───────────────────────

    private static final CapabilityCatalog OPT_IN_CATALOG = CapabilityCatalogRegistryTest.fixtureWithOptIn();

    @Test
    void legacyDoesNotSwitchOnAnOptInModule() {
        CapabilityResolver.Snapshot s = fixture(OPT_IN_CATALOG, null).resolver().snapshot("i1");
        assertEquals("LEGACY", s.mode());
        assertTrue(s.effective().modules().get("crm"));
        assertTrue(s.effective().features().get("lms.mentorship"));
        assertFalse(s.effective().modules().get("shop"));
        assertFalse(s.effective().features().get("shop.items"));
        assertFalse(s.effective().features().get("shop.till"));
    }

    @Test
    void legacyWithTheModuleRowGetsTheOptInModule() {
        Fixture f = fixture(OPT_IN_CATALOG, "LEGACY", row("shop", true, null), row("shop.till", false, null));
        CapabilityResolver.Resolved effective = f.resolver().snapshot("i1").effective();
        assertTrue(effective.modules().get("shop"));
        assertTrue(effective.features().get("shop.items"));
        assertFalse(effective.features().get("shop.till"));
        assertTrue(f.resolver().isFeatureEnabled("i1", "shop.items"));
        assertFalse(f.resolver().isFeatureEnabled("i1", "shop.till"));
    }

    @Test
    void isFeatureGrantedIsStrictForLegacyInstitutes() {
        Fixture noRows = fixture(OPT_IN_CATALOG, null);
        assertFalse(noRows.resolver().isFeatureGranted("i1", "shop.items"));
        // Strict for every key: LEGACY switches crm on, but it was never granted by a row.
        assertTrue(noRows.resolver().isFeatureEnabled("i1", "crm.leads"));
        assertFalse(noRows.resolver().isFeatureGranted("i1", "crm.leads"));

        Fixture granted = fixture(OPT_IN_CATALOG, "LEGACY", row("shop", true, null));
        assertTrue(granted.resolver().isFeatureGranted("i1", "shop.items"));
    }

    @Test
    void isFeatureGrantedFollowsRowsExpiryAndUnknownKeys() {
        assertTrue(fixture(OPT_IN_CATALOG, "MANAGED", row("shop", true, null))
                .resolver().isFeatureGranted("i1", "shop.items"));
        assertFalse(fixture(OPT_IN_CATALOG, "MANAGED", row("shop", false, null))
                .resolver().isFeatureGranted("i1", "shop.items"));
        assertFalse(fixture(OPT_IN_CATALOG, "MANAGED", row("shop", true, NOW.minusSeconds(1)))
                .resolver().isFeatureGranted("i1", "shop.items"));
        Fixture f = fixture(OPT_IN_CATALOG, "MANAGED", row("shop", true, null));
        assertFalse(f.resolver().isFeatureGranted("i1", "no.such"));
        assertFalse(f.resolver().isFeatureGranted("i1", null));
        assertFalse(f.resolver().isFeatureGranted(null, "shop.items"));
        assertFalse(f.resolver().isFeatureGranted(" ", "shop.items"));
    }

    @Test
    void snapshotIsCachedUntilEvicted() {
        Fixture f = fixture("MANAGED");
        f.resolver().snapshot("i1");
        f.resolver().snapshot("i1");
        verify(f.rows(), times(1)).findByInstituteIdOrderByKeyAsc("i1");
        f.resolver().evict("i1");
        f.resolver().snapshot("i1");
        verify(f.rows(), times(2)).findByInstituteIdOrderByKeyAsc("i1");
    }
}
