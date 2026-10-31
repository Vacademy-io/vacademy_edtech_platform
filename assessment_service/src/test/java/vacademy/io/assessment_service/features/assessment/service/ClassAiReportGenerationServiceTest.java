package vacademy.io.assessment_service.features.assessment.service;

import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentClassAiAnalysis;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentClassAiAnalysisRepository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The billing behaviour of the class AI report.
 *
 * <p>These are the cases where a mistake costs somebody real money — either the
 * institute being charged for nothing, or Vacademy making an unpaid model call.
 */
class ClassAiReportGenerationServiceTest {

    private static final String A = "assessment-1";
    private static final String I = "institute-1";
    private static final BigDecimal TEN = new BigDecimal("10");

    private AssessmentClassAiAnalysis row(String id) {
        return AssessmentClassAiAnalysis.builder()
                .id(id).assessmentId(A).instituteId(I)
                .status(AssessmentClassAiAnalysis.STATUS_GENERATING)
                .idempotencyKey("assessment_class_ai_report:" + id)
                .chargeStatus(AssessmentClassAiAnalysis.CHARGE_PENDING)
                .generatedByUserId("admin-1")
                .build();
    }

    @Test
    void aSecondConcurrentClaimIsRefused_soOnlyOneModelCallHappens() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        // 0 rows inserted = the unique index rejected it; someone else won.
        when(repo.claim(anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(0);

        Optional<AssessmentClassAiAnalysis> claimed =
                new ClassAiReportGenerationService(repo, mock(AiServiceCreditClient.class))
                        .claim(A, I, "admin-2", TEN, false);

        assertThat(claimed).isEmpty();
    }

    @Test
    void theIdempotencyKeyIsTheRowId_notTheAssessmentId() {
        // Keyed on the assessment, ai_service would short-circuit every later
        // paid regenerate to zero credits while the model call still happened.
        AssessmentClassAiAnalysis r = row("row-abc");
        assertThat(r.getIdempotencyKey()).isEqualTo("assessment_class_ai_report:row-abc");
        assertThat(r.getIdempotencyKey()).doesNotContain(A);
    }

    @Test
    void chargeRecordsSuccess() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        AiServiceCreditClient credits = mock(AiServiceCreditClient.class);
        when(credits.charge(anyString(), anyString(), anyString(), any())).thenReturn(true);
        AssessmentClassAiAnalysis r = row("row-1");

        new ClassAiReportGenerationService(repo, credits).charge(r);

        verify(credits).charge(eq(I), eq("assessment_class_ai_report:row-1"), eq("admin-1"), any());
        assertThat(r.getChargeStatus()).isEqualTo(AssessmentClassAiAnalysis.CHARGE_CHARGED);
    }

    @Test
    void aFailedChargeIsRecorded_notThrown_soTheReportSurvives() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        AiServiceCreditClient credits = mock(AiServiceCreditClient.class);
        when(credits.charge(anyString(), anyString(), any(), any()))
                .thenThrow(new RuntimeException("ai-service down"));
        AssessmentClassAiAnalysis r = row("row-2");

        // Must not throw: the report is already stored and downloadable.
        new ClassAiReportGenerationService(repo, credits).charge(r);

        assertThat(r.getChargeStatus()).isEqualTo(AssessmentClassAiAnalysis.CHARGE_FAILED);
        verify(repo).save(r);
    }

    @Test
    void aRegenerateSupersedesTheOldReportRatherThanDestroyingIt() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        when(repo.claim(anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(1);
        when(repo.findById(anyString())).thenReturn(Optional.of(row("new-row")));

        new ClassAiReportGenerationService(repo, mock(AiServiceCreditClient.class))
                .claim(A, I, "admin-1", TEN, true);

        // The previous report is retired into history, keeping it downloadable.
        verify(repo).supersedeLive(A, I);
        // And a regenerate must NOT run the stranded-claim sweep, which is only
        // for rows abandoned by a dead pod.
        verify(repo, never()).retireStrandedClaim(anyString(), anyString(), any(Timestamp.class));
    }

    @Test
    void aFirstGenerationSweepsStrandedClaimsButSupersedesNothing() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        when(repo.claim(anyString(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(1);
        when(repo.findById(anyString())).thenReturn(Optional.of(row("new-row")));

        new ClassAiReportGenerationService(repo, mock(AiServiceCreditClient.class))
                .claim(A, I, "admin-1", TEN, false);

        verify(repo).retireStrandedClaim(eq(A), eq(I), any(Timestamp.class));
        verify(repo, never()).supersedeLive(anyString(), anyString());
    }

    @Test
    void aFailedGenerationReleasesTheSlotSoTheTeacherCanRetry() {
        AssessmentClassAiAnalysisRepository repo = mock(AssessmentClassAiAnalysisRepository.class);
        AssessmentClassAiAnalysis r = row("row-3");
        when(repo.findById("row-3")).thenReturn(Optional.of(r));

        new ClassAiReportGenerationService(repo, mock(AiServiceCreditClient.class))
                .markFailed("row-3");

        assertThat(r.getStatus()).isEqualTo(AssessmentClassAiAnalysis.STATUS_FAILED);
        // Retired too — a failed attempt must not hold the live slot forever.
        assertThat(r.getSupersededAt()).isNotNull();
    }
}
