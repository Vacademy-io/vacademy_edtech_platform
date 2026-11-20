package vacademy.io.admin_core_service.features.capabilities.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@code commerce.accounts} over the shipped catalogue: the commerce module row alone leaves it off
 * (it is not default_on), its own feature row turns it on, and that row cannot turn it on while the
 * module row is off. Both policy modes.
 */
class CommerceAccountsDefaultOffTest {

    private static final String INSTITUTE = "inst-1";
    private static final String ACCOUNTS = "commerce.accounts";

    private InstituteModulePolicyRepository policies;
    private InstituteModuleEntitlementRepository entitlements;
    private CapabilityResolver resolver;

    @BeforeEach
    void setUp() {
        policies = mock(InstituteModulePolicyRepository.class);
        entitlements = mock(InstituteModuleEntitlementRepository.class);
        resolver = new CapabilityResolver(new CapabilityCatalogRegistry(), policies, entitlements);
        when(policies.findById(any())).thenReturn(Optional.empty());
    }

    private static InstituteModuleEntitlement row(String key, boolean enabled) {
        return InstituteModuleEntitlement.builder().instituteId(INSTITUTE).key(key).enabled(enabled)
                .updatedAt(Instant.parse("2026-11-20T00:00:00Z")).build();
    }

    private boolean granted(InstituteModuleEntitlement... rows) {
        when(entitlements.findByInstituteIdOrderByKeyAsc(INSTITUTE)).thenReturn(List.of(rows));
        resolver.evict(INSTITUTE);
        return resolver.isFeatureGranted(INSTITUTE, ACCOUNTS);
    }

    private void checkTruthTable() {
        // Module row on, no feature row: off, while the default-on commerce features are on.
        assertFalse(granted(row("commerce", true)));
        assertTrue(resolver.isFeatureGranted(INSTITUTE, "commerce.stock"));
        // Feature row enabled: on.
        assertTrue(granted(row("commerce", true), row(ACCOUNTS, true)));
        // Feature row enabled but the module row off, or missing: off.
        assertFalse(granted(row("commerce", false), row(ACCOUNTS, true)));
        assertFalse(granted(row(ACCOUNTS, true)));
        // Feature row disabled: off.
        assertFalse(granted(row("commerce", true), row(ACCOUNTS, false)));
        // No rows at all: off.
        assertFalse(granted());
    }

    @Test
    void legacyInstitute() {
        checkTruthTable();
    }

    @Test
    void managedInstitute() {
        when(policies.findById(INSTITUTE)).thenReturn(Optional.of(InstituteModulePolicy.builder()
                .instituteId(INSTITUTE).mode(InstituteModulePolicy.MODE_MANAGED).build()));
        checkTruthTable();
    }
}
