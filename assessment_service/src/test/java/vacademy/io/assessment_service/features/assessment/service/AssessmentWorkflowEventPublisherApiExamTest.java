package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiInstituteFlags;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.HashSet;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Partner-API exams fire no institute workflow event unless the institute opted in
 * (spec 12 item 6); dashboard exams are untouched; the context names the source (item 7).
 */
class AssessmentWorkflowEventPublisherApiExamTest {

    private static final String INSTITUTE = "inst-1";

    private AssessmentWorkflowEventPublisher publisher;
    private WorkflowTriggerClient client;
    private ApiInstituteFlags flags;

    @BeforeEach
    void setUp() {
        client = mock(WorkflowTriggerClient.class);
        flags = new ApiInstituteFlags();
        publisher = new AssessmentWorkflowEventPublisher();
        publisher.workflowTriggerClient = client;
        publisher.contextBuilder = new AssessmentTriggerContextBuilder();
        publisher.sectionRepository = mock(SectionRepository.class);
        publisher.apiInstituteFlags = flags;
    }

    private static Assessment exam(String source) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setName("Science");
        a.setSource(source);
        a.setBatchRegistrations(new HashSet<>());
        return a;
    }

    private static StudentAttempt attemptOn(Assessment exam) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId("r1");
        r.setUserId("apic_1");
        r.setInstituteId(INSTITUTE);
        r.setAssessment(exam);
        r.setStudentAttempts(new HashSet<>());
        StudentAttempt a = new StudentAttempt();
        a.setId("att1");
        a.setRegistration(r);
        return a;
    }

    @Test
    void api_exam_events_are_suppressed_without_opt_in() {
        Assessment api = exam("API");

        publisher.publishAssessmentCreated(api, INSTITUTE, "apikey:k1");
        publisher.publishAssessmentPublished(api, INSTITUTE, "apikey:k1");
        publisher.publishAssessmentEnd(attemptOn(api), null);
        publisher.publishResultReleased(attemptOn(api), null, null);
        publisher.publishResultReleased(List.of(attemptOn(api)));
        publisher.publishAiEvaluationBatchCompleted(api, INSTITUTE, null, Map.of());

        verify(client, never()).triggerEvent(anyString(), anyString(), anyString(), any());
    }

    @Test
    void api_exam_events_fire_when_the_institute_opted_in_and_carry_the_source() {
        flags.record(ApiKeyPrincipal.builder().keyId("k1").instituteId(INSTITUTE).fireWorkflowEvents(true).build());

        publisher.publishAssessmentCreated(exam("API"), INSTITUTE, "apikey:k1");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> ctx = ArgumentCaptor.forClass(Map.class);
        verify(client).triggerEvent(eq(AssessmentWorkflowEventPublisher.ASSESSMENT_CREATE), eq("a1"), eq(INSTITUTE),
                ctx.capture());
        assertThat(ctx.getValue()).containsEntry("assessmentSource", "API");
    }

    @Test
    void dashboard_exams_are_never_suppressed() {
        publisher.publishAssessmentCreated(exam(null), INSTITUTE, "u1");
        publisher.publishResultReleased(attemptOn(exam(null)), null, null);

        verify(client).triggerEvent(eq(AssessmentWorkflowEventPublisher.ASSESSMENT_CREATE), eq("a1"), eq(INSTITUTE), any());
        verify(client).triggerEvent(eq(AssessmentWorkflowEventPublisher.ASSESSMENT_RESULT_RELEASED), eq("a1"),
                eq(INSTITUTE), any());
    }

    @Test
    void without_the_flags_bean_api_exams_stay_quiet() {
        publisher.apiInstituteFlags = null;
        publisher.publishAssessmentPublished(exam("API"), INSTITUTE, "apikey:k1");
        verify(client, never()).triggerEvent(anyString(), anyString(), anyString(), any());
    }
}
