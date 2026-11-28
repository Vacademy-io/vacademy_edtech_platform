package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentBatchRegistration;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;

import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the contextData map carried by every assessment workflow trigger.
 *
 * What matters here is the contract an admin depends on when they pick a token in the
 * trigger config UI:
 *   - keys are flat and pre-computed (the engine's SpEL cannot flatten or divide)
 *   - null values are omitted rather than emitted as null
 *   - a broken/detached entity costs one key, never the whole map
 */
class AssessmentTriggerContextBuilderTest {

    private final AssessmentTriggerContextBuilder builder = new AssessmentTriggerContextBuilder();

    private static final Date START = new Date(1_700_000_000_000L);
    private static final Date END = new Date(1_700_003_600_000L);

    private Assessment assessment() {
        Assessment assessment = new Assessment();
        assessment.setId("asmt-1");
        assessment.setName("Physics Unit Test");
        assessment.setAssessmentType("EXAM");
        assessment.setPlayMode("EXAM");
        assessment.setEvaluationType("AUTO");
        assessment.setStatus("PUBLISHED");
        assessment.setResultType("AUTO_AFTER_SUBMISSION");
        assessment.setBoundStartTime(START);
        assessment.setBoundEndTime(END);
        assessment.setDuration(60);
        return assessment;
    }

    private AssessmentUserRegistration registration(Assessment assessment) {
        AssessmentUserRegistration registration = new AssessmentUserRegistration();
        registration.setId("reg-1");
        registration.setAssessment(assessment);
        registration.setUserId("user-1");
        registration.setInstituteId("inst-1");
        registration.setParticipantName("Asha Rao");
        registration.setUserEmail("asha@example.com");
        registration.setPhoneNumber("9990001111");
        registration.setUsername("asha");
        return registration;
    }

    private StudentAttempt attempt(AssessmentUserRegistration registration) {
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setRegistration(registration);
        attempt.setAttemptNumber(2);
        attempt.setStatus("ENDED");
        attempt.setStartTime(START);
        attempt.setSubmitTime(END);
        attempt.setTotalTimeInSeconds(2400L);
        return attempt;
    }

    private void addBatch(Assessment assessment, String... batchIds) {
        Set<AssessmentBatchRegistration> registrations = new LinkedHashSet<>();
        for (String batchId : batchIds) {
            AssessmentBatchRegistration batchRegistration = new AssessmentBatchRegistration();
            batchRegistration.setId("bReg-" + batchId);
            batchRegistration.setBatchId(batchId);
            registrations.add(batchRegistration);
        }
        assessment.setBatchRegistrations(registrations);
    }

    // ------------------------------------------------------------------ forAssessment

    @Test
    void forAssessment_emitsTheAssessmentLayer() {
        Map<String, Object> ctx = builder.forAssessment(assessment(), "inst-1");

        assertThat(ctx).containsEntry("instituteId", "inst-1")
                .containsEntry("assessmentId", "asmt-1")
                .containsEntry("assessmentName", "Physics Unit Test")
                .containsEntry("assessmentType", "EXAM")
                .containsEntry("playMode", "EXAM")
                .containsEntry("evaluationType", "AUTO")
                .containsEntry("assessmentStatus", "PUBLISHED")
                .containsEntry("resultType", "AUTO_AFTER_SUBMISSION")
                .containsEntry("durationMinutes", 60);
    }

    @Test
    void forAssessment_formatsDatesAsIsoInstants() {
        Map<String, Object> ctx = builder.forAssessment(assessment(), "inst-1");

        assertThat(ctx.get("boundStartTime")).isEqualTo("2023-11-14T22:13:20Z");
        assertThat(ctx.get("boundEndTime")).isEqualTo("2023-11-14T23:13:20Z");
    }

    @Test
    void forAssessment_omitsNullsRatherThanEmittingThem() {
        Assessment sparse = new Assessment();
        sparse.setId("asmt-2");

        Map<String, Object> ctx = builder.forAssessment(sparse, "inst-1");

        assertThat(ctx).containsEntry("assessmentId", "asmt-2")
                .doesNotContainKey("assessmentName")
                .doesNotContainKey("boundStartTime")
                .doesNotContainKey("durationMinutes");
    }

    @Test
    void forAssessment_survivesANullAssessment() {
        Map<String, Object> ctx = builder.forAssessment(null, "inst-1");

        assertThat(ctx).containsExactly(Map.entry("instituteId", "inst-1"));
    }

    @Test
    void forAssessment_emitsSingularBatchKeysForASingleBatchAssessment() {
        Assessment assessment = assessment();
        addBatch(assessment, "batch-9");

        Map<String, Object> ctx = builder.forAssessment(assessment, "inst-1");

        // batchId and packageSessionId are the same value under both names it is known by.
        assertThat(ctx).containsEntry("batchId", "batch-9")
                .containsEntry("packageSessionId", "batch-9");
        assertThat(ctx.get("batchIds")).isEqualTo(java.util.List.of("batch-9"));
    }

    @Test
    void forAssessment_omitsSingularBatchKeysWhenThereAreMany() {
        Assessment assessment = assessment();
        addBatch(assessment, "batch-1", "batch-2");

        Map<String, Object> ctx = builder.forAssessment(assessment, "inst-1");

        assertThat(ctx.get("batchIds")).isEqualTo(java.util.List.of("batch-1", "batch-2"));
        assertThat(ctx).doesNotContainKey("batchId")
                .doesNotContainKey("packageSessionId");
    }

    // ------------------------------------------------------------------ forAttempt

    @Test
    void forAttempt_layersAttemptAndLearnerOnTopOfTheAssessment() {
        Assessment assessment = assessment();
        Map<String, Object> ctx = builder.forAttempt(attempt(registration(assessment)), assessment, "inst-1");

        assertThat(ctx).containsEntry("assessmentId", "asmt-1")
                .containsEntry("attemptId", "att-1")
                .containsEntry("attemptNumber", 2)
                .containsEntry("attemptStatus", "ENDED")
                .containsEntry("totalTimeInSeconds", 2400L)
                .containsEntry("registrationId", "reg-1")
                .containsEntry("userId", "user-1")
                .containsEntry("studentName", "Asha Rao")
                .containsEntry("studentEmail", "asha@example.com")
                .containsEntry("studentMobile", "9990001111")
                .containsEntry("username", "asha");
    }

    @Test
    void forAttempt_prefersTheLearnersOwnBatchOverTheAssessmentLevelList() {
        Assessment assessment = assessment();
        addBatch(assessment, "assessment-batch");

        AssessmentUserRegistration registration = registration(assessment);
        registration.setSource(UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name());
        registration.setSourceId("learner-batch");

        Map<String, Object> ctx = builder.forAttempt(attempt(registration), assessment, "inst-1");

        // A per-learner workflow must scope on the batch the learner actually sat in.
        assertThat(ctx).containsEntry("batchId", "learner-batch")
                .containsEntry("packageSessionId", "learner-batch");
    }

    @Test
    void forAttempt_doesNotOverrideTheBatchForNonBatchRegistrations() {
        Assessment assessment = assessment();
        addBatch(assessment, "assessment-batch");

        AssessmentUserRegistration registration = registration(assessment);
        registration.setSource(UserRegistrationSources.OPEN_REGISTRATION.name());
        registration.setSourceId("some-user-id");

        Map<String, Object> ctx = builder.forAttempt(attempt(registration), assessment, "inst-1");

        assertThat(ctx).containsEntry("batchId", "assessment-batch");
    }

    @Test
    void forAttempt_prefersTheRegistrationsInstituteOverTheCallers() {
        Assessment assessment = assessment();
        AssessmentUserRegistration registration = registration(assessment);
        registration.setInstituteId("inst-specific");

        Map<String, Object> ctx = builder.forAttempt(attempt(registration), assessment, null);

        assertThat(ctx).containsEntry("instituteId", "inst-specific");
    }

    @Test
    void forAttempt_survivesANullAttempt() {
        Assessment assessment = assessment();
        Map<String, Object> ctx = builder.forAttempt(null, assessment, "inst-1");

        assertThat(ctx).containsEntry("assessmentId", "asmt-1")
                .doesNotContainKey("attemptId");
    }

    @Test
    void forAttempt_survivesAnAttemptWithNoRegistration() {
        Assessment assessment = assessment();
        StudentAttempt orphan = new StudentAttempt();
        orphan.setId("att-orphan");

        Map<String, Object> ctx = builder.forAttempt(orphan, assessment, "inst-1");

        assertThat(ctx).containsEntry("attemptId", "att-orphan")
                .doesNotContainKey("studentName");
    }

    // ------------------------------------------------------------------ forResult

    @Test
    void forResult_computesPercentageSoSpELDoesNotHaveTo() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));
        attempt.setResultMarks(37.5);

        Map<String, Object> ctx = builder.forResult(attempt, assessment, "inst-1", 50.0, 3, 88.5);

        assertThat(ctx).containsEntry("marks", 37.5)
                .containsEntry("totalMarks", 50.0)
                .containsEntry("percentage", 75.0)
                .containsEntry("rank", 3)
                .containsEntry("percentile", 88.5);
    }

    @Test
    void forResult_carriesTheCheckedCopySoAnAutomationCanSendIt() {
        // A manual-result test has no generated report: the AI-annotated (or
        // teacher-uploaded) copy is the only document a learner receives.
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));
        attempt.setEvaluatedFileId("copy-file-9");
        attempt.setReportPdfFileId(null);

        Map<String, Object> ctx = builder.forResult(attempt, assessment, "inst-1", 80.0, null, null);

        assertThat(ctx).containsEntry("checkedCopyFileId", "copy-file-9");
        assertThat(ctx).doesNotContainKey("reportPdfFileId");
    }

    @Test
    void forResult_roundsPercentageToTwoDecimals() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));
        attempt.setResultMarks(1.0);

        Map<String, Object> ctx = builder.forResult(attempt, assessment, "inst-1", 3.0, null, null);

        assertThat(ctx).containsEntry("percentage", 33.33);
    }

    @Test
    void forResult_fallsBackToTotalMarksWhenResultMarksAreUnset() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));
        attempt.setTotalMarks(20.0);

        Map<String, Object> ctx = builder.forResult(attempt, assessment, "inst-1", 40.0, null, null);

        assertThat(ctx).containsEntry("marks", 20.0)
                .containsEntry("percentage", 50.0);
    }

    @Test
    void forResult_omitsPercentageWhenTheTotalIsUnknownOrZero() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));
        attempt.setResultMarks(10.0);

        assertThat(builder.forResult(attempt, assessment, "inst-1", null, null, null))
                .doesNotContainKey("percentage");
        assertThat(builder.forResult(attempt, assessment, "inst-1", 0.0, null, null))
                .doesNotContainKey("percentage");
    }

    @Test
    void forResult_omitsRankAndPercentileWhenNotComputed() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));

        Map<String, Object> ctx = builder.forResult(attempt, assessment, "inst-1", 50.0, null, null);

        assertThat(ctx).doesNotContainKey("rank").doesNotContainKey("percentile");
    }

    // ------------------------------------------------------------------ forEvaluation

    @Test
    void forEvaluation_addsGradingProvenanceToTheAttemptLayer() {
        Assessment assessment = assessment();
        StudentAttempt attempt = attempt(registration(assessment));

        Map<String, Object> ctx = builder.forEvaluation(attempt, assessment, "inst-1", "AI", "proc-7", 1, 4);

        assertThat(ctx).containsEntry("attemptId", "att-1")
                .containsEntry("evaluationSource", "AI")
                .containsEntry("processId", "proc-7")
                .containsEntry("failedCount", 1)
                .containsEntry("lowConfidenceCount", 4);
    }
}
