package vacademy.io.assessment_service.features.assessment.copy_intake;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.SimpleTransactionStatus;
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
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
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

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The bookkeeping around a bulk copy check, with the database mocked.
 *
 * The rules that matter: a copy is read at most once however many workers
 * see it; a batch settles exactly once per state and the admin is told
 * exactly once per state; counts are never stored, only counted; and a
 * stray callback cannot resurrect a copy the admin already dealt with.
 */
class CopyIntakeServiceTest {

    private AiCopyIntakeBatchRepository batches;
    private AiCopyIntakeItemRepository items;
    private AiServiceCopyCheckClient aiClient;
    private CopyIntakeNotifier notifier;
    private AssessmentRepository assessments;
    private AssessmentAuditClient audit;
    private AiEvaluationProcessRepository processes;
    private CopyIntakeService service;
    private vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership ownership;
    private AiEvaluationService evaluation;

    private final CustomUserDetails admin = new CustomUserDetails();

    @BeforeEach
    void setUp() {
        batches = mock(AiCopyIntakeBatchRepository.class);
        items = mock(AiCopyIntakeItemRepository.class);
        aiClient = mock(AiServiceCopyCheckClient.class);
        notifier = mock(CopyIntakeNotifier.class);
        assessments = mock(AssessmentRepository.class);
        audit = mock(AssessmentAuditClient.class);
        processes = mock(AiEvaluationProcessRepository.class);
        ownership = mock(vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership.class);
        evaluation = mock(AiEvaluationService.class);

        // A TransactionTemplate that just runs the callback: the service's
        // transaction boundaries are the thing under test only in so far as
        // the code inside them behaves.
        TransactionTemplate tx = mock(TransactionTemplate.class);
        org.mockito.Mockito.doAnswer(inv -> {
            inv.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0)
                    .accept(new SimpleTransactionStatus());
            return null;
        }).when(tx).executeWithoutResult(any());

        service = new CopyIntakeService(batches, items, assessments,
                processes,
                mock(AssessmentUserRegistrationRepository.class),
                mock(AssessmentBatchRegistrationRepository.class),
                mock(AdminCoreServiceClient.class), aiClient,
                mock(AdminOfflineDataEntryManager.class), evaluation,
                mock(StudentAttemptService.class), notifier, audit, new ObjectMapper(), tx,
                mock(vacademy.io.assessment_service.features.auth_service.service.AuthService.class),
                ownership);
        ReflectionTestUtils.setField(service, "mediaServiceUrl", "http://media.invalid");
        ReflectionTestUtils.setField(service, "identifyStaleMinutes", 10L);

        when(items.save(any(AiCopyIntakeItem.class))).thenAnswer(inv -> inv.getArgument(0));
        when(batches.save(any(AiCopyIntakeBatch.class))).thenAnswer(inv -> inv.getArgument(0));

        ReflectionTestUtils.setField(admin, "userId", "admin-1");
        admin.setFullName("Admin One");
        admin.setUsername("admin@example.com");
    }

    private AiCopyIntakeBatch batch(String status) {
        AiCopyIntakeBatch b = AiCopyIntakeBatch.builder().id("batch-1").assessmentId("a-1").instituteId("i-1")
                .status(status).totalItems(3).createdBy("admin-1").createdByEmail("admin@example.com").build();
        when(batches.findById("batch-1")).thenReturn(Optional.of(b));
        return b;
    }

    private void counts(Object[]... rows) {
        List<Object[]> list = new ArrayList<>();
        for (Object[] r : rows) list.add(new Object[] { r[0], ((Integer) r[1]).longValue() });
        when(items.countByStatus("batch-1")).thenReturn(list);
    }

    private static Object[] row(String status, int n) {
        return new Object[] { status, n };
    }

    // ---- start ---------------------------------------------------------

    @Test
    void startDropsDuplicateAndEmptyFilesAndCountsWhatIsLeft() {
        Assessment a = new Assessment();
        a.setId("a-1");
        a.setName("Science PT2");
        when(assessments.findById("a-1")).thenReturn(Optional.of(a));
        when(batches.save(any())).thenAnswer(inv -> {
            AiCopyIntakeBatch b = inv.getArgument(0);
            b.setId("batch-1");
            return b;
        });
        CopyIntakeDtos.StartRequest req = CopyIntakeDtos.StartRequest.builder().files(List.of(
                new CopyIntakeDtos.UploadedFile("f1", "a.pdf", 5),
                new CopyIntakeDtos.UploadedFile("f1", "a-again.pdf", 5),
                new CopyIntakeDtos.UploadedFile("", "nothing.pdf", 1),
                new CopyIntakeDtos.UploadedFile("f2", "b.pdf", 3))).build();

        AiCopyIntakeBatch b = service.start(admin, "a-1", "i-1", req);

        assertThat(b.getTotalItems()).isEqualTo(2);
        assertThat(b.isNotifyEmail()).isTrue();
        verify(items).saveAll(org.mockito.ArgumentMatchers.<List<AiCopyIntakeItem>>argThat(l -> l.size() == 2));
        verify(audit).record(eq(admin), eq("i-1"), eq("BULK_AI_CHECK"), eq("a-1"), anyString(), any());
    }

    @Test
    void startRefusesAFileNotRecordedForTheInstituteBeforeCreatingABatch() {
        Assessment a = new Assessment();
        a.setId("a-1");
        when(assessments.findById("a-1")).thenReturn(Optional.of(a));
        when(ownership.notOwnedBy(eq("i-1"), anyList())).thenReturn(List.of("other-institutes-file"));
        CopyIntakeDtos.StartRequest req = CopyIntakeDtos.StartRequest.builder().files(List.of(
                new CopyIntakeDtos.UploadedFile("f1", "a.pdf", 5),
                new CopyIntakeDtos.UploadedFile("other-institutes-file", "b.pdf", 3))).build();

        assertThatThrownBy(() -> service.start(admin, "a-1", "i-1", req))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not uploaded for this institute");
        verify(ownership).notOwnedBy("i-1", List.of("f1", "other-institutes-file"));
        verify(batches, never()).save(any());
        verify(items, never()).saveAll(any());
        verify(evaluation, never()).requireCreditsForCopies(any(), any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void startChecksCreditsForEveryCopyBeforeCreatingABatch() {
        Assessment a = new Assessment();
        a.setId("a-1");
        when(assessments.findById("a-1")).thenReturn(Optional.of(a));
        org.mockito.Mockito.doThrow(new vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing
                        .InsufficientCreditsException(java.math.BigDecimal.TEN, java.math.BigDecimal.ONE,
                        java.math.BigDecimal.ONE, java.math.BigDecimal.ZERO, java.math.BigDecimal.ZERO))
                .when(evaluation).requireCreditsForCopies(a, "i-1", 2);
        CopyIntakeDtos.StartRequest req = CopyIntakeDtos.StartRequest.builder().files(List.of(
                new CopyIntakeDtos.UploadedFile("f1", "a.pdf", 5),
                new CopyIntakeDtos.UploadedFile("f2", "b.pdf", 3))).build();

        assertThatThrownBy(() -> service.start(admin, "a-1", "i-1", req))
                .hasMessageContaining("Not enough AI credits");
        verify(batches, never()).save(any());
    }

    @Test
    void startRefusesAnEmptyOrOversizedUpload() {
        assertThatThrownBy(() -> service.start(admin, "a-1", "i-1", CopyIntakeDtos.StartRequest.builder().build()))
                .isInstanceOf(VacademyException.class);
        List<CopyIntakeDtos.UploadedFile> tooMany = new ArrayList<>();
        for (int i = 0; i <= CopyIntakeService.MAX_FILES_PER_BATCH; i++) {
            tooMany.add(new CopyIntakeDtos.UploadedFile("f" + i, i + ".pdf", 1));
        }
        assertThatThrownBy(() -> service.start(admin, "a-1", "i-1",
                CopyIntakeDtos.StartRequest.builder().files(tooMany).build()))
                .isInstanceOf(VacademyException.class).hasMessageContaining("500");
    }

    // ---- identification claims -------------------------------------------

    @Test
    void aCopyAnotherWorkerClaimedIsNotReadAgain() {
        when(items.transition("item-1", AiCopyIntakeItem.PENDING, AiCopyIntakeItem.IDENTIFYING)).thenReturn(0);

        service.identifyAndPlace("item-1", List.of());

        verify(aiClient, never()).identify(anyString(), anyString(), any());
        verify(items, never()).findById("item-1");
    }

    @Test
    void anUnreadableCopyFailsAloneWithTheReason() {
        batch(AiCopyIntakeBatch.RUNNING);
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.IDENTIFYING).build();
        when(items.transition("item-1", AiCopyIntakeItem.PENDING, AiCopyIntakeItem.IDENTIFYING)).thenReturn(1);
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        // mediaServiceUrl points nowhere, so the URL lookup fails before the reader is asked.

        service.identifyAndPlace("item-1", List.of(Candidate.builder().userId("u1").name("Aman Sharma").build()));

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.FAILED);
        assertThat(item.getErrorMessage()).contains("media service");
        verify(aiClient, never()).identify(anyString(), anyString(), any());
    }

    // ---- counts ----------------------------------------------------------

    @Test
    void countsComeFromTheItemsNotTheBatch() {
        counts(row("COMPLETED", 5), row("QUEUED", 3), row("AMBIGUOUS", 1), row("SKIPPED", 1), row("FAILED", 2));
        when(items.countEvaluating("batch-1")).thenReturn(2L);

        CopyIntakeService.Counts c = service.counts("batch-1");

        assertThat(c.total()).isEqualTo(12);
        assertThat(c.completed()).isEqualTo(5);
        assertThat(c.queued()).isEqualTo(1);
        assertThat(c.evaluating()).isEqualTo(2);
        assertThat(c.waiting()).isEqualTo(1);
        assertThat(c.skipped()).isEqualTo(1);
        assertThat(c.active()).isEqualTo(3);
        assertThat(c.identified()).isEqualTo(12);
    }

    @Test
    void batchDtoCarriesTheDerivedCountsAndInProgress() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.RUNNING);
        counts(row("PENDING", 1), row("COMPLETED", 1), row("UNMATCHED", 1));

        CopyIntakeDtos.BatchDto dto = service.toDto(b, false);

        assertThat(dto.getIdentified()).isEqualTo(2);
        assertThat(dto.getEvaluated()).isEqualTo(1);
        assertThat(dto.getUnmatched()).isEqualTo(1);
        assertThat(dto.getInProgress()).isEqualTo(1);
        assertThat(dto.getItems()).isNull();
    }

    // ---- settling --------------------------------------------------------

    @Test
    void aRunningBatchWithWorkLeftDoesNotSettle() {
        batch(AiCopyIntakeBatch.RUNNING);
        counts(row("QUEUED", 1), row("COMPLETED", 2));
        when(items.countEvaluating("batch-1")).thenReturn(0L);

        service.finalizeIfDone("batch-1");

        verify(batches, never()).transition(anyString(), anyString(), anyString(), any());
        verify(notifier, never()).batchSettled(any(), any());
    }

    @Test
    void aFinishedBatchSettlesToCompletedAndNotifiesOnce() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.RUNNING);
        counts(row("COMPLETED", 2), row("FAILED", 1));
        when(batches.transition(eq("batch-1"), eq(AiCopyIntakeBatch.RUNNING), eq(AiCopyIntakeBatch.COMPLETED), any(Date.class)))
                .thenAnswer(inv -> {
                    b.setStatus(AiCopyIntakeBatch.COMPLETED);
                    return 1;
                });

        service.finalizeIfDone("batch-1");

        verify(notifier, times(1)).batchSettled(eq(b), any());
    }

    @Test
    void copiesWaitingForAPersonSettleToNeedsReview() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.RUNNING);
        counts(row("COMPLETED", 1), row("AMBIGUOUS", 1), row("UNMATCHED", 1));
        when(batches.transition(eq("batch-1"), eq(AiCopyIntakeBatch.RUNNING), eq(AiCopyIntakeBatch.NEEDS_REVIEW), any(Date.class)))
                .thenAnswer(inv -> {
                    b.setStatus(AiCopyIntakeBatch.NEEDS_REVIEW);
                    return 1;
                });

        service.finalizeIfDone("batch-1");

        verify(notifier).batchSettled(eq(b), org.mockito.ArgumentMatchers.argThat(c -> c.waiting() == 2));
    }

    @Test
    void theLoserOfASimultaneousSettleDoesNotNotify() {
        batch(AiCopyIntakeBatch.RUNNING);
        counts(row("COMPLETED", 3));
        when(batches.transition(anyString(), anyString(), anyString(), any())).thenReturn(0);

        service.finalizeIfDone("batch-1");

        verify(notifier, never()).batchSettled(any(), any());
    }

    @Test
    void aStatusTheAdminWasAlreadyToldAboutIsNotAnnouncedAgain() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.RUNNING);
        b.setNotifiedStatus(AiCopyIntakeBatch.NEEDS_REVIEW);
        // One of ten waiting copies was resolved and checked; nine still wait.
        counts(row("COMPLETED", 2), row("UNMATCHED", 9));
        when(batches.transition(eq("batch-1"), eq(AiCopyIntakeBatch.RUNNING), eq(AiCopyIntakeBatch.NEEDS_REVIEW), any(Date.class)))
                .thenAnswer(inv -> {
                    b.setStatus(AiCopyIntakeBatch.NEEDS_REVIEW);
                    return 1;
                });

        service.finalizeIfDone("batch-1");

        verify(notifier, never()).batchSettled(any(), any());
    }

    @Test
    void aSettledBatchWithNewWorkIsReopened() {
        batch(AiCopyIntakeBatch.COMPLETED);
        counts(row("COMPLETED", 2), row("QUEUED", 1));
        when(items.countEvaluating("batch-1")).thenReturn(0L);

        service.finalizeIfDone("batch-1");

        verify(batches).transition("batch-1", AiCopyIntakeBatch.COMPLETED, AiCopyIntakeBatch.RUNNING, null);
        verify(notifier, never()).batchSettled(any(), any());
    }

    @Test
    void skippingTheLastWaitingCopyCompletesAReviewBatch() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.NEEDS_REVIEW);
        b.setNotifiedStatus(AiCopyIntakeBatch.NEEDS_REVIEW);
        counts(row("COMPLETED", 2), row("SKIPPED", 1));
        when(batches.transition(eq("batch-1"), eq(AiCopyIntakeBatch.NEEDS_REVIEW), eq(AiCopyIntakeBatch.COMPLETED), any(Date.class)))
                .thenAnswer(inv -> {
                    b.setStatus(AiCopyIntakeBatch.COMPLETED);
                    return 1;
                });

        service.finalizeIfDone("batch-1");

        verify(notifier).batchSettled(eq(b), org.mockito.ArgumentMatchers.argThat(c -> c.skipped() == 1));
    }

    @Test
    void aSettledBatchInItsFinalStateIsLeftAlone() {
        batch(AiCopyIntakeBatch.COMPLETED);
        counts(row("COMPLETED", 3));

        service.finalizeIfDone("batch-1");

        verify(batches, never()).transition(anyString(), anyString(), anyString(), any());
        verify(notifier, never()).batchSettled(any(), any());
    }

    // ---- callbacks -------------------------------------------------------

    @Test
    void aCallbackSettlesTheQueuedCopy() {
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").processId("p-1")
                .status(AiCopyIntakeItem.QUEUED).build();
        when(items.findFirstByProcessId("p-1")).thenReturn(Optional.of(item));

        service.onEvaluationFinished("p-1", false, "insufficient credits");

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.FAILED);
        assertThat(item.getErrorMessage()).isEqualTo("insufficient credits");
    }

    @Test
    void aStragglerCallbackCannotResurrectASkippedCopy() {
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").processId("p-1")
                .status(AiCopyIntakeItem.SKIPPED).build();
        when(items.findFirstByProcessId("p-1")).thenReturn(Optional.of(item));

        service.onEvaluationFinished("p-1", true, null);

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.SKIPPED);
        verify(items, never()).save(any());
    }

    @Test
    void queuedCopiesFollowTheirEvaluationRowWhenNoCallbackCame() {
        AiCopyIntakeItem done = AiCopyIntakeItem.builder().id("i-done").batchId("batch-1").processId("p-done")
                .status(AiCopyIntakeItem.QUEUED).build();
        AiCopyIntakeItem swept = AiCopyIntakeItem.builder().id("i-swept").batchId("batch-1").processId("p-swept")
                .status(AiCopyIntakeItem.QUEUED).build();
        AiCopyIntakeItem stopped = AiCopyIntakeItem.builder().id("i-stop").batchId("batch-1").processId("p-stop")
                .status(AiCopyIntakeItem.QUEUED).build();
        AiCopyIntakeItem running = AiCopyIntakeItem.builder().id("i-run").batchId("batch-1").processId("p-run")
                .status(AiCopyIntakeItem.QUEUED).build();
        when(items.findByBatchIdAndStatusIn("batch-1", List.of(AiCopyIntakeItem.QUEUED)))
                .thenReturn(List.of(done, swept, stopped, running));
        when(processes.findAllById(any())).thenReturn(List.of(
                process("p-done", "COMPLETED", null),
                process("p-swept", "FAILED", "Evaluation timed out 3 times with no response from the AI service. Please retry."),
                process("p-stop", "CANCELLED", null),
                process("p-run", "EVALUATING", null)));

        assertThat(service.syncQueuedItems("batch-1")).isEqualTo(3);

        assertThat(done.getStatus()).isEqualTo(AiCopyIntakeItem.COMPLETED);
        assertThat(swept.getStatus()).isEqualTo(AiCopyIntakeItem.FAILED);
        assertThat(swept.getErrorMessage()).contains("timed out");
        assertThat(stopped.getStatus()).isEqualTo(AiCopyIntakeItem.FAILED);
        assertThat(stopped.getErrorMessage()).contains("cancelled");
        assertThat(running.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
    }

    @Test
    void itemDtoReadsQueuedVersusEvaluatingOffTheProcessInOneQuery() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.RUNNING);
        counts(row("QUEUED", 2));
        when(items.countEvaluating("batch-1")).thenReturn(1L);
        AiCopyIntakeItem waiting = AiCopyIntakeItem.builder().id("i-1").batchId("batch-1").processId("p-1")
                .status(AiCopyIntakeItem.QUEUED).build();
        AiCopyIntakeItem grading = AiCopyIntakeItem.builder().id("i-2").batchId("batch-1").processId("p-2")
                .status(AiCopyIntakeItem.QUEUED).build();
        when(items.findByBatchIdOrderByCreatedAt("batch-1")).thenReturn(List.of(waiting, grading));
        when(processes.findAllById(any())).thenReturn(List.of(
                process("p-1", "PENDING", null), process("p-2", "EVALUATING", null)));

        CopyIntakeDtos.BatchDto dto = service.toDto(b, true);

        assertThat(dto.getItems()).extracting(CopyIntakeDtos.ItemDto::getStatus)
                .containsExactly(AiCopyIntakeItem.QUEUED, AiCopyIntakeItem.EVALUATING);
        verify(processes, never()).findById(anyString());
    }

    private static vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess process(
            String id, String status, String error) {
        var p = new vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess();
        p.setId(id);
        p.setStatus(status);
        p.setErrorMessage(error);
        return p;
    }

    // ---- admin decisions ---------------------------------------------------

    @Test
    void onlyAWaitingOrFailedCopyCanBeSkipped() {
        AiCopyIntakeItem queued = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1")
                .status(AiCopyIntakeItem.QUEUED).build();
        when(items.findById("item-1")).thenReturn(Optional.of(queued));

        assertThatThrownBy(() -> service.skip(admin, "item-1")).isInstanceOf(VacademyException.class);

        AiCopyIntakeItem unmatched = AiCopyIntakeItem.builder().id("item-2").batchId("batch-1")
                .status(AiCopyIntakeItem.UNMATCHED).build();
        when(items.findById("item-2")).thenReturn(Optional.of(unmatched));
        assertThat(service.skip(admin, "item-2").getStatus()).isEqualTo(AiCopyIntakeItem.SKIPPED);
        assertThat(unmatched.getResolvedBy()).isEqualTo("admin-1");
    }

    @Test
    void resolvingWithoutAStudentIsRefused() {
        batch(AiCopyIntakeBatch.NEEDS_REVIEW);
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1")
                .status(AiCopyIntakeItem.AMBIGUOUS).build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));

        assertThatThrownBy(() -> service.resolve(admin, "item-1", new CopyIntakeDtos.ResolveRequest()))
                .isInstanceOf(VacademyException.class).hasMessageContaining("Pick a student");
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.AMBIGUOUS);
    }

    @Test
    void retryingAFailedCopyThatNeverBecameAnAttemptReadsItAgain() {
        AiCopyIntakeBatch b = batch(AiCopyIntakeBatch.NEEDS_REVIEW);
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1")
                .status(AiCopyIntakeItem.FAILED).errorMessage("could not read the copy").build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));

        service.retry(admin, "item-1");

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.PENDING);
        assertThat(item.getErrorMessage()).isNull();
        assertThat(b.getStatus()).isEqualTo(AiCopyIntakeBatch.RUNNING);
        assertThat(b.getCompletedAt()).isNull();
    }

    @Test
    void staleIdentifyingCopiesGoBackToTheQueue() {
        AiCopyIntakeItem stuck = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1")
                .status(AiCopyIntakeItem.IDENTIFYING).build();
        when(items.findByBatchIdAndStatusAndUpdatedAtBefore(eq("batch-1"), eq(AiCopyIntakeItem.IDENTIFYING), any(Date.class)))
                .thenReturn(List.of(stuck));
        when(items.transition("item-1", AiCopyIntakeItem.IDENTIFYING, AiCopyIntakeItem.PENDING)).thenReturn(1);

        assertThat(service.recoverStaleIdentifying("batch-1")).isEqualTo(1);
    }

    @Test
    void aProcessNobodyUploadedIsIgnored() {
        when(items.findFirstByProcessId("p-x")).thenReturn(Optional.empty());
        assertThat(service.getBatchIdForProcess("p-x")).isEmpty();
        assertThat(service.getBatchIdForProcess(null)).isEmpty();
        service.onEvaluationFinished("p-x", true, null);   // no throw, nothing saved
        verify(items, never()).save(any());
        verify(items, never()).findById(isNull());
        assertThat(Map.of()).isEmpty();
    }
}
