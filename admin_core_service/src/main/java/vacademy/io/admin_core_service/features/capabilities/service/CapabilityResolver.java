package vacademy.io.admin_core_service.features.capabilities.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalog;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModuleEntitlement;
import vacademy.io.admin_core_service.features.capabilities.entity.InstituteModulePolicy;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModuleEntitlementRepository;
import vacademy.io.admin_core_service.features.capabilities.repository.InstituteModulePolicyRepository;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Entitlement resolution (spec §5) — the one function every consumer goes through.
 *
 * <ul>
 *   <li>{@code mode = LEGACY} (also: no policy row) → every module and feature is on, except
 *       {@code opt_in} modules (commerce), which follow their rows as in MANAGED.</li>
 *   <li>{@code mode = MANAGED} → a module is on ⇔ it is core, or its row is enabled and not
 *       expired (no row = off); a feature is on ⇔ its module is on AND (its row is enabled and
 *       not expired, or — no row — the catalogue {@code default_on}).</li>
 * </ul>
 *
 * {@code resolved} is always the MANAGED computation (what MANAGED would apply even while
 * LEGACY, §12.3); {@code effective} is what applies now. Results are cached per institute for
 * {@link #CACHE_TTL} and evicted on every write through {@link #evict}; other pods converge
 * within the TTL.
 */
@Service
public class CapabilityResolver {

    public static final Duration CACHE_TTL = Duration.ofSeconds(60);

    private final CapabilityCatalogRegistry registry;
    private final InstituteModulePolicyRepository policyRepository;
    private final InstituteModuleEntitlementRepository entitlementRepository;
    private final Cache<String, Snapshot> cache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(CACHE_TTL)
            .build();
    private final Set<String> optInKeys;
    private Clock clock = Clock.systemUTC();

    public CapabilityResolver(CapabilityCatalogRegistry registry,
                              InstituteModulePolicyRepository policyRepository,
                              InstituteModuleEntitlementRepository entitlementRepository) {
        this.registry = registry;
        this.policyRepository = policyRepository;
        this.entitlementRepository = entitlementRepository;
        this.optInKeys = optInKeys(registry.catalog());
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** MANAGED-mode resolution of a set of rows. */
    public record Resolved(Map<String, Boolean> modules, Map<String, Boolean> features) {
    }

    /**
     * Everything known about one institute's entitlements at {@code resolvedAt}.
     *
     * @param mode     LEGACY or MANAGED
     * @param rows     stored rows, sorted by key
     * @param resolved  MANAGED-mode resolution
     * @param optInKeys keys of opt-in modules and of their features; LEGACY does not switch these on
     */
    public record Snapshot(String instituteId, String mode, String modeUpdatedBy, Instant modeUpdatedAt,
                           List<InstituteModuleEntitlement> rows, Resolved resolved, Set<String> optInKeys,
                           Instant resolvedAt) {

        public boolean managed() {
            return InstituteModulePolicy.MODE_MANAGED.equals(mode);
        }

        /**
         * What applies now: {@link #resolved} in MANAGED; in LEGACY everything on except the
         * opt-in keys, which keep their resolved value.
         */
        public Resolved effective() {
            if (managed()) {
                return resolved;
            }
            return new Resolved(legacy(resolved.modules()), legacy(resolved.features()));
        }

        private Map<String, Boolean> legacy(Map<String, Boolean> resolvedValues) {
            Map<String, Boolean> out = new LinkedHashMap<>();
            resolvedValues.forEach((k, on) -> out.put(k, optInKeys.contains(k) ? on : Boolean.TRUE));
            return Collections.unmodifiableMap(out);
        }
    }

    /** Keys of every opt-in module and of its features. */
    public static Set<String> optInKeys(CapabilityCatalog catalog) {
        Set<String> out = new LinkedHashSet<>();
        for (CapabilityCatalog.Module module : catalog.modules()) {
            if (module.optIn()) {
                out.add(module.key());
                module.features().forEach(f -> out.add(f.key()));
            }
        }
        return Collections.unmodifiableSet(out);
    }

    // ── Pure resolution (unit-tested truth table) ────────────────────────────

    public static Resolved resolve(CapabilityCatalog catalog, Collection<InstituteModuleEntitlement> rows,
                                   Instant now) {
        Map<String, InstituteModuleEntitlement> byKey = new LinkedHashMap<>();
        if (rows != null) {
            rows.forEach(r -> byKey.put(r.getKey(), r));
        }
        Map<String, Boolean> modules = new LinkedHashMap<>();
        Map<String, Boolean> features = new LinkedHashMap<>();
        for (CapabilityCatalog.Module module : catalog.modules()) {
            InstituteModuleEntitlement moduleRow = byKey.get(module.key());
            boolean moduleOn = module.core() || (moduleRow != null && moduleRow.isActiveAt(now));
            modules.put(module.key(), moduleOn);
            for (CapabilityCatalog.Feature feature : module.features()) {
                InstituteModuleEntitlement featureRow = byKey.get(feature.key());
                boolean featureOn = featureRow != null ? featureRow.isActiveAt(now) : feature.defaultOn();
                features.put(feature.key(), moduleOn && featureOn);
            }
        }
        return new Resolved(Collections.unmodifiableMap(modules), Collections.unmodifiableMap(features));
    }

    /**
     * A UI element governed by several features is visible only if ALL of them are on (§4).
     * Unknown keys count as off; an empty list is ungoverned (on).
     */
    public static boolean allOn(Map<String, Boolean> features, Collection<String> featureKeys) {
        for (String key : featureKeys) {
            if (!Boolean.TRUE.equals(features.get(key))) {
                return false;
            }
        }
        return true;
    }

    // ── Cached per-institute lookup ──────────────────────────────────────────

    public Snapshot snapshot(String instituteId) {
        return cache.get(instituteId, this::load);
    }

    /**
     * Effective state of one feature for an institute (LEGACY → true, except features of an
     * opt-in module). For §10 enforcement.
     */
    public boolean isFeatureEnabled(String instituteId, String featureKey) {
        return Boolean.TRUE.equals(snapshot(instituteId).effective().features().get(featureKey));
    }

    /**
     * Strict check: the resolved value in every mode, so a LEGACY institute passes only when
     * the module row (and the feature row, if any) is enabled and not expired. Unknown key or
     * blank institute = false. Commerce uses this; it must never be on by default.
     */
    public boolean isFeatureGranted(String instituteId, String featureKey) {
        if (instituteId == null || instituteId.isBlank() || featureKey == null) {
            return false;
        }
        return Boolean.TRUE.equals(snapshot(instituteId).resolved().features().get(featureKey));
    }

    /**
     * Drops the cached snapshot now and, inside a transaction, again after commit — so a read
     * racing the write cannot re-cache the pre-commit state for a full TTL.
     */
    public void evict(String instituteId) {
        cache.invalidate(instituteId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    cache.invalidate(instituteId);
                }
            });
        }
    }

    public void evictAll() {
        cache.invalidateAll();
    }

    /** Uncached; also used by the super-admin read path so staff always see the stored truth. */
    public Snapshot load(String instituteId) {
        Optional<InstituteModulePolicy> policy = policyRepository.findById(instituteId);
        List<InstituteModuleEntitlement> rows = entitlementRepository.findByInstituteIdOrderByKeyAsc(instituteId);
        Instant now = Instant.now(clock);
        String mode = policy.map(InstituteModulePolicy::getMode).orElse(InstituteModulePolicy.MODE_LEGACY);
        return new Snapshot(instituteId, mode,
                policy.map(InstituteModulePolicy::getUpdatedBy).orElse(null),
                policy.map(InstituteModulePolicy::getUpdatedAt).orElse(null),
                List.copyOf(rows), resolve(registry.catalog(), rows, now), optInKeys, now);
    }
}
