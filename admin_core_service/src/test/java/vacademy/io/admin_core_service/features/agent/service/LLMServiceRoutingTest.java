package vacademy.io.admin_core_service.features.agent.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.ai_models.ModelDefaults;
import vacademy.io.admin_core_service.features.ai_models.service.AiModelDefaultsResolver;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LLMServiceRoutingTest {

    private static final String GLM = ModelDefaults.GLM_DEFAULT;
    private static final String GEMINI = ModelDefaults.NON_GLM_FALLBACK;

    private final AiModelDefaultsResolver resolver = mock(AiModelDefaultsResolver.class);
    private final LlmGatewayRouter router = mock(LlmGatewayRouter.class);
    private final AiTokenUsageService usage = mock(AiTokenUsageService.class);
    private final LLMService service = new LLMService(new ObjectMapper(), usage, router, resolver);

    private ConversationSession session(String model) {
        ConversationSession s = ConversationSession.builder()
                .instituteId("6f0c1d1e-0000-4000-8000-000000000001")
                .model(model)
                .build();
        s.addMessage(ConversationSession.ChatMessage.user("hi"));
        return s;
    }

    private void chainFor(String useCase, String... models) {
        when(resolver.resolve(useCase))
                .thenReturn(new AiModelDefaultsResolver.ModelChain(useCase, List.of(models), true));
    }

    @Test
    void noModelUsesTheUseCaseChain() {
        chainFor("chatbot_flow", GLM, GEMINI);
        ConversationSession s = session(null);
        s.getContext().put(LLMService.CTX_USE_CASE, "chatbot_flow");
        assertEquals(List.of(GLM, GEMINI), service.modelChain(s));
    }

    @Test
    void defaultUseCaseIsTheAdminAgent() {
        chainFor("admin_agent", GLM, GEMINI);
        assertEquals(List.of(GLM, GEMINI), service.modelChain(session(" ")));
    }

    @Test
    void explicitPickWinsAndKeepsTheChainAsFailover() {
        chainFor("admin_agent", GLM, GEMINI);
        assertEquals(List.of("anthropic/claude-sonnet-4.5", GLM, GEMINI),
                service.modelChain(session("anthropic/claude-sonnet-4.5")));
    }

    @Test
    void noFailoverMeansTheExplicitModelOnly() {
        ConversationSession s = session(GEMINI);
        s.getContext().put(LLMService.CTX_NO_FAILOVER, Boolean.TRUE);
        assertEquals(List.of(GEMINI), service.modelChain(s));
    }

    @Test
    @SuppressWarnings("unchecked")
    void usageIsRecordedUnderTheModelThatAnswered() {
        chainFor("engagement", GLM, GEMINI);
        String body = "{\"choices\":[{\"message\":{\"content\":\"hey\"},\"finish_reason\":\"stop\"}],"
                + "\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":5}}";
        when(router.chat(eq(List.of(GLM, GEMINI)), anyMap(), any(Duration.class), isNull(), isNull()))
                .thenReturn(new LlmGatewayRouter.LlmResult(body, GEMINI, "hey", "stop", false, 20, 5));

        ConversationSession s = session(null);
        s.getContext().put(LLMService.CTX_USE_CASE, "engagement");
        LLMService.LLMResponse r = service.generateChatCompletion(s);

        assertEquals("hey", r.getContent());
        assertEquals(GEMINI, r.getModelUsed());
        verify(usage).recordUsageAsync(eq(ApiProvider.OPENAI), eq(RequestType.AGENT), eq(GEMINI),
                eq(20), eq(5), any(), isNull());

        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        verify(router).chat(any(List.class), payload.capture(), any(Duration.class), isNull(), isNull());
        assertFalse(payload.getValue().containsKey("model"), "the router sets the model per attempt");
        assertFalse(payload.getValue().containsKey("reasoning"), "the router sets the effort per attempt");
        assertEquals(4096, payload.getValue().get("max_tokens"));
    }

    @Test
    void callerEffortAndDeadlineReachTheRouter() {
        chainFor("chatbot_flow", GLM, GEMINI);
        String body = "{\"choices\":[{\"message\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}";
        when(router.chat(any(), anyMap(), eq(Duration.ofSeconds(20)), eq("medium"), eq(Duration.ofSeconds(27))))
                .thenReturn(new LlmGatewayRouter.LlmResult(body, GLM, "ok", "stop", false, 0, 0));
        ConversationSession s = session(null);
        s.getContext().put(LLMService.CTX_USE_CASE, "chatbot_flow");
        s.getContext().put(LLMService.CTX_REASONING_EFFORT, "medium");
        s.getContext().put(LLMService.CTX_ATTEMPT_TIMEOUT, Duration.ofSeconds(20));
        s.getContext().put(LLMService.CTX_TIME_BUDGET, Duration.ofSeconds(27));
        LLMService.LLMResponse r = service.generateChatCompletion(s);
        assertEquals(GLM, r.getModelUsed());
        assertNull(r.getUsageLogId());
        verify(usage, org.mockito.Mockito.never()).recordUsageAsync(any(), any(), any(), anyInt(), anyInt(), any(), any());
    }
}
