package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentRegistrationCustomFieldRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Only a PUBLIC test's public-link registrants reach its lead list, with their form answers. */
class OpenAssessmentLeadPublisherTest {

    private OpenAssessmentLeadPublisher publisher;
    private OpenAssessmentLeadClient client;

    @BeforeEach
    void setUp() {
        client = mock(OpenAssessmentLeadClient.class);
        publisher = new OpenAssessmentLeadPublisher();
        publisher.client = client;
    }

    private static AssessmentCustomField field(String id, String key, String name, int order) {
        return AssessmentCustomField.builder().id(id).fieldKey(key).fieldName(name).fieldOrder(order).build();
    }

    private static Assessment test(String visibility) {
        Assessment a = new Assessment();
        a.setId("test-1");
        a.setName("Admission Test Class 6");
        a.setAssessmentVisibility(visibility);
        a.setBatchRegistrations(new HashSet<>());
        a.setAssessmentCustomFields(new LinkedHashSet<>(List.of(
                field("f-name", "full_name", "Full Name", 0),
                field("f-email", "email", "Email", 1),
                field("f-phone", "phone_number", "Phone Number", 2),
                field("f-parent", "parent_name", "Parent Name", 4),
                field("f-class", "class", "Class", 3))));
        return a;
    }

    private static AssessmentUserRegistration registration(Assessment test, String source) {
        AssessmentUserRegistration r = new AssessmentUserRegistration();
        r.setId("reg-1");
        r.setUserId("user-1");
        r.setInstituteId("inst-1");
        r.setParticipantName("Asha Rao");
        r.setUserEmail("asha@example.com");
        r.setPhoneNumber("+919876543210");
        r.setSource(source);
        r.setAssessment(test);
        r.setStudentAttempts(new HashSet<>());
        return r;
    }

    private static AssessmentRegistrationCustomFieldRequest answer(String fieldId, String value) {
        AssessmentRegistrationCustomFieldRequest a = new AssessmentRegistrationCustomFieldRequest();
        a.setAssessmentCustomFieldId(fieldId);
        a.setAnswer(value);
        return a;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> sent(String action) {
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(client).send(eq(action), body.capture());
        return body.getValue();
    }

    @Test
    void registrationSendsTheRegistrantAndTheirFormAnswersInFormOrder() {
        Assessment t = test("PUBLIC");

        publisher.registered(registration(t, "OPEN_REGISTRATION"), t, List.of(
                answer("f-parent", "Ravi Rao"),
                answer("f-name", "Asha Rao"),
                answer("f-phone", "9876543210"),
                answer("f-class", "6"),
                answer("f-unknown", "x"),
                answer("f-email", "")));

        Map<String, Object> body = sent("registration");
        assertEquals("inst-1", body.get("instituteId"));
        assertEquals("test-1", body.get("assessmentId"));
        assertEquals("Admission Test Class 6", body.get("assessmentName"));
        assertEquals("user-1", body.get("userId"));
        assertEquals("asha@example.com", body.get("email"));
        assertEquals("+919876543210", body.get("mobileNumber"));
        assertEquals(List.of(
                Map.of("fieldName", "Class", "value", "6"),
                Map.of("fieldName", "Parent Name", "value", "Ravi Rao")), body.get("answers"));
    }

    @Test
    void aPrivateTestSendsNothing() {
        Assessment t = test("PRIVATE");

        publisher.registered(registration(t, "OPEN_REGISTRATION"), t, List.of());
        publisher.resultReleased(attemptOf(t), t, "inst-1", Map.of("marks", 1.0));

        verifyNoInteractions(client);
    }

    @Test
    void anApiExamSendsNothing() {
        Assessment t = test("PUBLIC");
        t.setSource("API");

        publisher.registered(registration(t, "OPEN_REGISTRATION"), t, List.of());
        publisher.resultReleased(attemptOf(t), t, "inst-1", Map.of("marks", 1.0));

        verifyNoInteractions(client);
    }

    private static StudentAttempt attemptOf(Assessment t) {
        StudentAttempt a = new StudentAttempt();
        a.setId("att-1");
        a.setRegistration(registration(t, "OPEN_REGISTRATION"));
        return a;
    }

    @Test
    void resultIsSentOnlyForPublicLinkRegistrants() {
        Assessment t = test("PUBLIC");
        StudentAttempt batchLearner = new StudentAttempt();
        batchLearner.setRegistration(registration(t, "BATCH_PREVIEW_REGISTRATION"));

        publisher.resultReleased(batchLearner, t, "inst-1", Map.of("marks", 56.0));

        verifyNoInteractions(client);
    }

    @Test
    void releasingAResultSendsTheMarksThroughTheWorkflowPublisher() {
        Assessment t = test("PUBLIC");
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setTotalMarks(56.0);
        attempt.setRegistration(registration(t, "OPEN_REGISTRATION"));

        AssessmentWorkflowEventPublisher events = new AssessmentWorkflowEventPublisher();
        events.workflowTriggerClient = mock(WorkflowTriggerClient.class);
        events.contextBuilder = new AssessmentTriggerContextBuilder();
        events.sectionRepository = mock(SectionRepository.class);
        events.openAssessmentLeadPublisher = publisher;

        events.publishResultReleased(attempt, null, null);
        events.publishResultReleased(List.of(attempt));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(client, times(2)).send(eq("result"), body.capture());
        body.getAllValues().forEach(b -> {
            assertEquals(56.0, b.get("marks"));
            assertEquals("user-1", b.get("userId"));
            assertEquals("test-1", b.get("assessmentId"));
        });
        verify(events.workflowTriggerClient, times(2))
                .triggerEvent(eq("ASSESSMENT_RESULT_RELEASED"), anyString(), anyString(), any());
    }
}
