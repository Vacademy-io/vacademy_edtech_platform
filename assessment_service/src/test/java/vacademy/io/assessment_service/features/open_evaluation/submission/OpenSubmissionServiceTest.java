package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttachmentsRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationEnqueueContext;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.InsufficientCreditsException;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateService;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockedException;
import vacademy.io.assessment_service.features.open_evaluation.queue.QueueEtaService;
import vacademy.io.assessment_service.features.open_evaluation.quota.ApiQuotaService;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.upload.EvalApiUploadStore;
import vacademy.io.assessment_service.features.open_evaluation.upload.OpenUploadService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.assessment_service.features.open_evaluation.exam.OpenFixtures.INSTITUTE;

class OpenSubmissionServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-01T10:00:00Z");

    private ApiExamStore examStore;
    private OpenQuestionService questions;
    private ApiCandidateStore candidateStore;
    private ApiCandidateService candidateService;
    private ApiSubmissionStore store;
    private OpenUploadService uploads;
    private EvalApiUploadStore uploadStore;
    private AdminOfflineDataEntryManager offlineEntry;
    private ApiSubmissionWriter writer;
    private AiEvaluationService aiEvaluation;
    private AiEvaluationCreditGate gate;
    private ApiQuotaService quota;
    private StudentAttemptRepository attempts;
    private ResultLockGuard lockGuard;
    private RunCanceller canceller;
    private ResultStore resultStore;
    private OpenApiAudit audit;
    private OpenSubmissionService service;
    private StudentAttempt attempt;
    private final ApiKeyPrincipal key = OpenFixtures.key().toBuilder().creditLimit(new BigDecimal("500")).build();

    static class InlineTx implements PlatformTransactionManager {
        int rollbacks;

        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
        }

        @Override
        public void rollback(TransactionStatus status) {
            rollbacks++;
        }
    }

    private InlineTx tx;

    @BeforeEach
    void setUp() {
        examStore = mock(ApiExamStore.class);
        questions = mock(OpenQuestionService.class);
        candidateStore = mock(ApiCandidateStore.class);
        candidateService = mock(ApiCandidateService.class);
        store = mock(ApiSubmissionStore.class);
        uploads = mock(OpenUploadService.class);
        uploadStore = mock(EvalApiUploadStore.class);
        offlineEntry = mock(AdminOfflineDataEntryManager.class);
        writer = mock(ApiSubmissionWriter.class);
        aiEvaluation = mock(AiEvaluationService.class);
        gate = mock(AiEvaluationCreditGate.class);
        quota = mock(ApiQuotaService.class);
        attempts = mock(StudentAttemptRepository.class);
        lockGuard = new ResultLockGuard();
        canceller = mock(RunCanceller.class);
        resultStore = mock(ResultStore.class);
        audit = mock(OpenApiAudit.class);
        tx = new InlineTx();
        service = new OpenSubmissionService(examStore, questions, candidateStore, candidateService, store, uploads,
                uploadStore, offlineEntry, writer, aiEvaluation, gate, quota, attempts,
                mock(QuestionWiseMarksRepository.class), mock(TypedAnswerEvaluation.class), lockGuard, canceller,
                resultStore, mock(QueueEtaService.class), mock(ApiSubmissionFeed.class), audit, new ObjectMapper(), tx);

        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("handwritten")));
        when(questions.load("exam-1")).thenReturn(TypedAnswersTest.paper());
        ApiCandidateStore.CandidateRow cand = new ApiCandidateStore.CandidateRow("cand-1", INSTITUTE, "STU-1", "Aarav",
                "10A07", null, null, NOW, NOW);
        when(candidateStore.upsert(eq(INSTITUTE), eq(OpenFixtures.KEY_ID), any()))
                .thenReturn(new ApiCandidateStore.Upserted("cand-1", "STU-1", false));
        when(candidateStore.findById(INSTITUTE, "cand-1")).thenReturn(Optional.of(cand));
        when(candidateStore.registrations(eq("exam-1"), eq(INSTITUTE), anyList())).thenReturn(Map.of("apic_cand-1", "reg-1"));
        when(store.findLiveForUpdate("exam-1", "cand-1")).thenReturn(Optional.empty());
        when(gate.reserve(eq(INSTITUTE), anyList(), any(), eq(AiEvaluationCreditGate.Mode.API), any()))
                .thenReturn(List.of(new AiEvaluationCreditGate.Reservation(new BigDecimal("28"),
                        "{\"tool_key\":\"copy_check_evaluation_api\",\"rate_source\":\"global\"}")));
        when(offlineEntry.createOfflineAttempt(any(), eq("exam-1"), eq("reg-1"), eq(INSTITUTE), isNull()))
                .thenReturn(ResponseEntity.ok(OfflineAttemptCreateResponse.builder().attemptId("att-1").build()));
        attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setReportReleaseStatus("PENDING");
        AssessmentUserRegistration reg = new AssessmentUserRegistration();
        Assessment assessment = new Assessment();
        assessment.setId("exam-1");
        reg.setAssessment(assessment);
        attempt.setRegistration(reg);
        when(attempts.findById("att-1")).thenReturn(Optional.of(attempt));
        when(uploadStore.consume("up-1", "att-1")).thenReturn(1);
    }

    static ApiExamStore.ApiExamRow open(String mode) {
        return OpenFixtures.exam("exam-1", "PUBLISHED", mode, LocalDate.of(2026, 10, 1), null);
    }

    private EvalApiUploadStore.UploadRow readyUpload(int pages) {
        EvalApiUploadStore.UploadRow upload = new EvalApiUploadStore.UploadRow("up-1", INSTITUTE, OpenFixtures.KEY_ID,
                "file-1", "a.pdf", "application/pdf", 1000, null, pages, "ready", null, null, NOW.minusSeconds(10),
                NOW, NOW.minusSeconds(4000), NOW);
        when(uploadStore.findForUpdate(INSTITUTE, "up-1")).thenReturn(Optional.of(upload));
        return upload;
    }

    private SubmissionInputs.CreateSubmission handwritten() {
        SubmissionInputs.CreateSubmission body = new SubmissionInputs.CreateSubmission();
        ExamInputs.CandidateInput c = new ExamInputs.CandidateInput();
        c.setExternalId("STU-1");
        body.setCandidate(c);
        body.setUploadId("up-1");
        return body;
    }

    @Test
    void handwritten_copy_is_priced_per_page_quota_checked_and_queued_for_the_api_lane() {
        readyUpload(28);

        OpenSubmissionService.Created created = service.create(key, "exam-1", handwritten());

        assertThat(created.submissionId()).isEqualTo("att-1");
        assertThat(created.quote()).containsEntry("unit", "page").containsEntry("pages", 28)
                .containsEntry("credits", 28L).containsEntry("rate_source", "standard");
        assertThat(created.warnings()).isEmpty();

        InOrder order = inOrder(store, gate, quota, offlineEntry, uploadStore, aiEvaluation);
        order.verify(store).lockRegistration("reg-1");
        order.verify(gate).reserve(eq(INSTITUTE), eq(List.of(AiEvaluationCharge.apiHandwritten(28))), eq(new BigDecimal("500")),
                eq(AiEvaluationCreditGate.Mode.API), any());
        order.verify(quota).consumeCopies(key, 1, 0, 28);
        order.verify(offlineEntry).createOfflineAttempt(any(), eq("exam-1"), eq("reg-1"), eq(INSTITUTE), isNull());
        ArgumentCaptor<OfflineAttachmentsRequest> files = ArgumentCaptor.forClass(OfflineAttachmentsRequest.class);
        order.verify(offlineEntry).attachOfflineFiles(any(), eq("exam-1"), eq("att-1"), eq(INSTITUTE), files.capture());
        order.verify(uploadStore).consume("up-1", "att-1");
        order.verify(store).insert(eq("att-1"), eq("exam-1"), eq("cand-1"), eq(INSTITUTE), eq(OpenFixtures.KEY_ID),
                eq("handwritten"), eq("up-1"), eq(28), isNull(), isNull());
        ArgumentCaptor<AiEvaluationEnqueueContext> ctx = ArgumentCaptor.forClass(AiEvaluationEnqueueContext.class);
        order.verify(aiEvaluation).initiateEvaluationForAttempt(eq(attempt), isNull(), eq(true), isNull(), ctx.capture());
        assertThat(files.getValue().getStudentFileId()).isEqualTo("file-1");
        assertThat(ctx.getValue().apiTraffic()).isTrue();
        assertThat(ctx.getValue().apiKeyId()).isEqualTo(OpenFixtures.KEY_ID);
        assertThat(ctx.getValue().pageCount()).isEqualTo(28);
        assertThat(ctx.getValue().charge()).isEqualTo(AiEvaluationCharge.apiHandwritten(28));
        assertThat(ctx.getValue().reservation().quotedCredits()).isEqualByComparingTo("28");
        verify(audit).record(eq(key), eq(OpenApiAudit.ACTION_SUBMISSION_CREATE), eq("exam-1"), anyString(), any());
    }

    @Test
    void the_credit_estimate_is_taken_before_the_transaction_and_its_locks() {
        EvalApiUploadStore.UploadRow upload = readyUpload(28);
        when(uploads.requireUsable(eq(key), eq("up-1"))).thenReturn(upload);
        AiEvaluationCreditGate.Prequote early = new AiEvaluationCreditGate.Prequote(INSTITUTE, Map.of());
        when(gate.prequote(INSTITUTE, List.of(AiEvaluationCharge.apiHandwritten(28)))).thenReturn(early);

        service.create(key, "exam-1", handwritten());

        InOrder order = inOrder(gate, store);
        order.verify(gate).prequote(INSTITUTE, List.of(AiEvaluationCharge.apiHandwritten(28)));
        order.verify(store).lockRegistration("reg-1");
        order.verify(gate).reserve(eq(INSTITUTE), eq(List.of(AiEvaluationCharge.apiHandwritten(28))), any(),
                eq(AiEvaluationCreditGate.Mode.API), eq(early));
    }

    @Test
    void copies_of_41_to_80_pages_are_flagged_and_above_80_refused() {
        readyUpload(56);
        OpenSubmissionService.Created created = service.create(key, "exam-1", handwritten());
        assertThat(created.warnings()).extracting(w -> w.get("code")).containsExactly("pages_beyond_vision_limit");
        verify(store).insert(eq("att-1"), any(), any(), any(), any(), any(), any(), eq(56), any(),
                eq("[\"pages_beyond_vision_limit\"]"));

        readyUpload(81);
        assertThatThrownBy(() -> service.create(key, "exam-1", handwritten()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.TOO_MANY_PAGES));
        assertThat(OpenSubmissionService.pagePolicy(40)).isEqualTo(OpenSubmissionService.PagePolicy.NORMAL);
        assertThat(OpenSubmissionService.pagePolicy(41)).isEqualTo(OpenSubmissionService.PagePolicy.FLAG);
        assertThat(OpenSubmissionService.pagePolicy(80)).isEqualTo(OpenSubmissionService.PagePolicy.FLAG);
    }

    @Test
    void an_existing_live_submission_is_409_unless_replace() {
        readyUpload(10);
        when(store.findLiveForUpdate("exam-1", "cand-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("old-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 10)));

        assertThatThrownBy(() -> service.create(key, "exam-1", handwritten()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.SUBMISSION_EXISTS);
                    assertThat(e.getDetails()).containsEntry("submission_id", "old-1");
                });
        verify(gate, never()).reserve(any(), anyList(), any(), any(), any());
    }

    @Test
    void replace_cancels_the_old_runs_and_marks_it_replaced() {
        readyUpload(10);
        when(store.findLiveForUpdate("exam-1", "cand-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("old-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 10)));
        StudentAttempt old = new StudentAttempt();
        old.setId("old-1");
        old.setReportReleaseStatus("PENDING");
        when(attempts.findById("old-1")).thenReturn(Optional.of(old));
        SubmissionInputs.CreateSubmission body = handwritten();
        body.setReplace(true);

        simulateLiveUniqueIndex("old-1");

        OpenSubmissionService.Created created = service.create(key, "exam-1", body);

        assertThat(created.submissionId()).isEqualTo("att-1");
        verify(canceller).cancelLiveRuns("old-1");
        verify(store).markAttemptDeleted("old-1");
        // ux_api_submission_live is checked per row: the old row must leave LIVE before the insert.
        InOrder order = inOrder(store);
        order.verify(store).markReplaced("old-1");
        order.verify(store).insert(eq("att-1"), any(), any(), any(), any(), any(), any(), any(), any(), any());
        order.verify(store).linkReplacedBy("old-1", "att-1");
    }

    @Test
    void typed_replace_moves_the_old_row_off_live_before_the_insert() {
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("typed")));
        when(writer.writeTyped(eq(attempt), any(), anyList())).thenReturn(attempt);
        when(store.findLiveForUpdate("exam-1", "cand-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("old-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "typed", null)));
        StudentAttempt old = new StudentAttempt();
        old.setId("old-1");
        old.setReportReleaseStatus("PENDING");
        when(attempts.findById("old-1")).thenReturn(Optional.of(old));
        SubmissionInputs.CreateSubmission body = handwritten();
        body.setUploadId(null);
        body.setReplace(true);
        body.setAnswers(List.of(new SubmissionInputs.AnswerInput("q5", null, "Energy is released.", null, null)));
        simulateLiveUniqueIndex("old-1");

        OpenSubmissionService.Created created = service.create(key, "exam-1", body);

        assertThat(created.submissionId()).isEqualTo("att-1");
        InOrder order = inOrder(store);
        order.verify(store).markReplaced("old-1");
        order.verify(store).insert(eq("att-1"), any(), any(), any(), any(), eq("typed"), any(), any(), any(), any());
        order.verify(store).linkReplacedBy("old-1", "att-1");
    }

    /** Mimics the partial unique index: inserting a LIVE row while {@code liveId} is still LIVE fails. */
    private void simulateLiveUniqueIndex(String liveId) {
        boolean[] stillLive = {true};
        when(store.markReplaced(liveId)).thenAnswer(inv -> {
            stillLive[0] = false;
            return 1;
        });
        org.mockito.Mockito.doAnswer(inv -> {
            if (stillLive[0]) {
                throw new org.springframework.dao.DuplicateKeyException("ux_api_submission_live");
            }
            return null;
        }).when(store).insert(anyString(), any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void a_finalized_submission_cannot_be_replaced() {
        readyUpload(10);
        when(store.findLiveForUpdate("exam-1", "cand-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("old-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 10)));
        StudentAttempt old = new StudentAttempt();
        old.setId("old-1");
        old.setReportReleaseStatus("RELEASED");
        when(attempts.findById("old-1")).thenReturn(Optional.of(old));
        SubmissionInputs.CreateSubmission body = handwritten();
        body.setReplace(true);

        assertThatThrownBy(() -> service.create(key, "exam-1", body)).isInstanceOf(ResultLockedException.class);
        verify(canceller, never()).cancelLiveRuns(anyString());
    }

    @Test
    void insufficient_credits_stop_before_anything_is_written() {
        readyUpload(10);
        when(gate.reserve(eq(INSTITUTE), anyList(), any(), eq(AiEvaluationCreditGate.Mode.API), any()))
                .thenThrow(new InsufficientCreditsException(BigDecimal.TEN, BigDecimal.ONE, BigDecimal.ONE,
                        BigDecimal.ZERO, BigDecimal.ZERO));

        assertThatThrownBy(() -> service.create(key, "exam-1", handwritten())).isInstanceOf(InsufficientCreditsException.class);
        verify(quota, never()).consumeCopies(any(), anyInt(), anyInt(), anyInt());
        verify(offlineEntry, never()).createOfflineAttempt(any(), any(), any(), any(), any());
        assertThat(tx.rollbacks).isEqualTo(1);
    }

    @Test
    void a_derived_finalized_exam_still_takes_new_copies_and_reopens() {
        // Spec 8.2: "finalized" = every live submission finalized. A partner who finalizes as
        // they go must still be able to submit the rest of the batch.
        readyUpload(10);
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "PUBLISHED", "handwritten", LocalDate.of(2026, 10, 1), NOW)));

        OpenSubmissionService.Created created = service.create(key, "exam-1", handwritten());

        assertThat(created.submissionId()).isEqualTo("att-1");
        InOrder order = inOrder(store, examStore);
        order.verify(store).insert(eq("att-1"), any(), any(), any(), any(), any(), any(), any(), any(), any());
        order.verify(examStore).clearFinalized("exam-1");
    }

    @Test
    void exam_state_and_mode_are_checked_first() {
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(
                OpenFixtures.exam("exam-1", "DRAFT", "handwritten", LocalDate.of(2026, 10, 1), null)));
        assertThatThrownBy(() -> service.create(key, "exam-1", handwritten()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_OPEN));

        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("handwritten")));
        SubmissionInputs.CreateSubmission typedOnPaper = handwritten();
        typedOnPaper.setUploadId(null);
        typedOnPaper.setAnswers(List.of());
        assertThatThrownBy(() -> service.create(key, "exam-1", typedOnPaper))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.MODE_MISMATCH));

        SubmissionInputs.CreateSubmission photos = handwritten();
        photos.setImages(List.of("u1"));
        assertThatThrownBy(() -> service.create(key, "exam-1", photos))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE));

        when(examStore.find(INSTITUTE, "other")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.create(key, "other", handwritten()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_FOUND));
    }

    @Test
    void candidate_id_or_candidate_and_metadata_are_validated() {
        SubmissionInputs.CreateSubmission both = handwritten();
        both.setCandidateId("cand-1");
        assertThatThrownBy(() -> service.create(key, "exam-1", both)).isInstanceOf(OpenApiException.class);

        SubmissionInputs.CreateSubmission unknown = handwritten();
        unknown.setCandidate(null);
        unknown.setCandidateId("ghost");
        readyUpload(10);
        when(candidateStore.findById(INSTITUTE, "ghost")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.create(key, "exam-1", unknown))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.CANDIDATE_NOT_FOUND));

        SubmissionInputs.CreateSubmission meta = handwritten();
        meta.setMetadata(new ObjectMapper().createArrayNode());
        assertThatThrownBy(() -> service.create(key, "exam-1", meta)).isInstanceOf(OpenApiException.class);
    }

    @Test
    void an_unregistered_candidate_is_registered_implicitly() {
        readyUpload(10);
        when(candidateStore.registrations(eq("exam-1"), eq(INSTITUTE), anyList())).thenReturn(Map.of());
        when(candidateService.registerRows(eq(key), any(), anyList())).thenReturn(new ApiCandidateService.Registration(1, 0,
                List.of(Map.of("id", "cand-1", "registration_id", "reg-1"))));

        service.create(key, "exam-1", handwritten());

        verify(candidateService).registerRows(eq(key), any(), anyList());
        verify(store).lockRegistration("reg-1");
    }

    @Test
    void typed_with_long_answers_is_priced_per_answer_in_the_typed_lane() {
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("typed")));
        when(writer.writeTyped(eq(attempt), any(), anyList())).thenReturn(attempt);
        SubmissionInputs.CreateSubmission body = handwritten();
        body.setUploadId(null);
        body.setAnswers(List.of(
                new SubmissionInputs.AnswerInput("q5", null, "Energy is released.", null, null),
                new SubmissionInputs.AnswerInput("q6", null, "Second answer.", null, null),
                new SubmissionInputs.AnswerInput("q1", null, null, List.of("A"), null)));

        OpenSubmissionService.Created created = service.create(key, "exam-1", body);

        verify(gate).reserve(eq(INSTITUTE), eq(List.of(AiEvaluationCharge.apiTyped(2))), eq(new BigDecimal("500")),
                eq(AiEvaluationCreditGate.Mode.API), any());
        verify(quota).consumeCopies(key, 1, 1, 0);
        ArgumentCaptor<List<TypedAnswers.Resolved>> answers = ArgumentCaptor.forClass(List.class);
        verify(writer).writeTyped(eq(attempt), any(), answers.capture());
        assertThat(answers.getValue()).hasSize(3);
        ArgumentCaptor<AiEvaluationEnqueueContext> ctx = ArgumentCaptor.forClass(AiEvaluationEnqueueContext.class);
        verify(aiEvaluation).initiateEvaluationForAttempt(eq(attempt), isNull(), eq(true), isNull(), ctx.capture());
        assertThat(ctx.getValue().pageCount()).isNull();
        assertThat(ctx.getValue().charge()).isEqualTo(AiEvaluationCharge.apiTyped(2));
        assertThat(created.quote()).containsEntry("unit", "answer").containsEntry("answers", 2);
        verify(store).insert(eq("att-1"), any(), any(), any(), any(), eq("typed"), isNull(), isNull(), any(), isNull());
    }

    @Test
    void typed_with_only_objective_answers_is_graded_at_once_without_the_ai() {
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("typed")));
        when(writer.writeTyped(eq(attempt), any(), anyList())).thenReturn(attempt);
        SubmissionInputs.CreateSubmission body = handwritten();
        body.setUploadId(null);
        body.setAnswers(List.of(new SubmissionInputs.AnswerInput("q1", null, null, List.of("A"), null),
                new SubmissionInputs.AnswerInput("q5", null, "  ", null, null)));

        OpenSubmissionService.Created created = service.create(key, "exam-1", body);

        verify(gate, never()).reserve(any(), anyList(), any(), any(), any());
        verify(aiEvaluation, never()).initiateEvaluationForAttempt(any(), any(), anyBoolean(), any(), any());
        assertThat(attempt.getResultStatus()).isEqualTo("COMPLETED");
        verify(attempts).save(attempt);
        assertThat(created.quote()).containsEntry("credits", 0);
    }

    @Test
    void typed_answers_on_a_handwritten_upload_field_are_mode_mismatch() {
        when(examStore.find(INSTITUTE, "exam-1")).thenReturn(Optional.of(open("typed")));
        assertThatThrownBy(() -> service.create(key, "exam-1", handwritten()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.MODE_MISMATCH));
    }

    @Test
    void filters_are_validated() {
        assertThat(OpenSubmissionService.statuses("graded, Partially_Graded")).containsExactly("graded", "partially_graded");
        assertThatThrownBy(() -> OpenSubmissionService.statuses("bogus")).isInstanceOf(OpenApiException.class);
        assertThat(OpenSubmissionService.bool("needs_review", "TRUE")).isTrue();
        assertThatThrownBy(() -> OpenSubmissionService.bool("finalized", "yes")).isInstanceOf(OpenApiException.class);
        assertThatThrownBy(() -> service.list(key, null, null, null, null, null, null, null, null, null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
    }

    @Test
    void exam_results_page_the_live_submissions_through_the_result_read_model() {
        SubmissionFixtures.View a = SubmissionFixtures.view();
        a.attemptId = "s-1";
        SubmissionFixtures.View b = SubmissionFixtures.view();
        b.attemptId = "s-2";
        SubmissionFixtures.View c = SubmissionFixtures.view();
        c.attemptId = "s-3";
        when(store.list(eq(INSTITUTE), eq("exam-1"), eq(true), any(), isNull(), eq(3)))
                .thenReturn(List.of(a.build(), b.build(), c.build()));

        vacademy.io.assessment_service.features.open_evaluation.support.Paging.Page<Map<String, Object>> page =
                service.results(key, "exam-1", "JSON", "true", null, null, 2,
                        v -> Map.of("submission_id", v.attemptId(), "questions", List.of()));

        assertThat(page.data()).extracting(m -> m.get("submission_id")).containsExactly("s-1", "s-2");
        assertThat(page.hasMore()).isTrue();
        assertThat(page.nextCursor()).isNotBlank();
        ArgumentCaptor<ApiSubmissionStore.Filters> filters = ArgumentCaptor.forClass(ApiSubmissionStore.Filters.class);
        verify(store).list(eq(INSTITUTE), eq("exam-1"), eq(true), filters.capture(), isNull(), eq(3));
        assertThat(filters.getValue().finalized()).isTrue();
        assertThat(filters.getValue().statuses()).isNull();

        // default page is 20 (a result is the heavy read), the cap is 50
        service.results(key, "exam-1", null, null, null, null, null, v -> Map.of());
        verify(store).list(eq(INSTITUTE), eq("exam-1"), eq(true), any(), isNull(), eq(21));
        for (int bad : new int[] {0, 51}) {
            assertThatThrownBy(() -> service.results(key, "exam-1", null, null, null, null, bad, v -> Map.of()))
                    .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        }
    }

    @Test
    void exam_results_refuse_csv_unknown_formats_and_other_institutes_exams() {
        assertThatThrownBy(() -> service.results(key, "exam-1", "csv", null, null, null, null, v -> Map.of()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> {
                    assertThat(e.getStatus().value()).isEqualTo(422);
                    assertThat(e.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE);
                });
        assertThatThrownBy(() -> service.results(key, "exam-1", "xml", null, null, null, null, v -> Map.of()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.VALIDATION_FAILED));
        when(examStore.find(INSTITUTE, "other")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.results(key, "other", "csv", null, null, null, null, v -> Map.of()))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EXAM_NOT_FOUND));
        verify(store, never()).list(anyString(), anyString(), anyBoolean(), any(), any(), anyInt());
    }

    @Test
    void cancel_refuses_finished_runs_and_is_idempotent() {
        when(store.findForUpdate(INSTITUTE, "att-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("att-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 10)));
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.attemptId = "att-1";
        v.processStatus = "COMPLETED";
        when(store.findView(INSTITUTE, "att-1")).thenReturn(Optional.of(v.build()));
        assertThatThrownBy(() -> service.cancel(key, "att-1"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.ALREADY_COMPLETED));

        v.processStatus = "CANCELLED";
        when(store.findView(INSTITUTE, "att-1")).thenReturn(Optional.of(v.build()));
        service.cancel(key, "att-1");
        verify(canceller, never()).cancelLiveRuns(anyString());

        v.processStatus = "PENDING";
        when(store.findView(INSTITUTE, "att-1")).thenReturn(Optional.of(v.build()));
        service.cancel(key, "att-1");
        verify(canceller).cancelLiveRuns("att-1");
    }

    @Test
    void delete_refuses_finalized_and_unknown_submissions() {
        when(store.findForUpdate(INSTITUTE, "att-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("att-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 10)));
        attempt.setReportReleaseStatus("RELEASED");
        assertThatThrownBy(() -> service.delete(key, "att-1")).isInstanceOf(ResultLockedException.class);

        attempt.setReportReleaseStatus("PENDING");
        service.delete(key, "att-1");
        verify(canceller).cancelLiveRuns("att-1");
        verify(store).markAttemptDeleted("att-1");
        verify(store).markDeleted("att-1");

        when(store.findForUpdate(INSTITUTE, "gone")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("gone", "exam-1", "cand-1", INSTITUTE, "DELETED", "handwritten", 10)));
        assertThatThrownBy(() -> service.delete(key, "gone"))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.SUBMISSION_NOT_FOUND));
    }

    @Test
    void reevaluate_refuses_finalized_running_and_per_question_runs_and_carries_reviewed_rows() {
        when(store.findForUpdate(INSTITUTE, "att-1")).thenReturn(Optional.of(
                new ApiSubmissionStore.SubmissionRow("att-1", "exam-1", "cand-1", INSTITUTE, "LIVE", "handwritten", 12)));
        SubmissionFixtures.View v = SubmissionFixtures.view();
        v.attemptId = "att-1";
        v.processId = "p-old";
        v.processStatus = "EVALUATING";
        when(store.findView(INSTITUTE, "att-1")).thenReturn(Optional.of(v.build()));

        SubmissionInputs.Reevaluate perQuestion = new SubmissionInputs.Reevaluate();
        perQuestion.setQuestionIds(List.of("q1"));
        assertThatThrownBy(() -> service.reevaluate(key, "att-1", perQuestion))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.FEATURE_NOT_AVAILABLE));

        assertThatThrownBy(() -> service.reevaluate(key, "att-1", null))
                .isInstanceOfSatisfying(OpenApiException.class, e -> assertThat(e.getCode()).isEqualTo(ApiErrorCode.EVALUATION_IN_PROGRESS));

        v.processStatus = "COMPLETED";
        when(store.findView(INSTITUTE, "att-1")).thenReturn(Optional.of(v.build()));
        when(aiEvaluation.initiateEvaluationForAttempt(eq(attempt), isNull(), eq(true), isNull(), any())).thenReturn("p-new");
        Map<String, Object> edited = Map.of("question_id", "q5");
        when(resultStore.editedRows("p-old")).thenReturn(List.of(edited));

        assertThat(service.reevaluate(key, "att-1", null)).isEqualTo("att-1");

        verify(gate).reserve(eq(INSTITUTE), eq(List.of(AiEvaluationCharge.apiHandwritten(12))), eq(new BigDecimal("500")),
                eq(AiEvaluationCreditGate.Mode.API), any());
        verify(resultStore).insertCarriedRow(anyString(), eq("p-new"), eq(edited));
        verify(store).clearApproved("att-1");

        attempt.setReportReleaseStatus("RELEASED");
        assertThatThrownBy(() -> service.reevaluate(key, "att-1", null)).isInstanceOf(ResultLockedException.class);
    }
}
