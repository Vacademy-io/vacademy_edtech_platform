package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Meta caps MARKETING templates per person (131049), so the advisor is told to write utility-first
 * and to label honestly. The wording itself needs a real model; what is pinned here is that the
 * instruction reaches the model and that the purposes the admin picks lead with the utility ones.
 */
class EngagementTemplateAdvisorUtilityFirstTest {

    private String systemPromptSentToModel() {
        LLMService llm = mock(LLMService.class);
        List<ConversationSession> sessions = new ArrayList<>();
        when(llm.generateChatCompletion(any())).thenAnswer(inv -> {
            sessions.add(inv.getArgument(0));
            throw new IllegalStateException("stop after capturing the session");
        });
        EngagementEngine engine = new EngagementEngine();
        engine.setInstituteId("6f0c1d1e-0000-4000-8000-000000000001");
        try {
            new EngagementTemplateAdvisor(llm).propose(engine, "Get the lead to book a demo.", null, List.of(), 2);
        } catch (RuntimeException ignored) {
            // the stub throws after capturing; only the prompt matters here
        }
        assertFalse(sessions.isEmpty(), "the advisor made no LLM call");
        return sessions.get(0).getHistory().get(0).getContent();
    }

    @Test
    @DisplayName("the prompt asks for utility wording anchored on the lead's own action")
    void asksForUtilityFirst() {
        String p = systemPromptSentToModel();
        assertTrue(p.contains("UTILITY-FIRST"), "utility-first instruction missing");
        assertTrue(p.contains("131049"), "the reason (Meta's marketing cap) is not given to the model");
        assertTrue(p.contains("Anchor it on something the person did or asked for"));
        assertTrue(p.contains("Reply with a time that suits you"), "reply-style call to action missing");
    }

    @Test
    @DisplayName("the prompt forbids selling words in utility text and labelling promotional text UTILITY")
    void labelsHonestly() {
        String p = systemPromptSentToModel();
        assertTrue(p.contains("No selling"));
        assertTrue(p.contains("Never label promotional text UTILITY"));
        assertTrue(p.contains("MARKETING only when the purpose itself is promotional"));
        assertTrue(p.contains("which action of the person the template is anchored on"));
    }
}
