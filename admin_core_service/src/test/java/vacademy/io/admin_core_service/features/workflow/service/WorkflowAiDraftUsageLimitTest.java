package vacademy.io.admin_core_service.features.workflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.workflow.controller.WorkflowAiCatalogController;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowAiDraftRequest;
import vacademy.io.admin_core_service.features.workflow.dto.WorkflowAiDraftResponse;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The workflow builder's AI draft under an AI usage limit. */
class WorkflowAiDraftUsageLimitTest {

    private LLMService llm;
    private CreditClient credits;
    private WorkflowAiDraftService service;

    @BeforeEach
    void setUp() {
        llm = mock(LLMService.class);
        credits = mock(CreditClient.class);
        WorkflowAiCatalogController catalog = mock(WorkflowAiCatalogController.class);
        when(catalog.getAiCatalog()).thenReturn(ResponseEntity.ok(Map.of("version", "t")));
        service = new WorkflowAiDraftService(catalog, llm, mock(WorkflowValidationService.class), new ObjectMapper(),
                mock(TemplateRepository.class), credits);
        ReflectionTestUtils.setField(service, "rateLimitPerHour", 30);
        ReflectionTestUtils.setField(service, "draftMaxTokens", 16000);
    }

    private static WorkflowAiDraftRequest request() {
        WorkflowAiDraftRequest r = new WorkflowAiDraftRequest();
        r.setInstituteId("inst-1");
        r.setGoal("Send a welcome email when a learner enrols");
        return r;
    }

    @Test
    void aBlockReturnsTheLimitMessageWithoutCallingTheModel() {
        when(credits.authorize(eq("inst-1"), eq("workflow_draft"), eq("agent"),
                argThat(m -> "USER".equals(m.actorKind())), eq("admin-1")))
                .thenReturn(new AuthorizeResult(false, "BLOCK",
                        Map.of("message", "You've reached this month's limit for Workflow builder AI draft.")));

        WorkflowAiDraftResponse r = service.draft(request(), "admin-1");

        assertEquals("You've reached this month's limit for Workflow builder AI draft.", r.getError());
        verify(llm, never()).generateChatCompletion(any());
    }

    @Test
    void noLimitsReachTheModelAsToday() {
        // mock default null, then NONE: both proceed to the model (which answers nothing here)
        WorkflowAiDraftResponse first = service.draft(request(), "admin-1");
        when(credits.authorize(any(), any(), any(), any(), any())).thenReturn(AuthorizeResult.ALLOW_NONE);
        WorkflowAiDraftResponse second = service.draft(request(), "admin-1");

        assertEquals("AI returned an empty response.", first.getError());
        assertEquals("AI returned an empty response.", second.getError());
        verify(llm, org.mockito.Mockito.times(2)).generateChatCompletion(any());
    }

    @Test
    void buildModeNeverAsks() {
        WorkflowAiDraftRequest r = request();
        r.setMode("BUILD");
        try {
            service.draft(r, "admin-1");
        } catch (RuntimeException ignored) {
            // BUILD without a skeleton may fail on its own; only the gate matters here
        }
        verify(credits, never()).authorize(any(), any(), any(), any(), any());
    }
}
