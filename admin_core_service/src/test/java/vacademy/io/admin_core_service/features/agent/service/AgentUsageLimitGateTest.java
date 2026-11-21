package vacademy.io.admin_core_service.features.agent.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.agent.dto.AgentChatRequest;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiRequest;
import vacademy.io.admin_core_service.features.agent.dto.ChatbotAiResponse;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The AI usage-limit gate in the chatbot turn and the admin agent loop. */
class AgentUsageLimitGateTest {

    static final AuthorizeResult BLOCKED = new AuthorizeResult(false, "BLOCK", Map.of(
            "error", "AI_USAGE_LIMIT", "message", "You've reached today's limit for Admin AI agent."));
    static final AuthorizeResult OK = new AuthorizeResult(true, "OK", null);

    @Nested
    class Chatbot {
        private LLMService llm;
        private CreditClient credits;
        private ChatbotAiService service;

        @BeforeEach
        void setUp() throws Exception {
            llm = mock(LLMService.class);
            credits = mock(CreditClient.class);
            service = new ChatbotAiService(llm, credits);
            when(credits.hasActiveCredits("inst-1")).thenReturn(true);
            when(llm.generateChatCompletion(any())).thenReturn(LLMService.LLMResponse.builder()
                    .content("Hello!").modelUsed("m").promptTokens(3).completionTokens(4).build());
        }

        private ChatbotAiRequest request() {
            return ChatbotAiRequest.builder().instituteId("inst-1").userId("u-1").flowId("f-1")
                    .userMessage("hi").build();
        }

        @Test
        void noLimitsOrAMockedNullAnswerChangeNothing() throws Exception {
            // mock default: authorize returns null
            ChatbotAiResponse r = service.respond(request());
            assertEquals("Hello!", r.getAssistantMessage());
            assertFalse(r.isInsufficientCredits());

            when(credits.authorize(anyString(), anyString(), any(), any(), any()))
                    .thenReturn(AuthorizeResult.ALLOW_NONE).thenReturn(OK);
            assertEquals("Hello!", service.respond(request()).getAssistantMessage());
            assertEquals("Hello!", service.respond(request()).getAssistantMessage());
        }

        @Test
        void aBlockTakesTheLowCreditPausePathWithoutCallingTheModel() throws Exception {
            when(credits.authorize(eq("inst-1"), eq("chatbot_flow"), eq("chatbot"), any(MeteringFields.class),
                    eq("u-1"))).thenReturn(BLOCKED);

            ChatbotAiResponse r = service.respond(request());

            assertTrue(r.isInsufficientCredits(), "same pause as an empty wallet");
            assertTrue(r.isUsageLimited(), "but marked as a usage limit, not an empty wallet");
            assertEquals(BLOCKED.message(), r.getUsageLimitMessage());
            assertFalse(r.isExitIntent());
            verify(llm, never()).generateChatCompletion(any());
        }

        @Test
        void theCreditCheckStillRunsFirstAndUnchanged() throws Exception {
            when(credits.hasActiveCredits("inst-1")).thenReturn(false);
            ChatbotAiResponse r = service.respond(request());
            assertTrue(r.isInsufficientCredits());
            assertFalse(r.isUsageLimited(), "an empty wallet is not a usage limit");
            verify(credits, never()).authorize(any(), any(), any(), any(), any());
        }
    }

    @Nested
    class AdminAgent {
        private LLMService llm;
        private VectorSearchService vectors;
        private ConversationManager conversations;
        private CreditClient credits;
        private AgentOrchestrator orchestrator;
        private ConversationSession session;

        @BeforeEach
        void setUp() {
            llm = mock(LLMService.class);
            vectors = mock(VectorSearchService.class);
            conversations = mock(ConversationManager.class);
            credits = mock(CreditClient.class);
            orchestrator = new AgentOrchestrator(llm, vectors, mock(ToolExecutor.class), conversations, credits);
            session = ConversationSession.create("s-1", "admin-1", "inst-1", null, "tok");
            when(conversations.createSession(eq("admin-1"), eq("inst-1"), isNull(), eq("tok"))).thenReturn(session);
            when(vectors.searchRelevantTools(anyString())).thenReturn(List.of());
        }

        private void start() {
            orchestrator.startChat(AgentChatRequest.builder().instituteId("inst-1").message("list my courses").build(),
                    "admin-1", "tok");
        }

        @Test
        void aBlockShowsTheLimitMessageAndWaitsWithoutAModelCall() throws Exception {
            when(credits.authorize(eq("inst-1"), eq("admin_agent"), eq("agent"), any(MeteringFields.class),
                    eq("admin-1"))).thenReturn(BLOCKED);

            start();

            verify(conversations, timeout(5000)).setAwaitingInput(session);
            verify(conversations).addAssistantMessage(session, "You've reached today's limit for Admin AI agent.");
            verify(llm, never()).generateChatCompletion(any());
        }

        @Test
        void allowedTurnsReachTheModelAsToday() throws Exception {
            when(credits.authorize(any(), any(), any(), any(), any())).thenReturn(OK);
            when(llm.generateChatCompletion(any())).thenReturn(LLMService.LLMResponse.builder()
                    .content("Here they are.").finishReason("stop").build());

            start();

            verify(llm, timeout(5000)).generateChatCompletion(session);
            verify(conversations, timeout(5000)).completeSession(session);
            verify(conversations, after(200).never())
                    .addAssistantMessage(eq(session), argThat(m -> m.contains("limit")));
        }

        @Test
        void theTurnIsAttributedToTheSignedInAdmin() {
            session.getContext().put(LLMService.CTX_USE_CASE, "admin_agent");
            when(credits.authorize(any(), any(), any(), any(), any())).thenReturn(OK);
            orchestrator.authorizeTurn(session);
            verify(credits).authorize(eq("inst-1"), eq("admin_agent"), eq("agent"),
                    argThat(m -> "USER".equals(m.actorKind()) && "ADMIN_APP".equals(m.surface())), eq("admin-1"));
        }

        @Test
        void aGateExceptionIsAllowed() {
            when(credits.authorize(any(), any(), any(), any(), any())).thenThrow(new RuntimeException("boom"));
            assertTrue(orchestrator.authorizeTurn(session).allow());
        }
    }
}
