package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiErrors;
import vacademy.io.assessment_service.features.open_evaluation.queue.QueueEtaService;
import vacademy.io.assessment_service.features.open_evaluation.result.FailureCodes;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The submission status object (spec 7.6 {@code GET /submissions/{id}}), built from one
 * {@link ApiSubmissionStore.SubmissionView}. The same shape answers create, get, lists and
 * the feed, so a partner parses one thing.
 */
public final class SubmissionViews {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SubmissionViews() {
    }

    public static String publicStatus(ApiSubmissionStore.SubmissionView v) {
        return PublicStatus.submission(v.processStatus(), v.anyQuestionFailed());
    }

    /** Submission-level reasons (e.g. pages_beyond_vision_limit) until a reviewer approves. */
    public static List<String> submissionReasons(ApiSubmissionStore.SubmissionView v) {
        List<String> out = new ArrayList<>();
        if (v.approvedAt() != null || v.reviewReasonsJson() == null) {
            return out;
        }
        try {
            JsonNode node = MAPPER.readTree(v.reviewReasonsJson());
            if (node.isArray()) {
                node.forEach(n -> {
                    if (n.isTextual()) {
                        out.add(n.asText());
                    }
                });
            }
        } catch (Exception ignored) {
            // written by this service as a JSON array; never fails in practice
        }
        return out;
    }

    public static boolean needsReview(ApiSubmissionStore.SubmissionView v) {
        return v.questionNeedsReview() || !submissionReasons(v).isEmpty();
    }

    /**
     * @param eta the queue estimate for a queued or running copy; null otherwise
     */
    public static Map<String, Object> status(ApiSubmissionStore.SubmissionView v, QueueEtaService.Estimate eta) {
        String status = publicStatus(v);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", v.attemptId());
        out.put("exam_id", v.examId());
        Map<String, Object> candidate = new LinkedHashMap<>();
        candidate.put("id", v.candidateId());
        candidate.put("external_id", v.candidateExternalId());
        out.put("candidate", candidate);
        out.put("state", v.state() == null ? null : v.state().toLowerCase(Locale.ROOT));
        if (v.replacedBy() != null) {
            out.put("replaced_by", v.replacedBy());
        }
        out.put("status", status);
        out.put("lane", lane(v));
        out.put("pages", v.pages());
        out.put("needs_review", needsReview(v));
        out.put("review_reasons", submissionReasons(v));
        out.put("finalized", v.isFinalized());
        out.put("finalized_at", v.isFinalized() && v.reportLastReleaseDate() != null
                ? v.reportLastReleaseDate().toString() : null);
        out.put("progress", progress(v, status, eta));
        out.put("queue", PublicStatus.QUEUED.equals(status) && eta != null ? queue(eta) : null);
        out.put("attempt_count", v.runs());
        out.put("rubric_version", v.rubricVersion());
        out.put("credits_charged", creditsCharged(v));
        out.put("error", PublicStatus.FAILED.equals(status) ? FailureCodes.error(v.errorMessage(), v.currentStep()) : null);
        out.put("metadata", metadata(v.metadataJson()));
        out.put("created_at", v.createdAt() == null ? null : v.createdAt().toString());
        out.put("updated_at", v.updatedAt() == null ? null : v.updatedAt().toString());
        return out;
    }

    static String lane(ApiSubmissionStore.SubmissionView v) {
        if (v.lane() != null) {
            return v.lane().toLowerCase(Locale.ROOT);
        }
        return "typed".equals(v.mode()) ? "typed" : "copy";
    }

    static Map<String, Object> progress(ApiSubmissionStore.SubmissionView v, String status, QueueEtaService.Estimate eta) {
        if (v.processId() == null) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("step", v.currentStep());
        out.put("questions_done", v.questionsCompleted() == null ? 0 : v.questionsCompleted());
        out.put("questions_total", v.questionsTotal() == null ? 0 : v.questionsTotal());
        boolean running = PublicStatus.PROCESSING.equals(status) || PublicStatus.READING.equals(status)
                || PublicStatus.GRADING.equals(status);
        if (running && eta != null && eta.estimatedReadyAt() != null) {
            out.put("estimated_ready_at", eta.estimatedReadyAt().toString());
        }
        return out;
    }

    public static Map<String, Object> queue(QueueEtaService.Estimate eta) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("position", eta.position());
        out.put("estimated_ready_at", eta.estimatedReadyAt() == null ? null : eta.estimatedReadyAt().toString());
        return out;
    }

    /**
     * Fixed price: a graded copy costs exactly its quote; nothing is charged for a failed or
     * cancelled one. A typed submission graded without the AI costs 0.
     */
    static Number creditsCharged(ApiSubmissionStore.SubmissionView v) {
        if (v.processId() == null) {
            return 0;
        }
        if (!AiEvaluationStatusEnum.COMPLETED.name().equals(v.processStatus())) {
            return null;
        }
        BigDecimal quoted = v.quotedCredits();
        return quoted == null ? null : OpenApiErrors.plain(quoted);
    }

    static Object metadata(String json) {
        if (json == null) {
            return null;
        }
        try {
            return MAPPER.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }
}
