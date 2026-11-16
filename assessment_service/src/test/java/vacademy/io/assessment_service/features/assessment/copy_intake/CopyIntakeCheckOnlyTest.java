package vacademy.io.assessment_service.features.assessment.copy_intake;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
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
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.StudentNameMatcher.Candidate;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateResponse;
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
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * "Only check the copies, do not map them to students": no student list is read,
 * no copy waits for the admin, and each copy is graded on a hidden attempt of its
 * own that participant lists, stats and releases do not see.
 */
class CopyIntakeCheckOnlyTest {

    private AiCopyIntakeBatchRepository batches;
    private AiCopyIntakeItemRepository items;
    private AiServiceCopyCheckClient aiClient;
    private AssessmentRepository assessments;
    private AssessmentUserRegistrationRepository registrations;
    private AdminOfflineDataEntryManager offline;
    private StudentAttemptService attempts;
    private AiEvaluationService evaluation;
    private AdminCoreServiceClient adminCore;
    private AiEvaluationProcessRepository processes;
    private CopyIntakeService service;
    private HttpServer media;

    private final CustomUserDetails admin = new CustomUserDetails();
    private final Assessment assessment = new Assessment();

    @BeforeEach
    void setUp() throws Exception {
        batches = mock(AiCopyIntakeBatchRepository.class);
        items = mock(AiCopyIntakeItemRepository.class);
        aiClient = mock(AiServiceCopyCheckClient.class);
        assessments = mock(AssessmentRepository.class);
        registrations = mock(AssessmentUserRegistrationRepository.class);
        offline = mock(AdminOfflineDataEntryManager.class);
        attempts = mock(StudentAttemptService.class);
        evaluation = mock(AiEvaluationService.class);
        adminCore = mock(AdminCoreServiceClient.class);
        processes = mock(AiEvaluationProcessRepository.class);

        TransactionTemplate tx = mock(TransactionTemplate.class);
        org.mockito.Mockito.doAnswer(inv -> {
            inv.<java.util.function.Consumer<org.springframework.transaction.TransactionStatus>>getArgument(0)
                    .accept(new SimpleTransactionStatus());
            return null;
        }).when(tx).executeWithoutResult(any());

        InstituteFileOwnership ownership = mock(InstituteFileOwnership.class);
        when(ownership.notOwnedBy(anyString(), any())).thenReturn(List.of());

        service = new CopyIntakeService(batches, items, assessments,
                processes, registrations,
                mock(AssessmentBatchRegistrationRepository.class), adminCore, aiClient,
                offline, evaluation, attempts, mock(CopyIntakeNotifier.class),
                mock(AssessmentAuditClient.class), new ObjectMapper(), tx,
                mock(AuthService.class), ownership);

        // The media lookup is a plain HTTP GET; answer it for real.
        media = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        media.createContext("/media-service/public/get-public-url", ex -> {
            byte[] body = "\"https://files.invalid/copy.pdf\"".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        media.start();
        ReflectionTestUtils.setField(service, "mediaServiceUrl", "http://127.0.0.1:" + media.getAddress().getPort());
        ReflectionTestUtils.setField(service, "identifyStaleMinutes", 10L);

        ReflectionTestUtils.setField(admin, "userId", "admin-1");
        admin.setFullName("Admin One");
        admin.setUsername("admin@example.com");

        assessment.setId("a-1");
        assessment.setName("Science PT2");
        when(assessments.findById("a-1")).thenReturn(Optional.of(assessment));
        when(items.save(any(AiCopyIntakeItem.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @AfterEach
    void tearDown() {
        media.stop(0);
    }

    private AiCopyIntakeBatch checkOnlyBatch() {
        AiCopyIntakeBatch b = AiCopyIntakeBatch.builder().id("batch-1").assessmentId("a-1").instituteId("i-1")
                .status(AiCopyIntakeBatch.RUNNING).source(AiCopyIntakeBatch.SOURCE_CHECK_ONLY)
                .preferredModel("m-1").totalItems(1).build();
        when(batches.findById("batch-1")).thenReturn(Optional.of(b));
        return b;
    }

    private AiCopyIntakeItem identifying(String fileName) {
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .fileName(fileName).status(AiCopyIntakeItem.IDENTIFYING).build();
        when(items.transition("item-1", AiCopyIntakeItem.PENDING, AiCopyIntakeItem.IDENTIFYING)).thenReturn(1);
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        return item;
    }

    /** The offline manager makes attempt "att-1" on whatever registration it is given. */
    private StudentAttempt offlineAttemptIsCreated() {
        when(registrations.save(any(AssessmentUserRegistration.class))).thenAnswer(inv -> {
            AssessmentUserRegistration r = inv.getArgument(0);
            r.setId("reg-1");
            return r;
        });
        when(offline.createOfflineAttempt(isNull(), eq("a-1"), eq("reg-1"), eq("i-1"), isNull()))
                .thenReturn(ResponseEntity.ok(OfflineAttemptCreateResponse.builder()
                        .attemptId("att-1").registrationId("reg-1").assessmentId("a-1").build()));
        StudentAttempt attempt = new StudentAttempt();
        attempt.setId("att-1");
        attempt.setStatus("ENDED");
        when(attempts.getStudentAttemptById("att-1")).thenReturn(Optional.of(attempt));
        when(attempts.updateStudentAttempt(any(StudentAttempt.class))).thenAnswer(inv -> inv.getArgument(0));
        when(evaluation.initiateEvaluationForAttempt(any(StudentAttempt.class), eq("m-1"), anyBoolean(), any(), any()))
                .thenReturn("proc-1");
        return attempt;
    }

    @Test
    void startWithMapStudentsFalseCreatesACheckOnlyBatch() {
        when(batches.save(any())).thenAnswer(inv -> {
            AiCopyIntakeBatch b = inv.getArgument(0);
            b.setId("batch-1");
            return b;
        });
        CopyIntakeDtos.StartRequest req = CopyIntakeDtos.StartRequest.builder()
                .files(List.of(new CopyIntakeDtos.UploadedFile("f1", "a.pdf", 5)))
                .mapStudents(false).build();

        AiCopyIntakeBatch b = service.start(admin, "a-1", "i-1", req);

        assertThat(b.getSource()).isEqualTo(AiCopyIntakeBatch.SOURCE_CHECK_ONLY);
        assertThat(b.isCheckOnly()).isTrue();
    }

    @Test
    void startWithoutTheFlagStillMatchesStudents() {
        when(batches.save(any())).thenAnswer(inv -> {
            AiCopyIntakeBatch b = inv.getArgument(0);
            b.setId("batch-1");
            return b;
        });
        CopyIntakeDtos.StartRequest req = CopyIntakeDtos.StartRequest.builder()
                .files(List.of(new CopyIntakeDtos.UploadedFile("f1", "a.pdf", 5))).build();

        assertThat(service.start(admin, "a-1", "i-1", req).getSource()).isEqualTo(AiCopyIntakeBatch.SOURCE_UPLOAD);
    }

    @Test
    void aCheckOnlyBatchReadsNoStudentList() {
        AiCopyIntakeBatch b = checkOnlyBatch();

        assertThat(service.candidatesFor(b)).isEmpty();
        verify(registrations, never()).findByInstituteIdAndAssessmentIdAndStatusIn(anyString(), any());
        verify(adminCore, never()).getEnrolledLearnersForBatches(anyString(), any());
    }

    @Test
    void aCheckOnlyCopyIsQueuedOnAHiddenAttemptOfItsOwn() {
        checkOnlyBatch();
        AiCopyIntakeItem item = identifying("roll-12.pdf");
        StudentAttempt attempt = offlineAttemptIsCreated();
        when(aiClient.identify(anyString(), eq("i-1"), eq("m-1")))
                .thenReturn(Map.of("student_name", "Aman Sharma", "roll_number", "12"));

        service.identifyAndPlace("item-1", List.of(Candidate.builder().userId("u1").name("Aman Sharma").build()));

        // Not matched to the real Aman: a registration of its own, kept out of participant lists.
        verify(registrations).save(argThat((AssessmentUserRegistration r) ->
                "COPY_CHECK_ONLY".equals(r.getSource())
                        && "copy-check:item-1".equals(r.getUserId())
                        && "Aman Sharma".equals(r.getParticipantName())
                        && "batch-1".equals(r.getSourceId())
                        && "i-1".equals(r.getInstituteId())));
        verify(offline).attachOfflineFiles(isNull(), eq("a-1"), eq("att-1"), eq("i-1"),
                argThat(req -> "f1".equals(req.getStudentFileId())));
        assertThat(attempt.getStatus()).isEqualTo(CopyIntakeService.COPY_CHECK_ATTEMPT_STATUS);
        // No clock: the hourly end sweep must never time it out into an ENDED attempt.
        assertThat(attempt.getMaxTime()).isZero();
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
        assertThat(item.getProcessId()).isEqualTo("proc-1");
        assertThat(item.getAttemptId()).isEqualTo("att-1");
        assertThat(item.getMatchedUserId()).isNull();
        assertThat(item.getExtractedName()).isEqualTo("Aman Sharma");
    }

    @Test
    void aCopyWhoseNameCannotBeReadIsStillCheckedUnderItsFileName() {
        checkOnlyBatch();
        AiCopyIntakeItem item = identifying("Class 9 - copy 4.PDF");
        offlineAttemptIsCreated();
        when(aiClient.identify(anyString(), anyString(), any())).thenThrow(new RuntimeException("vision 500"));

        service.identifyAndPlace("item-1", List.of());

        verify(registrations).save(argThat((AssessmentUserRegistration r) ->
                "Class 9 - copy 4".equals(r.getParticipantName())));
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
        assertThat(item.getErrorMessage()).isNull();
    }

    @Test
    void aVeryLongFileNameIsCappedToFitTheParticipantName() {
        checkOnlyBatch();
        identifying("x".repeat(400) + ".pdf");
        offlineAttemptIsCreated();
        when(aiClient.identify(anyString(), anyString(), any())).thenThrow(new RuntimeException("vision 500"));

        service.identifyAndPlace("item-1", List.of());

        verify(registrations).save(argThat((AssessmentUserRegistration r) ->
                r.getParticipantName().length() == 255));
    }

    @Test
    void aRegistrationLeftByAnEarlierTryIsReusedNotDuplicated() {
        checkOnlyBatch();
        AiCopyIntakeItem item = identifying("a.pdf");
        offlineAttemptIsCreated();
        AssessmentUserRegistration left = new AssessmentUserRegistration();
        left.setId("reg-1");
        when(registrations.findTopByUserIdAndAssessmentId("copy-check:item-1", "a-1")).thenReturn(Optional.of(left));
        when(aiClient.identify(anyString(), anyString(), any())).thenReturn(Map.of("student_name", "Asha"));

        service.identifyAndPlace("item-1", List.of());

        verify(registrations, never()).save(any());
        assertThat(item.getRegistrationId()).isEqualTo("reg-1");
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
    }

    @Test
    void aCheckOnlyCopyCannotBeAssignedToAStudent() {
        checkOnlyBatch();
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.FAILED).attemptId("att-1").build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.resolve(admin, "item-1",
                        CopyIntakeDtos.ResolveRequest.builder().userId("u1").fullName("Aman").build()))
                .isInstanceOf(vacademy.io.common.exceptions.VacademyException.class)
                .hasMessageContaining("only to be checked");
        verify(offline, never()).createOfflineAttempt(any(), anyString(), any(), anyString(), any());
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.FAILED);
    }

    @Test
    void theHourlyEndSweepNeverPicksUpACheckOnlyAttempt() {
        vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository repo =
                mock(vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository.class);
        vacademy.io.assessment_service.features.assessment.service.StudentAttemptService svc =
                new vacademy.io.assessment_service.features.assessment.service.StudentAttemptService();
        ReflectionTestUtils.setField(svc, "studentAttemptRepository", repo);

        svc.getAllLiveAttempt();

        verify(repo).findByStatusNotIn(argThat((List<String> statuses) ->
                statuses.contains("ENDED") && statuses.contains(CopyIntakeService.COPY_CHECK_ATTEMPT_STATUS)));
    }

    @Test
    void retryingAFailedCheckOnlyCopyRequeuesItsOwnAttempt() {
        checkOnlyBatch();
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.FAILED).attemptId("att-1").registrationId("reg-1")
                .errorMessage("the AI check failed").build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        StudentAttempt attempt = offlineAttemptIsCreated();

        service.retry(admin, "item-1");

        verify(evaluation).initiateEvaluationForAttempt(eq(attempt), eq("m-1"), anyBoolean(), any(), any());
        verify(registrations, never()).save(any());
        verify(offline, never()).createOfflineAttempt(any(), anyString(), anyString(), anyString(), any());
        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
        assertThat(item.getErrorMessage()).isNull();
    }

    @Test
    void aCopyIsQuotedForEveryPageItHasNotTheOnePageMinimum() {
        checkOnlyBatch();
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.FAILED).attemptId("att-1").registrationId("reg-1").pageCount(4)
                .errorMessage("the AI check failed").build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        StudentAttempt attempt = offlineAttemptIsCreated();

        service.retry(admin, "item-1");

        verify(evaluation).initiateEvaluationForAttempt(eq(attempt), eq("m-1"), anyBoolean(), isNull(),
                argThat((vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationEnqueueContext ctx) ->
                        ctx != null && !ctx.apiTraffic() && ctx.pageCount() == null && ctx.charge() != null
                                && Integer.valueOf(4).equals(ctx.charge().params().get("num_pages"))));
    }

    @Test
    void checkInAnotherLanguagePutsTheLanguageOnTheNewRunOnly() {
        checkOnlyBatch();
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.FAILED).attemptId("att-1").registrationId("reg-1")
                .errorMessage("language_needs_confirmation: This copy is written in Hindi [hi] but the question paper is in English.")
                .build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        StudentAttempt attempt = offlineAttemptIsCreated();
        when(evaluation.initiateEvaluationForAttempt(eq(attempt), anyString(), anyBoolean(), any(), any())).thenReturn("proc-2");
        vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess run =
                new vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess();
        when(processes.findById("proc-2")).thenReturn(Optional.of(run));

        service.retry(admin, "item-1", "hi");

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
        assertThat(item.getErrorMessage()).isNull();
        assertThat(run.getAnswerLanguage()).isEqualTo("hi");
        verify(processes).save(run);
    }

    @Test
    void anUnknownLanguageRetriesAsConfigured() {
        checkOnlyBatch();
        AiCopyIntakeItem item = AiCopyIntakeItem.builder().id("item-1").batchId("batch-1").fileId("f1")
                .status(AiCopyIntakeItem.FAILED).attemptId("att-1").registrationId("reg-1").build();
        when(items.findById("item-1")).thenReturn(Optional.of(item));
        StudentAttempt attempt = offlineAttemptIsCreated();
        when(evaluation.initiateEvaluationForAttempt(eq(attempt), anyString(), anyBoolean(), any(), any())).thenReturn("proc-2");

        service.retry(admin, "item-1", "klingon");

        assertThat(item.getStatus()).isEqualTo(AiCopyIntakeItem.QUEUED);
        verify(processes, never()).findById("proc-2");
    }
}
