package vacademy.io.admin_core_service.features.agent.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.ai_models.service.AiModelDefaultsResolver;
import vacademy.io.admin_core_service.features.ai_models.service.LlmGatewayRouter;
import vacademy.io.admin_core_service.features.ai_usage.entity.AiTokenUsage;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;
import vacademy.io.admin_core_service.features.ai_usage.service.JavaLlmBillingService;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * billing.java_agent_charge in LLMService: off (the default) records usage exactly as before;
 * on charges only calls that no caller bills.
 */
class LLMServiceBillingSwitchTest {

    private static final String SONNET = "anthropic/claude-sonnet-4.5";
    private static final String INSTITUTE = "6f0c1d1e-0000-4000-8000-000000000001";
    private static final String USER = "6f0c1d1e-0000-4000-8000-000000000002";

    private final AiModelDefaultsResolver resolver = mock(AiModelDefaultsResolver.class);
    private final LlmGatewayRouter router = mock(LlmGatewayRouter.class);
    private final AiTokenUsageService usage = mock(AiTokenUsageService.class);
    private final JavaLlmBillingService billing = mock(JavaLlmBillingService.class);
    private final LLMService service = new LLMService(new ObjectMapper(), usage, router, resolver);

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(service, "llmBilling", billing);
        when(resolver.resolve("admin_agent"))
                .thenReturn(new AiModelDefaultsResolver.ModelChain("admin_agent", List.of(SONNET), true));
        String body = "{\"choices\":[{\"message\":{\"content\":\"hey\"},\"finish_reason\":\"stop\"}],"
                + "\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":5}}";
        when(router.chat(any(List.class), anyMap(), any(Duration.class), isNull(), isNull()))
                .thenReturn(new LlmGatewayRouter.LlmResult(body, SONNET, "hey", "stop", false, 20, 5));
    }

    private ConversationSession session() {
        ConversationSession s = ConversationSession.builder()
                .instituteId(INSTITUTE)
                .userId(USER)
                .build();
        s.addMessage(ConversationSession.ChatMessage.user("hi"));
        return s;
    }

    @Test
    void switchOffRecordsExactlyAsBefore() {
        when(billing.isEnabled()).thenReturn(false);

        service.generateChatCompletion(session());

        verify(usage).recordUsageAsync(ApiProvider.OPENAI, RequestType.AGENT, SONNET, 20, 5,
                UUID.fromString(INSTITUTE), UUID.fromString(USER));
        verify(billing, never()).recordAndChargeAsync(any(), any(), anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void switchOnChargesAnUnbilledCall() {
        when(billing.isEnabled()).thenReturn(true);

        service.generateChatCompletion(session());

        verify(billing).recordAndChargeAsync(RequestType.AGENT, SONNET, 20, 5,
                UUID.fromString(INSTITUTE), UUID.fromString(USER), "admin_agent");
        verify(usage, never()).recordUsageAsync(any(), any(), any(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void theSessionUseCaseIsReportedToMetering() {
        when(billing.isEnabled()).thenReturn(true);
        when(resolver.resolve("workflow_draft"))
                .thenReturn(new AiModelDefaultsResolver.ModelChain("workflow_draft", List.of(SONNET), true));
        ConversationSession s = session();
        s.getContext().put(LLMService.CTX_USE_CASE, "workflow_draft");

        service.generateChatCompletion(s);

        verify(billing).recordAndChargeAsync(RequestType.AGENT, SONNET, 20, 5,
                UUID.fromString(INSTITUTE), UUID.fromString(USER), "workflow_draft");
    }

    @Test
    void aCallerWithItsOwnFlatFeeIsNeverTokenCharged() {
        when(billing.isEnabled()).thenReturn(true);
        ConversationSession s = session();
        s.getContext().put(LLMService.CTX_BILLED_BY_CALLER, Boolean.TRUE);

        service.generateChatCompletion(s);

        verify(usage).recordUsageAsync(eq(ApiProvider.OPENAI), eq(RequestType.AGENT), eq(SONNET), eq(20), eq(5),
                any(), any());
        verify(billing, never()).recordAndChargeAsync(any(), any(), anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void aCallerThatChargesTheUsageRowItselfIsLeftAlone() {
        when(usage.recordUsage(any(), any(), any(), anyInt(), anyInt(), any(), any()))
                .thenReturn(AiTokenUsage.builder().id(UUID.randomUUID()).build());
        ConversationSession s = session();
        s.getContext().put(LLMService.CTX_USAGE_LOG_SYNC, Boolean.TRUE);
        s.getContext().put(LLMService.CTX_REQUEST_TYPE, RequestType.CHATBOT);

        LLMService.LLMResponse r = service.generateChatCompletion(s);

        verify(usage).recordUsage(eq(ApiProvider.OPENAI), eq(RequestType.CHATBOT), eq(SONNET), eq(20), eq(5),
                any(), any());
        verifyNoInteractions(billing);
        assertEquals(36, r.getUsageLogId().length());
    }
}
