package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.dto.LeadTierDTO;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;
import vacademy.io.admin_core_service.features.audience.repository.LeadTierRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Manages the per-institute lead tier catalog and is the single place that turns a score
 * into a tier. Mirrors {@link LeadStatusService}: seeded lazily with the legacy
 * HOT / WARM / COLD bands so institutes that never open the settings keep today's behaviour.
 *
 * <p>The SQL side (list filters / sorts in AudienceResponseRepository) derives the same
 * effective tier via {@code AudienceResponseRepository.EFFECTIVE_TIER_SQL}; keep the two in
 * step when changing band semantics.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadTierService {

    private final LeadTierRepository leadTierRepository;

    /** Legacy thresholds — also the seeded defaults, so nothing changes for existing institutes. */
    public static final String TIER_HOT = "HOT";
    public static final String TIER_WARM = "WARM";
    public static final String TIER_COLD = "COLD";

    private static final String[][] DEFAULTS = {
            // key, label, colour, order, minScore
            {TIER_HOT, "Hot", "#ef4444", "1", "80"},
            {TIER_WARM, "Warm", "#f59e0b", "2", "50"},
            {TIER_COLD, "Cold", "#3b82f6", "3", "0"},
    };

    /**
     * Per-institute catalog cache. Tier derivation runs once per lead while building list
     * DTOs, so without this every page of leads would re-read the catalog per row.
     * Short TTL: a settings edit is visible within a minute everywhere.
     */
    private static final long CACHE_TTL_MS = 60_000L;
    private final Map<String, CachedCatalog> catalogCache = new ConcurrentHashMap<>();

    private record CachedCatalog(List<LeadTier> tiers, long loadedAt) {}

    // ── Catalog ────────────────────────────────────────────────────────────

    /** Active tiers for an institute, seeding the defaults on first access. */
    @Transactional
    public List<LeadTier> listForInstitute(String instituteId) {
        if (leadTierRepository.countByInstituteId(instituteId) == 0) {
            seedDefaults(instituteId);
        }
        return leadTierRepository.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId);
    }

    /** Idempotent seed in its own transaction — safe to call from institute sign-up. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void ensureDefaultsSeeded(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return;
        if (leadTierRepository.countByInstituteId(instituteId) == 0) {
            seedDefaults(instituteId);
        }
    }

    private void seedDefaults(String instituteId) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        for (String[] d : DEFAULTS) {
            leadTierRepository.save(LeadTier.builder()
                    .instituteId(instituteId)
                    .tierKey(d[0])
                    .label(d[1])
                    .color(d[2])
                    .displayOrder(Integer.parseInt(d[3]))
                    .minScore(Integer.parseInt(d[4]))
                    .isActive(true)
                    .isSystem(true)
                    .updatedAt(now)
                    .build());
        }
        catalogCache.remove(instituteId);
        log.info("[LeadTier] Seeded {} default tiers for institute {}", DEFAULTS.length, instituteId);
    }

    @Transactional
    public LeadTier create(String instituteId, LeadTierDTO dto, String actorUserId) {
        String key = normalizeKey(dto.getTierKey(), dto.getLabel());
        if (key.isBlank()) throw new VacademyException("Tier label is required");
        leadTierRepository.findByInstituteIdAndTierKey(instituteId, key).ifPresent(t -> {
            throw new VacademyException("A tier with key " + key + " already exists");
        });
        validateMinScore(dto.getMinScore());
        LeadTier saved = leadTierRepository.save(LeadTier.builder()
                .instituteId(instituteId)
                .tierKey(key)
                .label(dto.getLabel())
                .color(dto.getColor())
                .displayOrder(dto.getDisplayOrder() != null ? dto.getDisplayOrder() : 0)
                .minScore(dto.getMinScore())
                .isActive(true)
                .createdBy(actorUserId)
                .updatedBy(actorUserId)
                .updatedAt(new Timestamp(System.currentTimeMillis()))
                .build());
        catalogCache.remove(instituteId);
        return saved;
    }

    /**
     * Partial update. {@code minScore} is only touched when the caller sends it; to clear a
     * band (make the tier manual-only) send {@code clearMinScore=true}.
     */
    @Transactional
    public LeadTier update(String id, LeadTierDTO dto, boolean clearMinScore, String actorUserId) {
        LeadTier t = leadTierRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Lead tier not found: " + id));
        Timestamp now = new Timestamp(System.currentTimeMillis());
        if (dto.getLabel() != null) t.setLabel(dto.getLabel());
        if (dto.getColor() != null) t.setColor(dto.getColor());
        if (dto.getDisplayOrder() != null) t.setDisplayOrder(dto.getDisplayOrder());
        if (dto.getIsActive() != null) {
            // is_active = false through this endpoint is a soft delete just like DELETE, so it
            // must leave the same trail; otherwise a tier disappears with no deleted_by and the
            // audit answer to "who removed this?" depends on which endpoint was used.
            applyActiveChange(t, Boolean.TRUE.equals(dto.getIsActive()), actorUserId, now);
        }
        if (clearMinScore) {
            t.setMinScore(null);
        } else if (dto.getMinScore() != null) {
            validateMinScore(dto.getMinScore());
            t.setMinScore(dto.getMinScore());
        }
        t.setUpdatedBy(actorUserId);
        t.setUpdatedAt(now);
        LeadTier saved = leadTierRepository.save(t);
        catalogCache.remove(saved.getInstituteId());
        return saved;
    }

    /** Soft delete a custom tier. Seeded defaults cannot be deleted (rename them instead). */
    @Transactional
    public void deactivate(String id, String actorUserId) {
        leadTierRepository.findById(id).ifPresent(t -> {
            if (Boolean.TRUE.equals(t.getIsSystem())) {
                throw new VacademyException("Default lead tiers (Hot / Warm / Cold) cannot be deleted — rename them instead.");
            }
            Timestamp now = new Timestamp(System.currentTimeMillis());
            applyActiveChange(t, false, actorUserId, now);
            t.setUpdatedBy(actorUserId);
            t.setUpdatedAt(now);
            leadTierRepository.save(t);
            catalogCache.remove(t.getInstituteId());
        });
    }

    /**
     * Flip is_active and keep the delete trail honest, for both the DELETE endpoint and an
     * {@code is_active} change sent through the update endpoint.
     *
     * <p>Deactivating stamps deleted_by/deleted_at only on the active → inactive transition, so
     * re-saving an already-deleted row keeps the original remover. Reactivating clears the pair,
     * so a live row never carries a delete trail.</p>
     */
    private void applyActiveChange(LeadTier tier, boolean active, String actorUserId, Timestamp now) {
        boolean wasActive = !Boolean.FALSE.equals(tier.getIsActive());
        tier.setIsActive(active);
        if (active) {
            tier.setDeletedBy(null);
            tier.setDeletedAt(null);
        } else if (wasActive || tier.getDeletedAt() == null) {
            tier.setDeletedBy(actorUserId);
            tier.setDeletedAt(now);
        }
    }

    private void validateMinScore(Integer minScore) {
        if (minScore != null && (minScore < 0 || minScore > 100)) {
            throw new VacademyException("min_score must be between 0 and 100");
        }
    }

    private String normalizeKey(String key, String label) {
        String base = (key != null && !key.isBlank()) ? key : (label != null ? label : "");
        return base.trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
    }

    // ── Derivation ──────────────────────────────────────────────────────────

    /** Active tiers, cached per institute for {@value #CACHE_TTL_MS} ms. Never seeds. */
    public List<LeadTier> cachedActiveTiers(String instituteId) {
        if (instituteId == null) return List.of();
        long now = System.currentTimeMillis();
        CachedCatalog c = catalogCache.get(instituteId);
        if (c != null && now - c.loadedAt() < CACHE_TTL_MS) return c.tiers();
        List<LeadTier> tiers = leadTierRepository.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(instituteId);
        catalogCache.put(instituteId, new CachedCatalog(tiers, now));
        return tiers;
    }

    /**
     * Tier a score lands in for this institute: the banded tier with the highest
     * {@code minScore <= score}. Falls back to the legacy 80/50 thresholds when the institute
     * has no banded tiers (not yet seeded, or the admin removed every band).
     */
    public String deriveTier(String instituteId, Integer score) {
        int s = score != null ? score : 0;
        return cachedActiveTiers(instituteId).stream()
                .filter(t -> t.getMinScore() != null && s >= t.getMinScore())
                .max(Comparator.comparingInt(LeadTier::getMinScore))
                .map(LeadTier::getTierKey)
                .orElseGet(() -> legacyTier(s));
    }

    /** Explicit override wins, otherwise the score-derived tier. */
    public String effectiveTier(String instituteId, String overrideTier, Integer score) {
        if (overrideTier != null && !overrideTier.isBlank()) return overrideTier;
        return deriveTier(instituteId, score);
    }

    /**
     * Is {@code tierKey} a valid tier for the institute? Legacy keys always pass.
     *
     * <p>A cache miss falls through to a direct read instead of rejecting: admin_core runs
     * several pods, each with its own {@value #CACHE_TTL_MS} ms catalog cache, so a tier created
     * on one pod would otherwise be refused as "unknown" by another for up to a minute — right
     * after the admin added it. The extra query only runs on the miss path (an unknown key, or a
     * brand-new tier), never for the common HOT/WARM/COLD case.</p>
     */
    public boolean isKnownTier(String instituteId, String tierKey) {
        if (tierKey == null) return false;
        String k = tierKey.trim().toUpperCase();
        if (TIER_HOT.equals(k) || TIER_WARM.equals(k) || TIER_COLD.equals(k)) return true;
        if (cachedActiveTiers(instituteId).stream().anyMatch(t -> t.getTierKey().equals(k))) {
            return true;
        }
        if (instituteId == null) return false;
        // Miss: re-read this one key straight from the DB before rejecting. Inactive (soft-deleted)
        // tiers still pass — leads already carrying the key must stay re-assignable.
        boolean known = leadTierRepository.findByInstituteIdAndTierKey(instituteId, k).isPresent();
        if (known) catalogCache.remove(instituteId);
        return known;
    }

    /** The hard-coded thresholds every institute had before the catalog existed. */
    public static String legacyTier(int score) {
        if (score >= 80) return TIER_HOT;
        if (score >= 50) return TIER_WARM;
        return TIER_COLD;
    }
}
