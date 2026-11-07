package vacademy.io.admin_core_service.features.workflow.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowCatalogController;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * LEAD_REATTEMPT is catalogued with the lead + counselor keys a "mail the counsellor" workflow
 * needs and the reattempt* keys about the new enquiry, so the template picker offers them and
 * the validator accepts #ctx references to them.
 */
class LeadReattemptTriggerCatalogTest {

    private final TriggerContextKeyRegistry registry = new TriggerContextKeyRegistry(new WorkflowCatalogController());

    @Test
    void reattemptKeysAreKnown() {
        Set<String> keys = registry.knownKeys(WorkflowTriggerEvent.LEAD_REATTEMPT.name()).orElse(null);
        assertNotNull(keys);
        for (String k : Set.of("counselorEmail", "counselorName", "leadName", "leadMobile", "leadEmail",
                "campaignName", "audienceId", "poolId", "reattemptSource", "reattemptEmail", "reattemptMobile",
                "reattemptResponseId", "previousResponseId", "previousStatus", "sameListRepeat")) {
            assertTrue(keys.contains(k), "missing key " + k);
        }
    }
}
