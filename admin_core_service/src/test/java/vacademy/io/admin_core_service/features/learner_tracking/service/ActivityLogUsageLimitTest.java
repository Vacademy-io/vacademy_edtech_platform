package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogProcessingProjection;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;

import java.time.LocalDateTime;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Learner analytics under an AI usage limit: a SYSTEM job that skips the learner on BLOCK. */
class ActivityLogUsageLimitTest {

    private static final String INSIGHTS = """
            {"performance_analysis":"ok","weaknesses":[],"strengths":[],"areas_of_improvement":[],
             "improvement_path":"x","flashcards":[]}""";

    private ActivityLogRepository repo;
    private StudentAnalyticsLLMService llm;
    private CreditClient credits;
    private ActivityLogProcessorService service;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() throws Exception {
        repo = mock(ActivityLogRepository.class);
        llm = mock(StudentAnalyticsLLMService.class);
        credits = mock(CreditClient.class);
        service = new ActivityLogProcessorService(repo, llm, mapper, credits, mock(ActivityLogQueueClaimService.class));
        when(llm.getPrimaryAnalyticsModel()).thenReturn("m");
        when(credits.checkCredits(anyString(), anyString(), any(), anyInt(), any(MeteringFields.class)))
                .thenReturn(true);
        when(llm.generateStudentInsights(anyString(), any(), any(), any()))
                .thenReturn(Mono.just(mapper.readTree(INSIGHTS)));
    }

    private static ActivityLogProcessingProjection log(String id) {
        return new ActivityLogProcessingProjection() {
            public String getId() { return id; }
            public String getUserId() { return "learner-1"; }
            public String getSourceType() { return "ASSESSMENT"; }
            public String getRawJson() { return "{\"instituteId\":\"inst-1\",\"score\":3}"; }
            public String getProcessedJson() { return null; }
            public String getStatus() { return "processing"; }
            public LocalDateTime getCreatedAt() { return LocalDateTime.now(); }
        };
    }

    @Test
    void noLimitsMeansTodaysPath() {
        // mock default (null) and an explicit NONE both run the LLM and store the insights
        service.processActivityLog(log("l-1"));
        when(credits.authorize(any(), any(), any(), any(), any())).thenReturn(AuthorizeResult.ALLOW_NONE);
        service.processActivityLog(log("l-2"));

        verify(repo).updateProcessedData(eq("l-1"), anyString(), eq("processed"));
        verify(repo).updateProcessedData(eq("l-2"), anyString(), eq("processed"));
    }

    @Test
    void aBlockSkipsTheLearnerWithoutCallingTheModel() {
        when(credits.authorize(eq("inst-1"), eq("learner_analytics"), eq("analytics"),
                argThat(m -> m != null && "SYSTEM".equals(m.actorKind()) && "learner-1".equals(m.subjectUserId())),
                isNull()))
                .thenReturn(new AuthorizeResult(false, "BLOCK", Map.of("error", "AI_USAGE_LIMIT")));

        service.processActivityLog(log("l-3"));

        verify(llm, never()).generateStudentInsights(anyString(), any(), any(), any());
        verify(repo).updateProcessedData("l-3", null, ActivityLogProcessorService.STATUS_SKIPPED_USAGE_LIMIT);
    }

    @Test
    void anOutOfCreditInstituteIsStillSkippedAsTodayBeforeTheGate() {
        when(credits.checkCredits(anyString(), anyString(), any(), anyInt(), any(MeteringFields.class)))
                .thenReturn(false);

        service.processActivityLog(log("l-4"));

        verify(repo).updateProcessedData("l-4", null, "skipped_no_credits");
        verify(credits, never()).authorize(any(), any(), any(), any(), any());
    }
}
