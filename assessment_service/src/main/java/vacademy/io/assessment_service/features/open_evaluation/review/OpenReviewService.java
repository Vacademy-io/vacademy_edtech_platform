package vacademy.io.assessment_service.features.open_evaluation.review;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationReviewService;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultRules;
import vacademy.io.assessment_service.features.open_evaluation.result.ResultStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.core.utils.PlainText;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Review through the API (spec 7.9, T1.26).
 *
 * <ul>
 *   <li>{@code PATCH /submissions/{id}/questions/{qid}}: the dashboard's own
 *       {@code AiEvaluationReviewService.overrideQuestion} on the newest row of the latest run,
 *       editor {@code apikey:{key_id}}; the partner's reviewer and reason go to
 *       {@code review_meta} (plain text, stored escaped) and show on the dashboard. Marks in
 *       0.5 steps within [0, max], else 422 {@code invalid_marks}.</li>
 *   <li>{@code POST /submissions/{id}/approve}: the AI marks stand as reviewed:
 *       {@code review_meta.approved_by} on every question of the run, and the submission's own
 *       reasons (long copy) cleared — {@code needs_review} goes false.</li>
 * </ul>
 * Both refuse a finalized submission (409 {@code submission_finalized}, ResultLockGuard) and a
 * question still being graded (409 {@code evaluation_in_progress}).
 */
@Service
public class OpenReviewService {

    public static final int MAX_FEEDBACK = 4_000;
    public static final int MAX_REVIEWER = 120;
    public static final int MAX_REASON = 500;
    static final BigDecimal HALF = new BigDecimal("0.5");

    private final OpenSubmissionService submissions;
    private final OpenQuestionService questions;
    private final ApiSubmissionStore store;
    private final ResultStore resultStore;
    private final AiEvaluationReviewService reviewService;
    private final StudentAttemptRepository attemptRepository;
    private final ResultLockGuard lockGuard;
    private final OpenApiAudit audit;
    private final ObjectMapper objectMapper;
    private Clock clock = Clock.systemUTC();

    @PersistenceContext
    private EntityManager entityManager;

    public OpenReviewService(OpenSubmissionService submissions, OpenQuestionService questions, ApiSubmissionStore store,
            ResultStore resultStore, AiEvaluationReviewService reviewService, StudentAttemptRepository attemptRepository,
            ResultLockGuard lockGuard, OpenApiAudit audit, ObjectMapper objectMapper) {
        this.submissions = submissions;
        this.questions = questions;
        this.store = store;
        this.resultStore = resultStore;
        this.reviewService = reviewService;
        this.attemptRepository = attemptRepository;
        this.lockGuard = lockGuard;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    void setEntityManager(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional
    public Map<String, Object> overrideQuestion(ApiKeyPrincipal key, String submissionId, String questionId,
            SubmissionInputs.ReviewQuestion body) {
        if (body == null) {
            throw OpenApiException.validation("awarded", "required", "awarded is required.");
        }
        ApiSubmissionStore.SubmissionRow row = submissions.requireLive(key, submissionId);
        StudentAttempt attempt = attemptRepository.findById(row.attemptId()).orElseThrow(OpenSubmissionService::submissionNotFound);
        lockGuard.requireNotFinalized(attempt);
        ApiSubmissionStore.SubmissionView v = submissions.requireView(key, submissionId);
        OpenQuestionService.ExamQuestion question = questions.load(row.examId()).stream()
                .filter(q -> q.id().equals(questionId)).findFirst().orElseThrow(ExamGuards::questionNotFound);
        boolean runActive = v.processStatus() != null && AiEvaluationStatusEnum.ACTIVE.contains(v.processStatus());
        ResultStore.AiRow aiRow = v.processId() == null ? null : resultStore.aiRows(v.processId()).get(questionId);
        if (aiRow == null) {
            if (runActive) {
                throw inProgress(submissionId);
            }
            throw OpenApiException.validation("question_id", "not_ai_graded",
                    "Question " + question.label() + " was marked automatically; there is no AI result to review.");
        }
        String rowStatus = aiRow.status() == null ? "" : aiRow.status().toUpperCase();
        if (!rowStatus.equals("COMPLETED") && !rowStatus.equals("FAILED")) {
            throw inProgress(submissionId);
        }
        BigDecimal max = aiRow.maxMarks() != null ? aiRow.maxMarks() : question.maxMarks();
        BigDecimal awarded = validMarks(body.getAwarded(), max);
        String feedback = optionalText(body.getFeedback(), "feedback", MAX_FEEDBACK);
        String reason = optionalText(body.getReason(), "reason", MAX_REASON);
        Map<String, Object> reviewer = reviewer(body.getReviewer());

        reviewService.overrideQuestion(v.processId(), questionId, awarded.doubleValue(),
                feedback == null ? null : PlainText.escape(feedback), key.actorId());
        if (entityManager != null) {
            entityManager.flush();
        }
        ObjectNode meta = objectMapper.createObjectNode();
        if (reviewer != null) {
            meta.set("reviewer", objectMapper.valueToTree(reviewer));
        }
        if (reason != null) {
            meta.put("reason", PlainText.escape(reason));
        }
        meta.put("via", "api");
        meta.put("key_id", key.getKeyId());
        meta.put("reviewed_at", clock.instant().toString());
        if (feedback != null) {
            meta.put("feedback_escaped", true);
        }
        resultStore.mergeReviewMeta(v.processId(), questionId, meta.toString());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("submission_id", row.attemptId());
        payload.put("question_id", questionId);
        payload.put("awarded", awarded);
        if (reviewer != null && reviewer.get("ref") != null) {
            payload.put("reviewer_ref", reviewer.get("ref"));
        }
        audit.record(key, OpenApiAudit.ACTION_OVERRIDE, row.examId(), "AI marks overridden through the API", payload);

        ResultStore.AiRow fresh = resultStore.aiRows(v.processId()).get(questionId);
        ResultStore.MarksRow marks = resultStore.marks(row.attemptId()).get(questionId);
        return ResultRules.question(question, fresh, marks, false, new ResultRules.Include(false, true, false)).view();
    }

    @Transactional
    public String approve(ApiKeyPrincipal key, String submissionId, SubmissionInputs.Approve body) {
        ApiSubmissionStore.SubmissionRow row = submissions.requireLive(key, submissionId);
        StudentAttempt attempt = attemptRepository.findById(row.attemptId()).orElseThrow(OpenSubmissionService::submissionNotFound);
        lockGuard.requireNotFinalized(attempt);
        ApiSubmissionStore.SubmissionView v = submissions.requireView(key, submissionId);
        if (v.processStatus() != null && AiEvaluationStatusEnum.ACTIVE.contains(v.processStatus())) {
            throw inProgress(submissionId);
        }
        Map<String, Object> reviewer = reviewer(body == null ? null : body.getReviewer());
        if (v.processId() != null) {
            ObjectNode approvedBy = objectMapper.createObjectNode();
            approvedBy.put("key_id", key.getKeyId());
            if (reviewer != null) {
                approvedBy.set("reviewer", objectMapper.valueToTree(reviewer));
            }
            ObjectNode meta = objectMapper.createObjectNode();
            meta.set("approved_by", approvedBy);
            meta.put("approved_at", clock.instant().toString());
            resultStore.mergeReviewMetaAll(v.processId(), meta.toString());
        }
        store.setApproved(row.attemptId(), key.actorId());
        audit.record(key, OpenApiAudit.ACTION_APPROVE, row.examId(), "AI marks approved through the API",
                Map.of("submission_id", row.attemptId()));
        return row.attemptId();
    }

    /** awarded: required, a multiple of 0.5, within [0, max]; 422 invalid_marks otherwise. */
    static BigDecimal validMarks(BigDecimal awarded, BigDecimal max) {
        if (awarded == null) {
            throw OpenApiException.validation("awarded", "required", "awarded is required.");
        }
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("awarded", awarded);
        details.put("max", max);
        if (awarded.signum() < 0 || (max != null && awarded.compareTo(max) > 0)) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.INVALID_MARKS,
                    "awarded must be between 0 and " + (max == null ? "the question's maximum" : max.stripTrailingZeros().toPlainString())
                            + ".", details);
        }
        if (awarded.remainder(HALF).signum() != 0) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.INVALID_MARKS,
                    "awarded must be a multiple of 0.5.", details);
        }
        return awarded;
    }

    static String optionalText(String value, String field, int max) {
        if (value == null) {
            return null;
        }
        if (value.length() > max) {
            throw OpenApiException.validation(field, "too_long", field + " may be at most " + max + " characters.");
        }
        return value;
    }

    /** Reviewer fields, escaped for storage (the dashboard renders review_meta). */
    static Map<String, Object> reviewer(SubmissionInputs.Reviewer reviewer) {
        if (reviewer == null || (reviewer.getRef() == null && reviewer.getName() == null)) {
            return null;
        }
        String ref = optionalText(reviewer.getRef(), "reviewer.ref", MAX_REVIEWER);
        String name = optionalText(reviewer.getName(), "reviewer.name", MAX_REVIEWER);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ref", ref == null ? null : PlainText.escape(ref));
        out.put("name", name == null ? null : PlainText.escape(name));
        return out;
    }

    private static OpenApiException inProgress(String submissionId) {
        return OpenApiException.conflict(ApiErrorCode.EVALUATION_IN_PROGRESS,
                "This answer is still being graded; retry when the submission is graded.",
                Map.of("submission_id", submissionId));
    }
}
