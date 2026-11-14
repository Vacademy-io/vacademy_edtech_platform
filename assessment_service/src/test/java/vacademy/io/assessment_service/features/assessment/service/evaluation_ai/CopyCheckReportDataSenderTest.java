package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.service.AssessmentDataEnrichmentService;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Which copy-checked attempts reach the AI analysis, and how they are tagged. */
class CopyCheckReportDataSenderTest {

    private StudentAttemptRepository attempts;
    private AssessmentDataEnrichmentService enrichment;
    private AdminCoreServiceClient adminCore;
    private JdbcTemplate jdbc;
    private CopyCheckReportDataSender sender;

    @BeforeEach
    void setUp() {
        attempts = mock(StudentAttemptRepository.class);
        enrichment = mock(AssessmentDataEnrichmentService.class);
        adminCore = mock(AdminCoreServiceClient.class);
        jdbc = mock(JdbcTemplate.class);
        sender = new CopyCheckReportDataSender(attempts, enrichment, adminCore, mock(PlatformTransactionManager.class), jdbc);
        // A copy of a bulk AI check unless a test says otherwise.
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(true);
        ReflectionTestUtils.setField(sender, "enabled", true);
        ReflectionTestUtils.setField(sender, "delaySeconds", 0L);
        when(enrichment.buildEnrichedAssessmentData(any(), anyString(), any(), any(), any(), anyInt(), any()))
                .thenAnswer(inv -> new HashMap<>(Map.of("assessmentId", "as1")));
    }

    private StudentAttempt attempt(String status, String userId) {
        Assessment assessment = new Assessment();
        assessment.setId("as1");
        assessment.setName("Biology");
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setUserId(userId);
        registration.setInstituteId("inst");
        registration.setAssessment(assessment);
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("a1");
        attempt.setStatus(status);
        attempt.setRegistration(registration);
        when(attempts.findById("a1")).thenReturn(Optional.of(attempt));
        return attempt;
    }

    @Test
    void checkOnlyCopyIsSentTaggedAsACopyCheck() {
        attempt("COPY_CHECK", "copy-check:item-1");

        Map<String, Object> data = sender.build("a1");

        assertThat(data).containsEntry("analysis_trigger", "copy_check");
    }

    @Test
    void endedAttemptIsSent() {
        attempt("ENDED", "user-1");

        assertThat(sender.build("a1")).containsEntry("analysis_trigger", "copy_check");
    }

    @Test
    void onlineTestsOwnAiMarkingIsNotSent() {
        attempt("ENDED", "user-1");
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);

        assertThat(sender.build("a1")).isNull();
    }

    @Test
    void sendNowSendsAtOnceOnTheCallersThread() {
        attempt("COPY_CHECK", "copy-check:item-1");

        assertThat(sender.sendNow("a1")).isTrue();
        verify(adminCore).saveAssessmentRawDataAsync(org.mockito.ArgumentMatchers.argThat(
                (Map<String, Object> m) -> "copy_check".equals(m.get("analysis_trigger"))));
    }

    @Test
    void sendNowSendsNothingForANormalAttempt() {
        attempt("ENDED", "user-1");
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);

        assertThat(sender.sendNow("a1")).isFalse();
        verify(adminCore, never()).saveAssessmentRawDataAsync(any());
    }

    @Test
    void liveOrPreviewAttemptIsNotSent() {
        attempt("LIVE", "user-1");
        assertThat(sender.build("a1")).isNull();

        attempt("PREVIEW", "user-1");
        assertThat(sender.build("a1")).isNull();
    }

    @Test
    void attemptWithoutALearnerIsNotSent() {
        attempt("ENDED", null);

        assertThat(sender.build("a1")).isNull();
    }

    @Test
    void failedEnrichmentIsNotSent() {
        attempt("ENDED", "user-1");
        when(enrichment.buildEnrichedAssessmentData(any(), anyString(), any(), any(), any(), anyInt(), any()))
                .thenReturn(new HashMap<>(Map.of("enrichmentError", "boom")));

        assertThat(sender.build("a1")).isNull();
    }

    @Test
    void repeatedEditsOfOneAttemptAreSentOnce() {
        attempt("ENDED", "user-1");
        ReflectionTestUtils.setField(sender, "delaySeconds", 1L);

        sender.sendAfterCommit("a1");
        sender.sendAfterCommit("a1");
        sender.sendAfterCommit("a1");

        verify(adminCore, org.mockito.Mockito.after(2500).times(1)).saveAssessmentRawDataAsync(any());
    }

    @Test
    void disabledAnalyticsSendsNothing() {
        ReflectionTestUtils.setField(sender, "enabled", false);
        attempt("ENDED", "user-1");

        sender.sendAfterCommit("a1");

        verify(adminCore, timeout(500).times(0)).saveAssessmentRawDataAsync(any());
        verify(attempts, never()).findById(eq("a1"));
    }
}
