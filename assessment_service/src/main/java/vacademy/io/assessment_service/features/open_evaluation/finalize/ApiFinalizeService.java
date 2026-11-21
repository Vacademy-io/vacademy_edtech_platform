package vacademy.io.assessment_service.features.open_evaluation.finalize;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.ReleaseStateWriter;
import vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.policy.ResultLockGuard;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.SubmissionViews;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Finalize and unfinalize (spec 7.10, T1.27).
 *
 * <p>Finalize publishes AI drafts as final marks through {@link ReleaseStateWriter} — the
 * state change behind the dashboard's Release Result, shared with it — and nothing else: no
 * report PDF, no checked-copy email, no learner or admin notification, no
 * {@code ASSESSMENT_RESULT_RELEASED} workflow event. Every submission must belong to the exam,
 * and the exam to the key's institute (the dashboard release path does not check this).
 * Graded copies are finalized; partly graded and failed ones only with
 * {@code allow_partial} (failed questions count 0); queued or running ones never.
 *
 * <p>Unfinalize puts one result back on hold ({@code report_release_status = PENDING}) with
 * a required reason, recorded with the actor in the activity log.
 */
@Service
public class ApiFinalizeService {

    public static final int MAX_BATCH = 500;
    public static final int MAX_REASON = 500;

    static final String SKIP_ALREADY = "already_finalized";
    static final String SKIP_NOT_GRADED = "not_graded";
    static final String SKIP_PARTIAL = "partially_graded";
    static final String SKIP_FAILED = "failed";

    private final ApiExamStore examStore;
    private final ApiSubmissionStore store;
    private final StudentAttemptRepository attemptRepository;
    private final ReleaseStateWriter releaseStateWriter;
    private final OpenSubmissionService submissions;
    private final OpenApiAudit audit;

    @PersistenceContext
    private EntityManager entityManager;

    public ApiFinalizeService(ApiExamStore examStore, ApiSubmissionStore store, StudentAttemptRepository attemptRepository,
            ReleaseStateWriter releaseStateWriter, OpenSubmissionService submissions,
            OpenApiAudit audit) {
        this.examStore = examStore;
        this.store = store;
        this.attemptRepository = attemptRepository;
        this.releaseStateWriter = releaseStateWriter;
        this.submissions = submissions;
        this.audit = audit;
    }

    void setEntityManager(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Transactional
    public Map<String, Object> finalizeExam(ApiKeyPrincipal key, String examId, SubmissionInputs.Finalize body) {
        boolean all = body != null && Boolean.TRUE.equals(body.getAllGraded());
        List<String> ids = body == null || body.getSubmissionIds() == null ? List.of() : body.getSubmissionIds();
        if (all == !ids.isEmpty()) {
            throw OpenApiException.validation("submission_ids", "required",
                    "Send either submission_ids (up to " + MAX_BATCH + ") or all_graded: true.");
        }
        if (ids.size() > MAX_BATCH) {
            throw OpenApiException.validation("submission_ids", "too_many", "At most " + MAX_BATCH + " submission_ids per call.");
        }
        boolean allowPartial = body != null && Boolean.TRUE.equals(body.getAllowPartial());

        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        if (exam.isDraft()) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_NOT_OPEN, "The exam is a draft; nothing to finalize.",
                    Map.of("exam_id", examId));
        }

        List<ApiSubmissionStore.SubmissionView> candidates;
        boolean hasMore = false;
        if (all) {
            List<String> statuses = new ArrayList<>(List.of(PublicStatus.GRADED));
            if (allowPartial) {
                statuses.add(PublicStatus.PARTIALLY_GRADED);
                statuses.add(PublicStatus.FAILED);
            }
            candidates = store.unfinalizedForExam(key.getInstituteId(), examId, statuses, MAX_BATCH + 1);
            if (candidates.size() > MAX_BATCH) {
                hasMore = true;
                candidates = candidates.subList(0, MAX_BATCH);
            }
        } else {
            Set<String> unique = new LinkedHashSet<>(ids);
            candidates = store.findViews(key.getInstituteId(), unique);
            Set<String> missing = new LinkedHashSet<>(unique);
            for (ApiSubmissionStore.SubmissionView v : candidates) {
                if (v.isLive() && examId.equals(v.examId())) {
                    missing.remove(v.attemptId());
                }
            }
            if (!missing.isEmpty()) {
                throw new OpenApiException(HttpStatus.NOT_FOUND, ApiErrorCode.SUBMISSION_NOT_FOUND,
                        missing.size() + " submission id(s) are not live submissions of this exam.",
                        Map.of("submission_ids", List.copyOf(missing)));
            }
            Map<String, ApiSubmissionStore.SubmissionView> byId = new LinkedHashMap<>();
            candidates.forEach(v -> byId.put(v.attemptId(), v));
            candidates = unique.stream().map(byId::get).toList();
        }

        List<String> toFinalize = new ArrayList<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (ApiSubmissionStore.SubmissionView v : candidates) {
            String reason = skipReason(v, allowPartial);
            if (reason == null) {
                toFinalize.add(v.attemptId());
            } else {
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("id", v.attemptId());
                s.put("reason", reason);
                skipped.add(s);
            }
        }
        List<String> finalized = new ArrayList<>();
        if (!toFinalize.isEmpty()) {
            // The picks above came from unlocked reads. Take re-evaluate's lock, then decide
            // again from a fresh read: a run queued in between is skipped, not released.
            store.lockSubmissions(toFinalize);
            toFinalize = recheck(key, toFinalize, allowPartial, skipped);
        }
        if (!toFinalize.isEmpty()) {
            store.lockAttempts(toFinalize);
            List<StudentAttempt> attempts = new ArrayList<>();
            for (StudentAttempt a : attemptRepository.findAllById(toFinalize)) {
                if (!ResultLockGuard.isFinalized(a)) {
                    attempts.add(a);
                    finalized.add(a.getId());
                }
            }
            releaseStateWriter.release(attempts);
            // The release is JPA; the check below is SQL.
            if (entityManager != null) {
                entityManager.flush();
            }
        }
        if (store.allFinalized(examId)) {
            examStore.markFinalized(examId);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("finalized", finalized.size());
        payload.put("skipped", skipped.size());
        payload.put("submission_ids", finalized);
        audit.record(key, OpenApiAudit.ACTION_FINALIZE, examId, "Results finalized through the API", payload);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("finalized", finalized);
        out.put("skipped", skipped);
        out.put("has_more", hasMore);
        return out;
    }

    /** Re-applies {@link #skipReason} to a fresh read of the locked rows; moves refusals to skipped. */
    private List<String> recheck(ApiKeyPrincipal key, List<String> picked, boolean allowPartial,
            List<Map<String, Object>> skipped) {
        Map<String, ApiSubmissionStore.SubmissionView> fresh = new LinkedHashMap<>();
        for (ApiSubmissionStore.SubmissionView v : store.findViews(key.getInstituteId(), picked)) {
            fresh.put(v.attemptId(), v);
        }
        List<String> keep = new ArrayList<>();
        for (String id : picked) {
            ApiSubmissionStore.SubmissionView v = fresh.get(id);
            String reason = v == null || !v.isLive() ? SKIP_NOT_GRADED : skipReason(v, allowPartial);
            if (reason == null) {
                keep.add(id);
            } else {
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("id", id);
                s.put("reason", reason);
                skipped.add(s);
            }
        }
        return keep;
    }

    /** Null = finalize; otherwise why the submission is skipped. */
    static String skipReason(ApiSubmissionStore.SubmissionView v, boolean allowPartial) {
        if (v.isFinalized()) {
            return SKIP_ALREADY;
        }
        String status = SubmissionViews.publicStatus(v);
        return switch (status) {
            case PublicStatus.GRADED -> null;
            case PublicStatus.PARTIALLY_GRADED -> allowPartial ? null : SKIP_PARTIAL;
            case PublicStatus.FAILED -> allowPartial ? null : SKIP_FAILED;
            default -> SKIP_NOT_GRADED;
        };
    }

    @Transactional
    public String unfinalize(ApiKeyPrincipal key, String submissionId, SubmissionInputs.Unfinalize body) {
        String reason = body == null || body.getReason() == null ? null : body.getReason().trim();
        if (reason == null || reason.isEmpty()) {
            throw OpenApiException.validation("reason", "required", "reason is required (e.g. the revaluation request number).");
        }
        if (reason.length() > MAX_REASON) {
            throw OpenApiException.validation("reason", "too_long", "reason may be at most " + MAX_REASON + " characters.");
        }
        ApiSubmissionStore.SubmissionRow row = submissions.requireLive(key, submissionId);
        StudentAttempt attempt = attemptRepository.findById(row.attemptId()).orElseThrow(OpenSubmissionService::submissionNotFound);
        if (!ResultLockGuard.isFinalized(attempt)) {
            throw OpenApiException.conflict(ApiErrorCode.SUBMISSION_NOT_FINALIZED, "This submission is not finalized.",
                    Map.of("submission_id", submissionId));
        }
        releaseStateWriter.withdraw(attempt);
        examStore.clearFinalized(row.examId());
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("submission_id", row.attemptId());
        payload.put("reason", reason);
        audit.record(key, OpenApiAudit.ACTION_UNFINALIZE, row.examId(), "Result unfinalized through the API: " + reason,
                payload);
        return row.attemptId();
    }
}
