package vacademy.io.assessment_service.features.assessment.copy_intake;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeItem;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeNotifier;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Bulk AI check of the copies learners submitted themselves.
 *
 * What must hold: only an ENDED attempt with an uploaded sheet is a copy; a
 * copy the AI is on right now is never queued twice; an already-checked copy is
 * left alone unless the admin asks for a re-check; the preview and the start
 * pick exactly the same copies; and every item is born QUEUED on its own
 * attempt - there is nothing to read or match.
 */
class CopyIntakeSubmittedTest {

    private AiCopyIntakeBatchRepository batches;
    private AiCopyIntakeItemRepository items;
    private AiEvaluationProcessRepository processes;
    private StudentAttemptService attempts;
    private AiEvaluationService evaluation;
    private AssessmentRepository assessments;
    private CopyIntakeService service;

    private final CustomUserDetails admin = new CustomUserDetails();
    private final Assessment assessment = Assessment.builder().id("a-1").name("Unit test").build();

    @BeforeEach
    void setUp() {
        batches = mock(AiCopyIntakeBatchRepository.class);
        items = mock(AiCopyIntakeItemRepository.class);
        processes = mock(AiEvaluationProcessRepository.class);
        attempts = mock(StudentAttemptService.class);
        evaluation = mock(AiEvaluationService.class);
        assessments = mock(AssessmentRepository.class);

        service = new CopyIntakeService(batches, items, assessments, processes,
                mock(AssessmentUserRegistrationRepository.class),
                mock(AssessmentBatchRegistrationRepository.class),
                mock(AdminCoreServiceClient.class), mock(AiServiceCopyCheckClient.class),
                mock(AdminOfflineDataEntryManager.class), evaluation,
                attempts, mock(CopyIntakeNotifier.class), mock(AssessmentAuditClient.class),
                new ObjectMapper(), mock(TransactionTemplate.class),
                mock(vacademy.io.assessment_service.features.auth_service.service.AuthService.class),
                mock(vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership.class));

        when(batches.save(any(AiCopyIntakeBatch.class))).thenAnswer(inv -> {
            AiCopyIntakeBatch b = inv.getArgument(0);
            b.setId("batch-1");
            return b;
        });
        when(assessments.findById("a-1")).thenReturn(Optional.of(assessment));
        when(evaluation.initiateEvaluationForAttempt(any(), any(), anyBoolean(), any(), any()))
                .thenAnswer(inv -> "proc-" + ((StudentAttempt) inv.getArgument(0)).getId());
        when(processes.findByStudentAttempt_IdIn(anyList())).thenReturn(List.of());

        ReflectionTestUtils.setField(admin, "userId", "admin-1");
        admin.setFullName("Admin One");
        admin.setUsername("admin@example.com");
    }

    private StudentAttempt attempt(String id, String status, String fileId, String name) {
        AssessmentUserRegistration reg = new AssessmentUserRegistration();
        reg.setId("reg-" + id);
        reg.setUserId("user-" + id);
        reg.setParticipantName(name);
        reg.setAssessment(assessment);
        StudentAttempt a = new StudentAttempt();
        a.setId(id);
        a.setStatus(status);
        a.setRegistration(reg);
        a.setAttemptData(fileId == null ? "{}" : "{\"fileId\":\"" + fileId + "\"}");
        return a;
    }

    private AiEvaluationProcess process(StudentAttempt a, String status) {
        return AiEvaluationProcess.builder().id("old-" + a.getId()).studentAttempt(a).status(status).build();
    }

    @Test
    void previewCountsOnlyEndedAttemptsWithASheet() {
        StudentAttempt submitted = attempt("s1", "ENDED", "f1", "Asha");
        StudentAttempt online = attempt("s2", "ENDED", null, "Bala");
        StudentAttempt writing = attempt("s3", "LIVE", "f3", "Chitra");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(submitted, online, writing));

        CopyIntakeDtos.SubmittedPreviewDto p = service.previewSubmitted("a-1", null, false);

        assertThat(p.getConsidered()).isEqualTo(2);       // LIVE is not a submission yet
        assertThat(p.getWithCopy()).isEqualTo(1);
        assertThat(p.getNoCopy()).isEqualTo(1);
        assertThat(p.getToCheck()).isEqualTo(1);
        assertThat(p.getAttemptIds()).containsExactly("s1");
    }

    @Test
    void checkedAndRunningCopiesAreLeftAloneUnlessAskedToRecheck() {
        StudentAttempt fresh = attempt("s1", "ENDED", "f1", "Asha");
        StudentAttempt done = attempt("s2", "ENDED", "f2", "Bala");
        StudentAttempt running = attempt("s3", "ENDED", "f3", "Chitra");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(fresh, done, running));
        when(processes.findByStudentAttempt_IdIn(anyList()))
                .thenReturn(List.of(process(done, "COMPLETED"), process(running, "EVALUATING")));

        CopyIntakeDtos.SubmittedPreviewDto p = service.previewSubmitted("a-1", null, false);
        assertThat(p.getAlreadyChecked()).isEqualTo(1);
        assertThat(p.getInProgress()).isEqualTo(1);
        assertThat(p.getAttemptIds()).containsExactly("s1");

        CopyIntakeDtos.SubmittedPreviewDto again = service.previewSubmitted("a-1", null, true);
        assertThat(again.getAttemptIds()).containsExactlyInAnyOrder("s1", "s2");   // running still excluded
    }

    @Test
    void selectionIsKeptToThisAssessment() {
        StudentAttempt mine = attempt("s1", "ENDED", "f1", "Asha");
        StudentAttempt other = attempt("s9", "ENDED", "f9", "Zed");
        other.getRegistration().setAssessment(Assessment.builder().id("a-other").build());
        when(attempts.getStudentAttemptsByIds(List.of("s1", "s9"))).thenReturn(List.of(mine, other));

        CopyIntakeDtos.SubmittedPreviewDto p = service.previewSubmitted("a-1", List.of("s1", "s9"), false);

        assertThat(p.getConsidered()).isEqualTo(1);
        assertThat(p.getAttemptIds()).containsExactly("s1");
    }

    @Test
    void startQueuesEveryCopyOnItsOwnAttemptWithNothingToIdentify() {
        StudentAttempt a = attempt("s1", "ENDED", "f1", "Asha");
        StudentAttempt b = attempt("s2", "ENDED", "f2", "Bala");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(a, b));

        AiCopyIntakeBatch batch = service.startFromSubmitted(admin, "a-1", "i-1",
                CopyIntakeDtos.SubmittedRequest.builder().preferredModel("m").notifyEmail(false).build());

        assertThat(batch.getSource()).isEqualTo(AiCopyIntakeBatch.SOURCE_SUBMITTED);
        assertThat(batch.getTotalItems()).isEqualTo(2);
        assertThat(batch.isNotifyEmail()).isFalse();
        verify(evaluation).requireGradableQuestions(assessment);
        // Queued for the poller (never dispatched at once), attributed to the teacher.
        verify(evaluation).initiateEvaluationForAttempt(eq(a), eq("m"), eq(true), eq("admin-1"), any());
        verify(evaluation).initiateEvaluationForAttempt(eq(b), eq("m"), eq(true), eq("admin-1"), any());
        // One credit check for the whole batch (10.6), not one per copy.
        verify(evaluation).reserveDashboardCredits(List.of(a, b));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AiCopyIntakeItem>> saved = ArgumentCaptor.forClass(List.class);
        verify(items).saveAll(saved.capture());
        assertThat(saved.getValue()).hasSize(2).allSatisfy(item -> {
            assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
            assertThat(item.getBatchId()).isEqualTo("batch-1");
            assertThat(item.getAttemptId()).isNotBlank();
            assertThat(item.getProcessId()).isEqualTo("proc-" + item.getAttemptId());
            assertThat(item.getFileId()).isNotBlank();
            assertThat(item.getMatchedName()).isNotBlank();
            assertThat(item.getRegistrationId()).isEqualTo("reg-" + item.getAttemptId());
        });
    }

    @Test
    void startWithNothingToCheckFailsBeforeCreatingABatch() {
        StudentAttempt done = attempt("s1", "ENDED", "f1", "Asha");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(done));
        when(processes.findByStudentAttempt_IdIn(anyList())).thenReturn(List.of(process(done, "COMPLETED")));

        assertThatThrownBy(() -> service.startFromSubmitted(admin, "a-1", "i-1", null))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("No submitted copies");
        verify(batches, never()).save(any());
        verify(evaluation, never()).initiateEvaluationForAttempt(any(), anyString(), anyBoolean(), anyString(), any());
    }

    @Test
    void aReleasedResultIsNeverOfferedForACheck() {
        StudentAttempt fresh = attempt("s1", "ENDED", "f1", "Asha");
        StudentAttempt released = attempt("s2", "ENDED", "f2", "Bala");
        released.setReportReleaseStatus("RELEASED");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(fresh, released));

        CopyIntakeDtos.SubmittedPreviewDto p = service.previewSubmitted("a-1", null, true);
        assertThat(p.getAttemptIds()).containsExactly("s1");

        service.startFromSubmitted(admin, "a-1", "i-1",
                CopyIntakeDtos.SubmittedRequest.builder().includeChecked(true).build());
        verify(evaluation, never()).initiateEvaluationForAttempt(eq(released), any(), anyBoolean(), any(), any());
    }

    @Test
    void aCreditShortfallRefusesTheBatchBeforeAnythingIsQueued() {
        StudentAttempt a = attempt("s1", "ENDED", "f1", "Asha");
        when(attempts.getAllParticipantsAttemptForAssessment("a-1")).thenReturn(List.of(a));
        when(evaluation.reserveDashboardCredits(anyList())).thenThrow(
                new vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException(
                        java.math.BigDecimal.valueOf(3), java.math.BigDecimal.ONE, java.math.BigDecimal.ONE,
                        java.math.BigDecimal.ZERO, java.math.BigDecimal.ZERO));

        assertThatThrownBy(() -> service.startFromSubmitted(admin, "a-1", "i-1", null))
                .hasMessageContaining("Not enough AI credits");
        verify(batches, never()).save(any());
        verify(evaluation, never()).initiateEvaluationForAttempt(any(), any(), anyBoolean(), any(), any());
    }
}
