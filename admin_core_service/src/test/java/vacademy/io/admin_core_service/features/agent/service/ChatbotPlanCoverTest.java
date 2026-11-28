package vacademy.io.admin_core_service.features.agent.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiRequest;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiResponse;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The chatbot's low-credit pause, plan-aware: the wallet first and unchanged, then the LIVE plan. */
class ChatbotPlanCoverTest {

    private LLMService llm;
    private CreditClient credits;
    private ChatbotAiService service;

    @BeforeEach
    void setUp() throws Exception {
        llm = mock(LLMService.class);
        credits = mock(CreditClient.class);
        service = new ChatbotAiService(llm, credits);
        when(llm.generateChatCompletion(any())).thenReturn(LLMService.LLMResponse.builder()
                .content("Hello!").modelUsed("m").promptTokens(3).completionTokens(4).build());
    }

    private ChatbotAiRequest request() {
        return ChatbotAiRequest.builder().instituteId("inst-1").userId("u-1").flowId("f-1")
                .systemPrompt("x".repeat(400)).userMessage("hi").maxTokens(300).build();
    }

    @Test
    void aFundedWalletNeverAsksThePlan() {
        when(credits.hasActiveCredits("inst-1")).thenReturn(true);
        assertEquals("Hello!", service.respond(request()).getAssistantMessage());
        verify(credits, never()).planCovers(any(), any(), any(), anyInt(), any(), any());
    }

    @Test
    void anEmptyWalletWithoutPlanCoverPausesAsToday() throws Exception {
        when(credits.hasActiveCredits("inst-1")).thenReturn(false);
        // mock default: planCovers false (also what CreditClient answers with no LIVE plan / any failure)
        ChatbotAiResponse r = service.respond(request());
        assertTrue(r.isInsufficientCredits());
        assertFalse(r.isUsageLimited());
        verify(llm, never()).generateChatCompletion(any());
    }

    @Test
    void anEmptyWalletCoveredByTheLivePlanReplies() throws Exception {
        when(credits.hasActiveCredits("inst-1")).thenReturn(false);
        when(credits.planCovers(eq("inst-1"), eq("chatbot"), isNull(), anyInt(), eq("u-1"),
                argThat((MeteringFields m) -> "chatbot_flow".equals(m.useCase()) && "LEARNER".equals(m.actorRoleClass()))))
                .thenReturn(true);
        ChatbotAiResponse r = service.respond(request());
        assertEquals("Hello!", r.getAssistantMessage());
        assertFalse(r.isInsufficientCredits());
        verify(llm).generateChatCompletion(any());
    }

    @Test
    void aGateExceptionStillPauses() throws Exception {
        when(credits.hasActiveCredits("inst-1")).thenReturn(false);
        when(credits.planCovers(any(), any(), any(), anyInt(), any(), any())).thenThrow(new RuntimeException("boom"));
        assertTrue(service.respond(request()).isInsufficientCredits());
        verify(llm, never()).generateChatCompletion(any());
    }

    @Test
    void theEstimateCountsPromptHistoryAndReply() {
        ChatbotAiRequest r = ChatbotAiRequest.builder().systemPrompt("x".repeat(400)).userMessage("y".repeat(40))
                .conversationHistory(List.of(Map.of("role", "user", "content", "z".repeat(160))))
                .maxTokens(300).build();
        assertEquals(400 / 4 + 40 / 4 + 160 / 4 + 300, ChatbotAiService.estimateTokens(r));
        assertEquals(500, ChatbotAiService.estimateTokens(ChatbotAiRequest.builder().build()),
                "default reply ceiling");
    }
}
