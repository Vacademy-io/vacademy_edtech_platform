package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class EngagementMeteringFieldsTest {

    @Test
    void anAutonomousSendIsASystemCharge() {
        EngagementAction a = new EngagementAction();
        a.setId("a-1");
        a.setEngineId("e-1");
        a.setMemberId("m-1");
        a.setChannel("WHATSAPP");
        MeteringFields m = EngagementDispatchJob.sendMetering(a);
        assertEquals("engagement_message", m.useCase());
        assertEquals("SYSTEM", m.actorKind());
        assertEquals("SCHEDULED", m.surface());
        assertEquals(Map.of("action_id", "a-1", "engine_id", "e-1", "member_id", "m-1", "channel", "WHATSAPP"),
                m.usageContext());
    }
}
