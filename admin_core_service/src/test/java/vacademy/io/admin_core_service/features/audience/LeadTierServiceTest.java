package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadTierDTO;
import vacademy.io.admin_core_service.features.audience.entity.LeadTier;
import vacademy.io.admin_core_service.features.audience.repository.LeadTierRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadTierService;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Score → tier derivation against the institute catalog, plus the legacy fallback that
 * keeps institutes without a catalog on the old 80/50 thresholds.
 */
class LeadTierServiceTest {

    private static final String INST = "inst-1";

    private LeadTierRepository repo;
    private LeadTierService service;

    @BeforeEach
    void setUp() {
        repo = mock(LeadTierRepository.class);
        service = new LeadTierService(repo);
    }

    private static LeadTier tier(String key, Integer minScore, int order) {
        return LeadTier.builder().id(key).instituteId(INST).tierKey(key).label(key)
                .minScore(minScore).displayOrder(order).isActive(true).build();
    }

    @Test
    void legacyThresholdsWhenInstituteHasNoCatalog() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST)).thenReturn(List.of());
        assertEquals("HOT", service.deriveTier(INST, 80));
        assertEquals("WARM", service.deriveTier(INST, 79));
        assertEquals("WARM", service.deriveTier(INST, 50));
        assertEquals("COLD", service.deriveTier(INST, 49));
        assertEquals("COLD", service.deriveTier(INST, null));
        // No institute context → legacy thresholds still apply.
        assertEquals("HOT", service.deriveTier(null, 95));
    }

    @Test
    void highestMatchingBandWinsOnACustomLadder() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST)).thenReturn(List.of(
                tier("SUPER_HOT", 95, 1),
                tier("VERY_HOT", 85, 2),
                tier("HOT", 70, 3),
                tier("VIP", null, 4),   // manual-only: never derived
                tier("WARM", 50, 5),
                tier("VERY_COLD", 0, 6)));
        assertEquals("SUPER_HOT", service.deriveTier(INST, 97));
        assertEquals("VERY_HOT", service.deriveTier(INST, 85));
        assertEquals("HOT", service.deriveTier(INST, 84));
        assertEquals("WARM", service.deriveTier(INST, 69));
        assertEquals("VERY_COLD", service.deriveTier(INST, 3));
    }

    @Test
    void manualOnlyCatalogFallsBackToLegacyBands() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST))
                .thenReturn(List.of(tier("VIP", null, 1), tier("REGULAR", null, 2)));
        assertEquals("HOT", service.deriveTier(INST, 90));
        assertEquals("COLD", service.deriveTier(INST, 10));
    }

    @Test
    void effectiveTierPrefersExplicitOverride() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST)).thenReturn(List.of());
        assertEquals("VIP", service.effectiveTier(INST, "VIP", 10));
        assertEquals("COLD", service.effectiveTier(INST, "  ", 10));
        assertEquals("COLD", service.effectiveTier(INST, null, 10));
    }

    @Test
    void knownTierAcceptsLegacyKeysAndCatalogKeysOnly() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST))
                .thenReturn(List.of(tier("SUPER_HOT", 95, 1)));
        when(repo.findByInstituteIdAndTierKey(eq(INST), anyString())).thenReturn(Optional.empty());
        assertTrue(service.isKnownTier(INST, "hot"));
        assertTrue(service.isKnownTier(INST, "super_hot"));
        assertFalse(service.isKnownTier(INST, "LUKEWARM"));
        assertFalse(service.isKnownTier(INST, null));
    }

    /**
     * Multi-pod safety: a tier created on another pod isn't in this pod's cache yet, but the
     * admin must still be able to assign it immediately.
     */
    @Test
    void knownTierFallsBackToDbWhenCacheIsStale() {
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST)).thenReturn(List.of());
        when(repo.findByInstituteIdAndTierKey(INST, "LUKEWARM"))
                .thenReturn(Optional.of(tier("LUKEWARM", 35, 5)));
        when(repo.findByInstituteIdAndTierKey(INST, "NOPE")).thenReturn(Optional.empty());
        assertTrue(service.isKnownTier(INST, "lukewarm"));
        assertFalse(service.isKnownTier(INST, "NOPE"));
    }

    /**
     * Deactivating through the UPDATE endpoint is a soft delete too — it must leave the same
     * deleted_by/deleted_at trail as DELETE, or "who removed this tier?" depends on which
     * endpoint the caller happened to use.
     */
    @Test
    void updateDeactivationStampsTheDeleteTrail() {
        LeadTier custom = tier("LUKEWARM", 35, 5);
        when(repo.findById("LUKEWARM")).thenReturn(Optional.of(custom));
        when(repo.save(any(LeadTier.class))).thenAnswer(inv -> inv.getArgument(0));

        LeadTier removed = service.update("LUKEWARM",
                LeadTierDTO.builder().isActive(false).build(), false, "actor-9");
        assertFalse(removed.getIsActive());
        assertEquals("actor-9", removed.getDeletedBy());
        assertEquals("actor-9", removed.getUpdatedBy());
        assertNotNull(removed.getDeletedAt());

        // Re-saving an already-deleted row keeps the ORIGINAL remover.
        Timestamp firstDeletedAt = removed.getDeletedAt();
        LeadTier resaved = service.update("LUKEWARM",
                LeadTierDTO.builder().label("Luke Warm").isActive(false).build(), false, "actor-10");
        assertEquals("actor-9", resaved.getDeletedBy());
        assertEquals(firstDeletedAt, resaved.getDeletedAt());
        assertEquals("actor-10", resaved.getUpdatedBy());
    }

    /** An update that doesn't touch is_active must not invent a delete trail. */
    @Test
    void plainUpdateLeavesDeleteTrailAlone() {
        LeadTier custom = tier("LUKEWARM", 35, 5);
        when(repo.findById("LUKEWARM")).thenReturn(Optional.of(custom));
        when(repo.save(any(LeadTier.class))).thenAnswer(inv -> inv.getArgument(0));

        LeadTier renamed = service.update("LUKEWARM",
                LeadTierDTO.builder().label("Luke Warm").build(), false, "actor-11");
        assertTrue(renamed.getIsActive());
        assertNull(renamed.getDeletedBy());
        assertNull(renamed.getDeletedAt());
    }

    /** A soft-deleted tier stays assignable so leads already carrying it can be re-set. */
    @Test
    void knownTierAcceptsSoftDeletedTier() {
        LeadTier retired = tier("RETIRED", 60, 9);
        retired.setIsActive(false);
        when(repo.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(INST)).thenReturn(List.of());
        when(repo.findByInstituteIdAndTierKey(INST, "RETIRED")).thenReturn(Optional.of(retired));
        assertTrue(service.isKnownTier(INST, "RETIRED"));
    }

    @Test
    void createNormalisesKeyFromLabelAndRejectsDuplicatesAndBadBands() {
        when(repo.findByInstituteIdAndTierKey(eq(INST), anyString())).thenReturn(Optional.empty());
        when(repo.save(any(LeadTier.class))).thenAnswer(inv -> inv.getArgument(0));

        LeadTier created = service.create(INST, LeadTierDTO.builder().label("Super Hot!").minScore(95).build(), "actor-1");
        assertEquals("SUPER_HOT", created.getTierKey());
        assertEquals("Super Hot!", created.getLabel());
        assertEquals(95, created.getMinScore());
        assertFalse(created.getIsSystem());
        assertEquals("actor-1", created.getCreatedBy());
        assertEquals("actor-1", created.getUpdatedBy());

        assertThrows(VacademyException.class,
                () -> service.create(INST, LeadTierDTO.builder().label("Odd").minScore(101).build(), "actor-1"));

        when(repo.findByInstituteIdAndTierKey(INST, "WARM")).thenReturn(Optional.of(tier("WARM", 50, 2)));
        assertThrows(VacademyException.class,
                () -> service.create(INST, LeadTierDTO.builder().label("warm").build(), "actor-1"));
    }

    @Test
    void updateClearsBandOnlyWhenAsked() {
        LeadTier existing = tier("HOT", 80, 1);
        when(repo.findById("HOT")).thenReturn(Optional.of(existing));
        when(repo.save(any(LeadTier.class))).thenAnswer(inv -> inv.getArgument(0));

        // min_score absent from the payload → band untouched.
        LeadTier renamed = service.update("HOT", LeadTierDTO.builder().label("Very Hot").build(), false, "actor-2");
        assertEquals("Very Hot", renamed.getLabel());
        assertEquals(80, renamed.getMinScore());

        LeadTier manual = service.update("HOT", LeadTierDTO.builder().build(), true, "actor-2");
        assertNull(manual.getMinScore());
        assertEquals("actor-2", manual.getUpdatedBy());
    }

    /** Soft delete records who removed the tier; reactivating clears that trail. */
    @Test
    void deactivateRecordsDeleterAndReactivationClearsIt() {
        LeadTier custom = tier("LUKEWARM", 35, 5);
        when(repo.findById("LUKEWARM")).thenReturn(Optional.of(custom));
        when(repo.save(any(LeadTier.class))).thenAnswer(inv -> inv.getArgument(0));

        service.deactivate("LUKEWARM", "actor-3");
        assertFalse(custom.getIsActive());
        assertEquals("actor-3", custom.getDeletedBy());
        assertEquals("actor-3", custom.getUpdatedBy());
        assertNotNull(custom.getDeletedAt());

        LeadTier revived = service.update("LUKEWARM",
                LeadTierDTO.builder().isActive(true).build(), false, "actor-4");
        assertTrue(revived.getIsActive());
        assertNull(revived.getDeletedBy());
        assertNull(revived.getDeletedAt());
        assertEquals("actor-4", revived.getUpdatedBy());
    }

    @Test
    void systemTiersCannotBeDeleted() {
        LeadTier hot = tier("HOT", 80, 1);
        hot.setIsSystem(true);
        when(repo.findById("HOT")).thenReturn(Optional.of(hot));
        assertThrows(VacademyException.class, () -> service.deactivate("HOT", "actor-3"));
    }
}
