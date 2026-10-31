package vacademy.io.admin_core_service.features.student_analysis.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ComprehensiveReportMeteringFieldsTest {

    @Test
    void anAdminRunReportIsAUserChargeOnTheAdminApp() {
        MeteringFields m = ComprehensiveReportLLMService.reportMetering(
                new ComprehensiveReportLLMService.ChargeContext("i-1", "learner-1", "admin-1", "p-1"), "narrative");
        assertEquals("student_report", m.useCase());
        assertEquals("USER", m.actorKind());
        assertEquals("ADMIN_APP", m.surface());
        assertEquals(Map.of("process_id", "p-1", "purpose", "narrative"), m.usageContext());
    }

    @Test
    void aReportWithNoActorIsASystemCharge() {
        MeteringFields m = ComprehensiveReportLLMService.reportMetering(
                new ComprehensiveReportLLMService.ChargeContext("i-1", "learner-1", null, "p-1"), "narrative");
        assertEquals("SYSTEM", m.actorKind());
        assertEquals("SCHEDULED", m.surface());
    }
}
