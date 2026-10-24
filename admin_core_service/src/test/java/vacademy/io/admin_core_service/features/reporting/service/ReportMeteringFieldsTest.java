package vacademy.io.admin_core_service.features.reporting.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.reporting.entity.ReportRun;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReportMeteringFieldsTest {

    @Test
    void aScheduledReportIsASystemReportNarrativeCharge() {
        ReportRun run = ReportRun.builder().id("r-1").scheduleId("s-1").scopeType("BATCH").scopeLabel("Class 10")
                .build();
        MeteringFields m = ReportBillingService.runMetering(run);
        assertEquals("report_narrative", m.useCase());
        assertEquals("SYSTEM", m.actorKind());
        assertEquals("SCHEDULED", m.surface());
        assertEquals(Map.of("report_run_id", "r-1", "schedule_id", "s-1", "scope_type", "BATCH",
                "scope_label", "Class 10"), m.usageContext());
    }
}
