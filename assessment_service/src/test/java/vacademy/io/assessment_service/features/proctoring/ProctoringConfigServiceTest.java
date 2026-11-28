package vacademy.io.assessment_service.features.proctoring;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.proctoring.dto.ProctoringConfigDTO;
import vacademy.io.assessment_service.features.proctoring.enums.ProctoringTier;
import vacademy.io.assessment_service.features.proctoring.service.ProctoringConfigService;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProctoringConfigServiceTest {

    private final ProctoringConfigService service = new ProctoringConfigService();

    @Test
    void nullColumnIsOff_thePreV48Behaviour() {
        Assessment a = new Assessment();
        ProctoringConfigDTO cfg = service.effectiveConfig(a);
        assertEquals(ProctoringTier.NONE, cfg.resolvedTier());
        assertFalse(cfg.isEnabled());
        assertFalse(cfg.getCameraRequired());
    }

    @Test
    void garbageIsOff_neverThrows() {
        Assessment a = new Assessment();
        a.setProctoringConfig("{not json");
        assertFalse(service.effectiveConfig(a).isEnabled());
        a.setProctoringConfig("{\"tier\":\"ULTRA_MEGA\"}");
        assertFalse(service.effectiveConfig(a).isEnabled());
    }

    @Test
    void basicTierFillsDefaults_andOlderClientsOnlySendingTierStillWork() {
        Assessment a = new Assessment();
        a.setProctoringConfig("{\"tier\":\"basic\"}");
        ProctoringConfigDTO cfg = service.effectiveConfig(a);
        assertTrue(cfg.isEnabled());
        assertEquals(30, cfg.getSnapshotIntervalSec());
        assertTrue(cfg.getCameraRequired());
        assertTrue(cfg.getFaceCheck());
        assertEquals(0, cfg.getMaxViolations());
    }

    @Test
    void unknownKnobsAreIgnored_forwardCompatible() {
        Assessment a = new Assessment();
        a.setProctoringConfig("{\"tier\":\"BASIC\",\"clip_on_flag\":true,\"snapshot_interval_sec\":45}");
        assertEquals(45, service.effectiveConfig(a).getSnapshotIntervalSec());
    }

    @Test
    void snapshotIntervalIsClamped_storageIsTheWholeBill() {
        ProctoringConfigDTO cfg = ProctoringConfigDTO.builder().tier("BASIC").snapshotIntervalSec(1).build();
        assertEquals(10, cfg.withDefaults().getSnapshotIntervalSec());
        cfg = ProctoringConfigDTO.builder().tier("BASIC").snapshotIntervalSec(99999).build();
        assertEquals(600, cfg.withDefaults().getSnapshotIntervalSec());
        cfg = ProctoringConfigDTO.builder().tier("BASIC").snapshotIntervalSec(0).build();
        assertEquals(0, cfg.withDefaults().getSnapshotIntervalSec());
    }

    @Test
    void noneSerializesToNull_soOffIsIndistinguishableFromNeverSet() {
        assertNull(service.serialize(ProctoringConfigDTO.builder().tier("NONE").build()));
        assertNull(service.serialize(null));
        String json = service.serialize(ProctoringConfigDTO.builder().tier("BASIC").build());
        assertTrue(json.contains("\"tier\":\"BASIC\""));
        assertTrue(json.contains("\"snapshot_interval_sec\":30"));
    }
}
