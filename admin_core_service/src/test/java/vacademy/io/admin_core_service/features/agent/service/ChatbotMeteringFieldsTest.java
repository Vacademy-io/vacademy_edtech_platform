package vacademy.io.admin_core_service.features.agent.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiRequest;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ChatbotMeteringFieldsTest {

    @Test
    void aKnownChatterIsALearnerOnWhatsapp() {
        MeteringFields m = ChatbotAiService.chargeMetering(ChatbotAiRequest.builder()
                .userId("u-1").flowId("f-1").flowName("Admissions").sessionId("s-1").build());
        assertEquals("chatbot_flow", m.useCase());
        assertEquals("USER", m.actorKind());
        assertEquals("LEARNER", m.actorRoleClass());
        assertEquals("WHATSAPP", m.surface());
        assertEquals(Map.of("flow_id", "f-1", "flow_name", "Admissions", "session_id", "s-1"), m.usageContext());
    }

    @Test
    void anAnonymousChatterIsPublic() {
        MeteringFields m = ChatbotAiService.chargeMetering(ChatbotAiRequest.builder().flowId("f-1").build());
        assertEquals("PUBLIC", m.actorKind());
        assertEquals("PUBLIC", m.actorRoleClass());
        assertEquals(Map.of("flow_id", "f-1"), m.usageContext());
    }
}
