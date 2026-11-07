package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttachmentsRequest;
import vacademy.io.assessment_service.features.assessment.dto.offline_entry.OfflineAttemptCreateResponse;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.enums.AttemptResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationEnqueueContext;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.TypedAnswerEvaluation;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiActorPrincipals;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateService;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamValidator;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.queue.QueueEtaService;
import vacademy.io.assessment_service.features.open_evaluation.quota.ApiQuotaService;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;
import vacademy.io.assessment_service.features.open_evaluation.upload.EvalApiUploadStore;
import vacademy.io.assessment_service.features.open_evaluation.upload.OpenUploadService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * Submissions (spec 7.6, T1.24): handwritten copies and typed answers, the reads over them,
 * re-evaluate, cancel and delete. A thin facade over the dashboard's own path — the offline
 * attempt (case 1), {@code attachOfflineFiles}, {@code ApiSubmissionWriter.writeTyped} and
 * the one AI enqueue, {@code AiEvaluationService.initiateEvaluationForAttempt(queueOnly)}.
 *
 * <p>Accept runs in one transaction: exam → upload → page policy → candidate and its
 * registration row lock → live-submission uniqueness (or replace) → credit check (API: fail
 * closed, credit limit) → daily quota → attempt → api_submission → enqueue. Any refusal rolls
 * everything back, quota included. HTTP checks that need no lock (upload HEAD + page count)
 * run before the transaction.
 */
@Slf4j
@Service
public class OpenSubmissionService {

    public static final int VISION_PAGE_LIMIT = 40;
    public static final int MAX_PAGES = 80;
    public static final String REASON_PAGES_BEYOND_VISION = "pages_beyond_vision_limit";
    public static final int MAX_RESULT_LIMIT = 50;
    static final Set<String> STATUSES = Set.of(PublicStatus.QUEUED, PublicStatus.PROCESSING, PublicStatus.READING,
            PublicStatus.GRADING, PublicStatus.GRADED, PublicStatus.PARTIALLY_GRADED, PublicStatus.FAILED,
            PublicStatus.CANCELLED);

    private final ApiExamStore examStore;
    private final OpenQuestionService questions;
    private final ApiCandidateStore candidateStore;
    private final ApiCandidateService candidateService;
    private final ApiSubmissionStore store;
    private final OpenUploadService uploads;
    private final EvalApiUploadStore uploadStore;
    private final AdminOfflineDataEntryManager offlineEntry;
    private final ApiSubmissionWriter writer;
    private final AiEvaluationService aiEvaluationService;
    private final AiEvaluationCreditGate creditGate;
    private final ApiQuotaService quota;
    private final StudentAttemptRepository attemptRepository;
    private final QuestionWiseMarksRepository marksRepository;
    private final TypedAnswerEvaluation typedAnswerEvaluation;
    private final ResultLockGuard lockGuard;
    private final RunCanceller canceller;
    private final ResultStore resultStore;
    private final QueueEtaService eta;
    private final ApiSubmissionFeed feed;
    private final OpenApiAudit audit;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    public OpenSubmissionService(ApiExamStore examStore, OpenQuestionService questions, ApiCandidateStore candidateStore,
            ApiCandidateService candidateService, ApiSubmissionStore store, OpenUploadService uploads,
            EvalApiUploadStore uploadStore, AdminOfflineDataEntryManager offlineEntry, ApiSubmissionWriter writer,
            AiEvaluationService aiEvaluationService, AiEvaluationCreditGate creditGate, ApiQuotaService quota,
            StudentAttemptRepository attemptRepository, QuestionWiseMarksRepository marksRepository,
            TypedAnswerEvaluation typedAnswerEvaluation, ResultLockGuard lockGuard, RunCanceller canceller,
            ResultStore resultStore, QueueEtaService eta, ApiSubmissionFeed feed, OpenApiAudit audit,
            ObjectMapper objectMapper, PlatformTransactionManager transactionManager) {
        this.examStore = examStore;
        this.questions = questions;
        this.candidateStore = candidateStore;
        this.candidateService = candidateService;
        this.store = store;
        this.uploads = uploads;
        this.uploadStore = uploadStore;
        this.offlineEntry = offlineEntry;
        this.writer = writer;
        this.aiEvaluationService = aiEvaluationService;
        this.creditGate = creditGate;
        this.quota = quota;
        this.attemptRepository = attemptRepository;
        this.marksRepository = marksRepository;
        this.typedAnswerEvaluation = typedAnswerEvaluation;
        this.lockGuard = lockGuard;
        this.canceller = canceller;
        this.resultStore = resultStore;
        this.eta = eta;
        this.feed = feed;
        this.audit = audit;
        this.objectMapper = objectMapper;
        this.tx = new TransactionTemplate(transactionManager);
    }

    // ================================================================== create

    /** What a create returns beside the submission: the quote and any warnings. */
    public record Created(String submissionId, Map<String, Object> quote, List<Map<String, Object>> warnings) {
    }

    public Created create(ApiKeyPrincipal key, String examId, SubmissionInputs.CreateSubmission body) {
        if (body == null) {
            throw OpenApiException.validation("body", "required", "Send a submission body.");
        }
        if (body.getImages() != null && !body.getImages().isEmpty()) {
            throw featureNotAvailable("images[] (phone photos) is not available yet; upload one PDF per answer sheet.");
        }
        if (body.getFiles() != null && !body.getFiles().isEmpty()) {
            throw featureNotAvailable("files[] (booklet plus supplements) is not available yet; send one upload_id.");
        }
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        boolean typed = exam.isTyped();
        if (typed && body.getUploadId() != null) {
            throw modeMismatch("This is a typed exam: send answers[], not an upload.");
        }
        if (!typed && body.getAnswers() != null) {
            throw modeMismatch("This is a handwritten exam: send upload_id, not answers[].");
        }
        validateCandidateRef(body);
        String metadataJson = metadataJson(body.getMetadata());

        if (typed) {
            requireOpen(exam);
            List<TypedAnswers.Resolved> resolved = TypedAnswers.resolve(paper(examId), body.getAnswers());
            int longAnswers = TypedAnswers.nonBlankLongAnswers(resolved);
            AiEvaluationCreditGate.Prequote prequote = longAnswers > 0
                    ? prequote(key, AiEvaluationCharge.apiTyped(longAnswers)) : AiEvaluationCreditGate.Prequote.NONE;
            return tx.execute(status -> acceptTyped(key, examId, body, resolved, metadataJson, prequote));
        }
        if (body.getUploadId() == null || body.getUploadId().isBlank()) {
            throw OpenApiException.validation("upload_id", "required", "upload_id is required for a handwritten exam.");
        }
        requireOpen(exam);
        // HEAD + page count, outside the transaction (HTTP); the transaction re-reads it locked.
        EvalApiUploadStore.UploadRow usable = uploads.requireUsable(key, body.getUploadId().trim());
        // Quote before the transaction: the estimate is HTTP and must not run under row locks.
        AiEvaluationCreditGate.Prequote prequote = usable != null && usable.pages() != null
                && pagePolicy(usable.pages()) != PagePolicy.REFUSE
                ? prequote(key, AiEvaluationCharge.apiHandwritten(usable.pages()))
                : AiEvaluationCreditGate.Prequote.NONE;
        return tx.execute(status -> acceptHandwritten(key, examId, body, metadataJson, prequote));
    }

    private Created acceptHandwritten(ApiKeyPrincipal key, String examId, SubmissionInputs.CreateSubmission body,
            String metadataJson, AiEvaluationCreditGate.Prequote prequote) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        requireOpen(exam);
        requireGradable(examId);
        EvalApiUploadStore.UploadRow upload = uploadStore.findForUpdate(key.getInstituteId(), body.getUploadId().trim())
                .orElseThrow(OpenUploadService::uploadNotFound);
        OpenUploadService.refuseUnusable(upload);
        if (!upload.isReady() || upload.pages() == null) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UPLOAD_REJECTED,
                    "The upload is not ready yet; read GET /uploads/{id} until it is ready.",
                    Map.of("upload_id", upload.id(), "reason", "not_ready"));
        }
        int pages = upload.pages();
        List<Map<String, Object>> warnings = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        PagePolicy policy = pagePolicy(pages);
        if (policy == PagePolicy.REFUSE) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.TOO_MANY_PAGES,
                    "Copies of more than " + MAX_PAGES + " pages are not accepted yet (this one has " + pages + ").",
                    Map.of("pages", pages, "max_pages", MAX_PAGES));
        }
        if (policy == PagePolicy.FLAG) {
            reasons.add(REASON_PAGES_BEYOND_VISION);
            warnings.add(warning(REASON_PAGES_BEYOND_VISION, "Pages after " + VISION_PAGE_LIMIT
                    + " are read with plain OCR only; the copy is marked for human review.", "upload_id"));
        }
        Registered reg = registerCandidate(key, exam, body);
        String replaced = replaceOrRefuse(reg, examId, body);

        AiEvaluationCharge charge = AiEvaluationCharge.apiHandwritten(pages);
        AiEvaluationCreditGate.Reservation reservation = reserve(key, charge, prequote);
        quota.consumeCopies(key, 1, 0, pages);

        StudentAttempt attempt = newAttempt(key, examId, reg.registrationId());
        offlineEntry.attachOfflineFiles(ApiActorPrincipals.forKey(key), examId, attempt.getId(), key.getInstituteId(),
                OfflineAttachmentsRequest.builder().studentFileId(upload.fileId()).build());
        if (uploadStore.consume(upload.id(), attempt.getId()) == 0) {
            throw OpenApiException.conflict(ApiErrorCode.UPLOAD_ALREADY_USED,
                    "This upload is already used by another submission.", Map.of("upload_id", upload.id()));
        }
        insertSubmission(key, examId, reg, attempt.getId(), ExamValidator.MODE_HANDWRITTEN, upload.id(), pages,
                metadataJson, reasons.isEmpty() ? null : json(reasons));
        reopenIfFinalized(examId);
        if (replaced != null) {
            store.linkReplacedBy(replaced, attempt.getId());
        }
        StudentAttempt reloaded = attemptRepository.findById(attempt.getId()).orElse(attempt);
        aiEvaluationService.initiateEvaluationForAttempt(reloaded, null, true, null,
                AiEvaluationEnqueueContext.api(key.getKeyId(), creditLimit(key), pages, charge)
                        .withReservation(reservation));
        auditCreate(key, examId, attempt.getId(), reg.candidateId(), replaced, "handwritten", pages);
        return new Created(attempt.getId(), quote("page", pages, reservation), warnings);
    }

    private Created acceptTyped(ApiKeyPrincipal key, String examId, SubmissionInputs.CreateSubmission body,
            List<TypedAnswers.Resolved> resolved, String metadataJson, AiEvaluationCreditGate.Prequote prequote) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        requireOpen(exam);
        requireGradable(examId);
        Registered reg = registerCandidate(key, exam, body);
        String replaced = replaceOrRefuse(reg, examId, body);

        int answers = TypedAnswers.nonBlankLongAnswers(resolved);
        AiEvaluationCharge charge = answers > 0 ? AiEvaluationCharge.apiTyped(answers) : null;
        AiEvaluationCreditGate.Reservation reservation = charge == null ? null : reserve(key, charge, prequote);
        quota.consumeCopies(key, 1, 1, 0);

        StudentAttempt attempt = newAttempt(key, examId, reg.registrationId());
        Assessment assessment = attempt.getRegistration().getAssessment();
        StudentAttempt written = writer.writeTyped(attempt, assessment, resolved);
        insertSubmission(key, examId, reg, attempt.getId(), ExamValidator.MODE_TYPED, null, null, metadataJson, null);
        reopenIfFinalized(examId);
        if (replaced != null) {
            store.linkReplacedBy(replaced, attempt.getId());
        }
        if (charge != null) {
            StudentAttempt reloaded = attemptRepository.findById(attempt.getId()).orElse(written);
            aiEvaluationService.initiateEvaluationForAttempt(reloaded, null, true, null,
                    AiEvaluationEnqueueContext.api(key.getKeyId(), creditLimit(key), null, charge)
                            .withReservation(reservation));
        } else {
            // Nothing for the AI: objective answers are scored, blank long answers score 0.
            StudentAttempt done = attemptRepository.findById(attempt.getId()).orElse(written);
            done.setResultStatus(AttemptResultStatusEnum.COMPLETED.name());
            attemptRepository.save(done);
        }
        auditCreate(key, examId, attempt.getId(), reg.candidateId(), replaced, "typed", null);
        return new Created(attempt.getId(), charge == null ? quoteNone() : quote("answer", answers, reservation),
                List.of());
    }

    /** Page policy (spec 7.6 step 3): ≤ 40 normal, 41–80 flagged for review, > 80 refused. */
    public enum PagePolicy { NORMAL, FLAG, REFUSE }

    public static PagePolicy pagePolicy(int pages) {
        if (pages > MAX_PAGES) {
            return PagePolicy.REFUSE;
        }
        return pages > VISION_PAGE_LIMIT ? PagePolicy.FLAG : PagePolicy.NORMAL;
    }

    // ------------------------------------------------------------------ create helpers

    record Registered(String candidateId, String externalId, String registrationId) {
    }

    private Registered registerCandidate(ApiKeyPrincipal key, ApiExamStore.ApiExamRow exam,
            SubmissionInputs.CreateSubmission body) {
        ApiCandidateStore.CandidateRow candidate;
        if (body.getCandidateId() != null && !body.getCandidateId().isBlank()) {
            candidate = candidateStore.findById(key.getInstituteId(), body.getCandidateId().trim())
                    .orElseThrow(() -> OpenApiException.notFound(ApiErrorCode.CANDIDATE_NOT_FOUND, "No candidate with this id."));
        } else {
            ApiCandidateStore.Upserted up = candidateStore.upsert(key.getInstituteId(), key.getKeyId(), body.getCandidate());
            candidate = candidateStore.findById(key.getInstituteId(), up.id())
                    .orElseThrow(() -> OpenApiException.notFound(ApiErrorCode.CANDIDATE_NOT_FOUND, "No candidate with this id."));
        }
        String registrationId = candidateStore.registrations(exam.assessmentId(), key.getInstituteId(),
                List.of(candidate.userId())).get(candidate.userId());
        if (registrationId == null) {
            // Implicit registration (spec 7.6 step 4), same path as POST /exams/{id}/candidates.
            ApiCandidateService.Registration r = candidateService.registerRows(key, exam, List.of(candidate));
            registrationId = r.candidates().isEmpty() ? null : (String) r.candidates().get(0).get("registration_id");
        }
        if (registrationId == null) {
            throw new IllegalStateException("candidate registration was not created");
        }
        store.lockRegistration(registrationId);
        return new Registered(candidate.id(), candidate.externalId(), registrationId);
    }

    /**
     * Step 4: an existing LIVE submission is 409 submission_exists unless {@code replace};
     * a finalized one cannot be replaced; otherwise its attempt is deleted and its live runs
     * cancelled. Returns the replaced submission id, already marked REPLACED (replaced_by is linked once
     * the new one exists).
     */
    private String replaceOrRefuse(Registered reg, String examId, SubmissionInputs.CreateSubmission body) {
        var live = store.findLiveForUpdate(examId, reg.candidateId());
        if (live.isEmpty()) {
            return null;
        }
        String oldId = live.get().attemptId();
        if (!Boolean.TRUE.equals(body.getReplace())) {
            throw OpenApiException.conflict(ApiErrorCode.SUBMISSION_EXISTS,
                    "This candidate already has a submission on this exam; send replace: true to replace it.",
                    Map.of("submission_id", oldId));
        }
        StudentAttempt old = attemptRepository.findById(oldId).orElse(null);
        lockGuard.requireNotFinalized(old);
        canceller.cancelLiveRuns(oldId);
        store.markAttemptDeleted(oldId);
        // Off LIVE now, before the new LIVE row is inserted (ux_api_submission_live is per row).
        store.markReplaced(oldId);
        return oldId;
    }

    /** The HTTP credit estimate, taken outside the transaction (no locks, no pooled connection held). */
    private AiEvaluationCreditGate.Prequote prequote(ApiKeyPrincipal key, AiEvaluationCharge charge) {
        AiEvaluationCreditGate.Prequote p = creditGate.prequote(key.getInstituteId(), List.of(charge));
        return p == null ? AiEvaluationCreditGate.Prequote.NONE : p;
    }

    private AiEvaluationCreditGate.Reservation reserve(ApiKeyPrincipal key, AiEvaluationCharge charge,
            AiEvaluationCreditGate.Prequote prequote) {
        List<AiEvaluationCreditGate.Reservation> reserved = creditGate.reserve(key.getInstituteId(), List.of(charge),
                creditLimit(key), AiEvaluationCreditGate.Mode.API, prequote);
        return reserved == null || reserved.isEmpty() ? AiEvaluationCreditGate.Reservation.NONE : reserved.get(0);
    }

    private StudentAttempt newAttempt(ApiKeyPrincipal key, String examId, String registrationId) {
        OfflineAttemptCreateResponse created = offlineEntry.createOfflineAttempt(ApiActorPrincipals.forKey(key), examId,
                registrationId, key.getInstituteId(), null).getBody();
        if (created == null || created.getAttemptId() == null) {
            throw new IllegalStateException("offline attempt was not created");
        }
        return attemptRepository.findById(created.getAttemptId())
                .orElseThrow(() -> new IllegalStateException("offline attempt not found after creation"));
    }

    private void insertSubmission(ApiKeyPrincipal key, String examId, Registered reg, String attemptId, String mode,
            String uploadId, Integer pages, String metadataJson, String reasonsJson) {
        try {
            store.insert(attemptId, examId, reg.candidateId(), key.getInstituteId(), key.getKeyId(), mode, uploadId, pages,
                    metadataJson, reasonsJson);
        } catch (DuplicateKeyException race) {
            // The registration lock makes this unreachable in practice; the index is the backstop.
            throw OpenApiException.conflict(ApiErrorCode.SUBMISSION_EXISTS,
                    "This candidate already has a submission on this exam.", Map.of("candidate_id", reg.candidateId()));
        }
    }

    private void auditCreate(ApiKeyPrincipal key, String examId, String attemptId, String candidateId, String replaced,
            String mode, Integer pages) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("submission_id", attemptId);
        payload.put("candidate_id", candidateId);
        payload.put("mode", mode);
        if (pages != null) {
            payload.put("pages", pages);
        }
        if (replaced != null) {
            payload.put("replaced_submission_id", replaced);
        }
        audit.record(key, OpenApiAudit.ACTION_SUBMISSION_CREATE, examId, "Submission created through the API", payload);
    }

    private void requireGradable(String examId) {
        if (paper(examId).isEmpty()) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.NO_GRADABLE_QUESTIONS,
                    "The exam has no questions to grade.");
        }
    }

    private List<OpenQuestionService.ExamQuestion> paper(String examId) {
        return questions.load(examId);
    }

    static void requireOpen(ApiExamStore.ApiExamRow exam) {
        if (exam.isDraft()) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_NOT_OPEN,
                    "The exam is a draft; open it (POST /exams/{id}/open) before submitting.",
                    Map.of("exam_id", exam.assessmentId()));
        }
        // No exam_finalized refusal here: an exam is "finalized" only as a derived status
        // (every live submission finalized, spec 8.2). Refusing new copies on it would trap a
        // partner who finalizes as they go; a new copy simply makes the exam open again
        // (reopenIfFinalized).
    }

    /**
     * A new live submission means not every submission is finalized any more (spec 8.2).
     * Always issued, not only when the row read earlier says finalized: a finalize that
     * committed after that read is reverted too. The UPDATE matches (and locks) nothing
     * while finalized_at is null, so open exams pay no row lock.
     */
    private void reopenIfFinalized(String examId) {
        examStore.clearFinalized(examId);
    }

    static void validateCandidateRef(SubmissionInputs.CreateSubmission body) {
        boolean hasId = body.getCandidateId() != null && !body.getCandidateId().isBlank();
        boolean hasCandidate = body.getCandidate() != null;
        if (hasId == hasCandidate) {
            throw OpenApiException.validation("candidate", "required", "Send either candidate_id or candidate.");
        }
        if (hasCandidate) {
            List<OpenApiException.FieldError> errors = new ArrayList<>();
            ExamValidator.validateCandidates(List.of(body.getCandidate()), "candidate", errors);
            if (!errors.isEmpty()) {
                throw OpenApiException.validation(errors.stream().map(e -> new OpenApiException.FieldError(
                        e.field() == null ? null : e.field().replace("candidate[0]", "candidate"), e.code(),
                        e.message())).toList());
            }
        }
    }

    String metadataJson(com.fasterxml.jackson.databind.JsonNode metadata) {
        if (metadata == null || metadata.isNull()) {
            return null;
        }
        if (!metadata.isObject()) {
            throw OpenApiException.validation("metadata", "invalid", "metadata must be a JSON object.");
        }
        String json = metadata.toString();
        if (json.getBytes(StandardCharsets.UTF_8).length > ExamValidator.MAX_METADATA_BYTES) {
            throw OpenApiException.validation("metadata", "too_large", "metadata is at most 2 KB.");
        }
        return json;
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    Map<String, Object> quote(String unit, int units, AiEvaluationCreditGate.Reservation reservation) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unit", unit);
        out.put("page".equals(unit) ? "pages" : "answers", units);
        out.put("credits", reservation == null || reservation.quotedCredits() == null ? null
                : vacademy.io.assessment_service.features.open_evaluation.error.OpenApiErrors.plain(reservation.quotedCredits()));
        out.put("rate_source", RateSources.publicName(rateSource(reservation)));
        return out;
    }

    static Map<String, Object> quoteNone() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unit", "answer");
        out.put("answers", 0);
        out.put("credits", 0);
        out.put("rate_source", null);
        return out;
    }

    private String rateSource(AiEvaluationCreditGate.Reservation reservation) {
        if (reservation == null || reservation.rateSnapshotJson() == null) {
            return null;
        }
        try {
            var node = objectMapper.readTree(reservation.rateSnapshotJson()).path("rate_source");
            return node.isTextual() ? node.asText() : null;
        } catch (Exception e) {
            return null;
        }
    }

    static BigDecimal creditLimit(ApiKeyPrincipal key) {
        return key.getCreditLimit() == null || key.getCreditLimit().signum() < 0 ? BigDecimal.ZERO : key.getCreditLimit();
    }

    static Map<String, Object> warning(String code, String message, String field) {
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("code", code);
        w.put("message", message);
        w.put("field", field);
        return w;
    }

    private static OpenApiException modeMismatch(String message) {
        return new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.MODE_MISMATCH, message);
    }

    private static OpenApiException featureNotAvailable(String message) {
        return new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.FEATURE_NOT_AVAILABLE, message);
    }

    // ================================================================== reads

    public static OpenApiException submissionNotFound() {
        return OpenApiException.notFound(ApiErrorCode.SUBMISSION_NOT_FOUND, "No submission with this id.");
    }

    public ApiSubmissionStore.SubmissionView requireView(ApiKeyPrincipal key, String submissionId) {
        return store.findView(key.getInstituteId(), submissionId).orElseThrow(OpenSubmissionService::submissionNotFound);
    }

    /** The status object, with queue position / ETA while queued or running. */
    public Map<String, Object> view(ApiKeyPrincipal key, ApiSubmissionStore.SubmissionView v) {
        return SubmissionViews.status(v, estimate(key, v));
    }

    public Map<String, Object> get(ApiKeyPrincipal key, String submissionId) {
        return view(key, requireView(key, submissionId));
    }

    QueueEtaService.Estimate estimate(ApiKeyPrincipal key, ApiSubmissionStore.SubmissionView v) {
        if (eta == null || v.processId() == null || v.processStatus() == null
                || AiEvaluationStatusEnum.TERMINAL.contains(v.processStatus())) {
            return null;
        }
        Integer override = "TYPED".equalsIgnoreCase(v.lane()) ? key.getTypedLaneCap() : key.getCopyLaneCap();
        return eta.estimate(v.processInstituteId() != null ? v.processInstituteId() : v.instituteId(), v.processStatus(),
                v.lane(), v.processCreatedAt(), v.processStartedAt(), v.pageCount() != null ? v.pageCount() : v.pages(),
                v.questionsCompleted(), v.questionsTotal(), override);
    }

    /**
     * {@code GET /exams/{id}/submissions} and the feed ({@code examId == null}).
     *
     * @param resultOf builds the full result for {@code include=result}; null = not asked
     */
    public Paging.Page<Map<String, Object>> list(ApiKeyPrincipal key, String examId, String status, String needsReview,
            String finalized, String candidateId, String updatedSince, String cursor, Integer limit,
            Function<ApiSubmissionStore.SubmissionView, Map<String, Object>> resultOf) {
        if (examId != null) {
            ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        } else if (updatedSince == null || updatedSince.isBlank()) {
            throw OpenApiException.validation("updated_since", "required",
                    "updated_since is required on the cross-exam feed (start with an old time, then use next_cursor).");
        }
        int size = Paging.limit(limit);
        if (resultOf != null && size > MAX_RESULT_LIMIT) {
            size = MAX_RESULT_LIMIT;
        }
        ApiSubmissionStore.Filters filters = new ApiSubmissionStore.Filters(statuses(status), bool("needs_review", needsReview),
                bool("finalized", finalized), candidateId == null || candidateId.isBlank() ? null : candidateId.trim(),
                Paging.updatedSince(updatedSince));
        List<ApiSubmissionStore.SubmissionView> rows = store.list(key.getInstituteId(), examId, examId != null, filters,
                Paging.decode(cursor), size + 1);
        Paging.Page<ApiSubmissionStore.SubmissionView> page = Paging.page(rows, size,
                r -> new Paging.Cursor(r.updatedAt(), r.attemptId()));
        List<Map<String, Object>> data = new ArrayList<>();
        for (ApiSubmissionStore.SubmissionView v : page.data()) {
            Map<String, Object> row = view(key, v);
            if (resultOf != null && v.isLive()) {
                row.put("result", resultOf.apply(v));
            }
            data.add(row);
        }
        return new Paging.Page<>(data, page.nextCursor(), page.hasMore());
    }

    public static final int RESULTS_DEFAULT_LIMIT = 20;

    /**
     * {@code GET /exams/{id}/results} (spec 7.8): one result per LIVE submission of the exam, in
     * the shape of {@code GET /submissions/{id}/result} ({@code resultOf}), ordered by
     * (updated_at, id) like every list. {@code limit} 1-50 (default 20: a result is the heavy
     * read), {@code cursor}, {@code updated_since}, {@code finalized}. JSON only; {@code format=csv}
     * is Phase 2. An exam of another institute is 404.
     */
    public Paging.Page<Map<String, Object>> results(ApiKeyPrincipal key, String examId, String format, String finalized,
            String updatedSince, String cursor, Integer limit,
            Function<ApiSubmissionStore.SubmissionView, Map<String, Object>> resultOf) {
        ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        requireJson(format);
        int size = resultsLimit(limit);
        ApiSubmissionStore.Filters filters = new ApiSubmissionStore.Filters(null, null, bool("finalized", finalized), null,
                Paging.updatedSince(updatedSince));
        List<ApiSubmissionStore.SubmissionView> rows = store.list(key.getInstituteId(), examId, true, filters,
                Paging.decode(cursor), size + 1);
        Paging.Page<ApiSubmissionStore.SubmissionView> page = Paging.page(rows, size,
                r -> new Paging.Cursor(r.updatedAt(), r.attemptId()));
        List<Map<String, Object>> data = new ArrayList<>();
        for (ApiSubmissionStore.SubmissionView v : page.data()) {
            data.add(resultOf.apply(v));
        }
        return new Paging.Page<>(data, page.nextCursor(), page.hasMore());
    }

    static void requireJson(String format) {
        if (format == null || format.isBlank()) {
            return;
        }
        String f = format.trim().toLowerCase(Locale.ROOT);
        if ("csv".equals(f)) {
            throw featureNotAvailable("format=csv is not available yet; use format=json (the default).");
        }
        if (!"json".equals(f)) {
            throw OpenApiException.validation("format", "invalid", "format must be json or csv.");
        }
    }

    static int resultsLimit(Integer limit) {
        if (limit == null) {
            return RESULTS_DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_RESULT_LIMIT) {
            throw OpenApiException.validation("limit", "out_of_range",
                    "limit must be between 1 and " + MAX_RESULT_LIMIT + ".");
        }
        return limit;
    }

    static List<String> statuses(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        List<String> out = new ArrayList<>();
        for (String s : status.split(",")) {
            String v = s.trim().toLowerCase(Locale.ROOT);
            if (v.isEmpty()) {
                continue;
            }
            if (!STATUSES.contains(v)) {
                throw OpenApiException.validation("status", "invalid", "Unknown status " + s.trim() + ".");
            }
            out.add(v);
        }
        return out.isEmpty() ? null : out;
    }

    static Boolean bool(String field, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "true" -> Boolean.TRUE;
            case "false" -> Boolean.FALSE;
            default -> throw OpenApiException.validation(field, "invalid", field + " must be true or false.");
        };
    }

    // ================================================================== re-evaluate

    public String reevaluate(ApiKeyPrincipal key, String submissionId, SubmissionInputs.Reevaluate body) {
        if (body != null && body.getQuestionIds() != null && !body.getQuestionIds().isEmpty()) {
            throw featureNotAvailable("Re-evaluating single questions is not available yet; omit question_ids to re-run the copy.");
        }
        boolean keepReviewed = body == null || body.getKeepReviewed() == null || body.getKeepReviewed();
        AiEvaluationCreditGate.Prequote prequote = reevaluatePrequote(key, submissionId);
        return tx.execute(status -> {
            ApiSubmissionStore.SubmissionRow row = requireLive(key, submissionId);
            StudentAttempt attempt = attemptRepository.findById(row.attemptId()).orElseThrow(OpenSubmissionService::submissionNotFound);
            lockGuard.requireNotFinalized(attempt);
            ApiSubmissionStore.SubmissionView before = requireView(key, submissionId);
            if (before.processStatus() != null && AiEvaluationStatusEnum.ACTIVE.contains(before.processStatus())) {
                throw OpenApiException.conflict(ApiErrorCode.EVALUATION_IN_PROGRESS,
                        "This submission is still being evaluated; cancel it or wait.", Map.of("submission_id", submissionId));
            }
            ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), row.examId(), false);
            requireGradable(exam.assessmentId());
            boolean typedRun = ExamValidator.MODE_TYPED.equals(row.mode()) || exam.isTyped();
            AiEvaluationCharge charge = rerunCharge(typedRun, row.attemptId(), row.pages());
            Integer pages = typedRun ? null : row.pages();
            AiEvaluationCreditGate.Reservation reservation = reserve(key, charge, prequote);
            quota.consumeCopies(key, 1, pages == null ? 1 : 0, pages == null ? 0 : pages);
            String newProcess = aiEvaluationService.initiateEvaluationForAttempt(attempt, null, true, null,
                    AiEvaluationEnqueueContext.api(key.getKeyId(), creditLimit(key), pages, charge)
                            .withReservation(reservation));
            if (keepReviewed && before.processId() != null && !before.processId().equals(newProcess)) {
                for (Map<String, Object> edited : resultStore.editedRows(before.processId())) {
                    resultStore.insertCarriedRow(UUID.randomUUID().toString(), newProcess, edited);
                }
            }
            store.clearApproved(row.attemptId());
            return row.attemptId();
        });
    }

    /** What a re-run of the copy is charged: per non-blank written answer (typed) or per page. */
    private AiEvaluationCharge rerunCharge(boolean typed, String attemptId, Integer pages) {
        if (typed) {
            int answers = nonBlankTypedAnswers(attemptId);
            if (answers == 0) {
                throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.NO_GRADABLE_QUESTIONS,
                        "This submission has no written answer for the AI to grade.");
            }
            return AiEvaluationCharge.apiTyped(answers);
        }
        if (pages == null || pages < 1) {
            throw new IllegalStateException("handwritten submission without a page count");
        }
        return AiEvaluationCharge.apiHandwritten(pages);
    }

    /**
     * Best-effort quote of the re-run before the transaction, from an unlocked read. Any
     * refusal is left to the transaction, which re-checks everything under its locks and
     * quotes again itself only when the charge it computes differs.
     */
    private AiEvaluationCreditGate.Prequote reevaluatePrequote(ApiKeyPrincipal key, String submissionId) {
        try {
            var view = store.findView(key.getInstituteId(), submissionId).orElse(null);
            if (view == null || !ApiSubmissionStore.LIVE.equals(view.state())) {
                return AiEvaluationCreditGate.Prequote.NONE;
            }
            boolean typed = ExamValidator.MODE_TYPED.equals(view.mode());
            return prequote(key, rerunCharge(typed, view.attemptId(), view.pages()));
        } catch (RuntimeException e) {
            return AiEvaluationCreditGate.Prequote.NONE;
        }
    }

    /** Written answers with text on the attempt: what a typed re-run would grade and bill. */
    int nonBlankTypedAnswers(String attemptId) {
        int n = 0;
        for (QuestionWiseMarks m : marksRepository.findByStudentAttemptIdWithQuestionDetails(attemptId)) {
            if (!TypedAnswerEvaluation.isAiGraded(m.getQuestion())) {
                continue;
            }
            String text = typedAnswerEvaluation.typedAnswer(m);
            if (text != null && !text.isBlank()) {
                n++;
            }
        }
        return n;
    }

    // ================================================================== cancel / delete

    /** {@code POST /submissions/{id}/cancel}: queued → cancelled at once; running → stopped. */
    public void cancel(ApiKeyPrincipal key, String submissionId) {
        tx.executeWithoutResult(status -> {
            ApiSubmissionStore.SubmissionRow row = requireLive(key, submissionId);
            ApiSubmissionStore.SubmissionView v = requireView(key, submissionId);
            if (v.processStatus() == null || AiEvaluationStatusEnum.COMPLETED.name().equals(v.processStatus())
                    || AiEvaluationStatusEnum.FAILED.name().equals(v.processStatus())) {
                throw OpenApiException.conflict(ApiErrorCode.ALREADY_COMPLETED,
                        "This submission's evaluation has already finished.", Map.of("submission_id", submissionId));
            }
            if (AiEvaluationStatusEnum.CANCELLED.name().equals(v.processStatus())) {
                return; // idempotent
            }
            canceller.cancelLiveRuns(row.attemptId());
            feed.touch(row.attemptId());
        });
    }

    /** {@code DELETE /submissions/{id}}: not finalized only; attempt and submission DELETED, runs cancelled. */
    public void delete(ApiKeyPrincipal key, String submissionId) {
        tx.executeWithoutResult(status -> {
            ApiSubmissionStore.SubmissionRow row = requireLive(key, submissionId);
            StudentAttempt attempt = attemptRepository.findById(row.attemptId()).orElse(null);
            lockGuard.requireNotFinalized(attempt);
            canceller.cancelLiveRuns(row.attemptId());
            store.markAttemptDeleted(row.attemptId());
            store.markDeleted(row.attemptId());
            audit.record(key, OpenApiAudit.ACTION_SUBMISSION_DELETE, row.examId(), "Submission deleted through the API",
                    Map.of("submission_id", row.attemptId()));
        });
    }

    /** The LIVE submission of this institute, locked; replaced and deleted ones are 404. */
    public ApiSubmissionStore.SubmissionRow requireLive(ApiKeyPrincipal key, String submissionId) {
        ApiSubmissionStore.SubmissionRow row = store.findForUpdate(key.getInstituteId(), submissionId)
                .orElseThrow(OpenSubmissionService::submissionNotFound);
        if (!ApiSubmissionStore.LIVE.equals(row.status())) {
            throw submissionNotFound();
        }
        return row;
    }

}
