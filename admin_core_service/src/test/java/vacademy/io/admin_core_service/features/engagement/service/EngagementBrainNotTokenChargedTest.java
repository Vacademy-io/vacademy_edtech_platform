package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * billing.java_agent_charge must never token-charge the engagement brain: auto-replies are free
 * by product decision and proactive sends carry a flat per-message fee. Every engagement LLM
 * session therefore carries LLMService.CTX_BILLED_BY_CALLER.
 */
class EngagementBrainNotTokenChargedTest {

    private final LLMService llm = mock(LLMService.class);
    private final List<ConversationSession> sessions = new ArrayList<>();

    private EngagementEngine engine() {
        EngagementEngine e = new EngagementEngine();
        e.setInstituteId("6f0c1d1e-0000-4000-8000-000000000001");
        return e;
    }

    private void captureSessions() {
        when(llm.generateChatCompletion(any())).thenAnswer(inv -> {
            sessions.add(inv.getArgument(0));
            throw new IllegalStateException("stop after capturing the session");
        });
    }

    private void assertAllFlagged() {
        assertFalse(sessions.isEmpty(), "the brain made no LLM call");
        for (ConversationSession s : sessions) {
            assertEquals(Boolean.TRUE, s.getContext().get(LLMService.CTX_BILLED_BY_CALLER));
            assertEquals("engagement", s.getContext().get(LLMService.CTX_USE_CASE));
        }
    }

    @Test
    void replyBrainSessionsAreBilledByCaller() {
        captureSessions();
        try {
            new EngagementReplyBrain(llm).decide(engine(), "brief", "hello");
        } catch (RuntimeException ignored) {
            // the stub throws after capturing; only the session matters here
        }
        assertAllFlagged();
    }

    @Test
    void proactiveBrainSessionsAreBilledByCaller() {
        captureSessions();
        try {
            new EngagementBrainClient(llm).decide(engine(), "brief", Map.of(), Instant.now(),
                    Set.of("WHATSAPP"), List.of());
        } catch (RuntimeException ignored) {
            // as above
        }
        assertAllFlagged();
    }

    @Test
    void templateAdvisorSessionsAreBilledByCaller() {
        captureSessions();
        try {
            new EngagementTemplateAdvisor(llm).propose(engine(), "brief", null, List.of(), 2);
        } catch (RuntimeException ignored) {
            // as above
        }
        assertAllFlagged();
    }
}
