package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.assessment_service.features.question_core.util.CbeAnswers;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkedByKind;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.QuestionKinds;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;

/**
 * The state of one answer's mark (contract 4.2). Pure: the same rules back the
 * submission page, the list counts, the release gate and MarkWriter's result status.
 */
public final class MarkStateDeriver {

    private static final ObjectMapper JSON = new ObjectMapper();

    private MarkStateDeriver() {
    }

    public record Derived(MarkState state, boolean stored, MarkedByKind markedBy) {
    }

    public static Derived derive(Review.MarkRow row, Review.PaperKey key, SubmissionKind kind,
                                 String evaluationType, boolean released) {
        String type = key != null ? key.questionType() : null;
        if (row == null) {
            MarkState s = (kind == SubmissionKind.HANDWRITTEN || kind == SubmissionKind.SCANNED)
                    ? MarkState.NEEDS_MARKING : MarkState.NOT_ANSWERED;
            return new Derived(s, false, MarkedByKind.NONE);
        }
        String source = row.marksSource();
        // Rule 1: a stored state wins.
        if (row.markState() != null) {
            MarkState s;
            try {
                s = MarkState.valueOf(row.markState());
            } catch (IllegalArgumentException e) {
                s = MarkState.MARKED;
            }
            if (s == MarkState.AI_DRAFT && released) s = MarkState.MARKED;
            return new Derived(s, true, byKind(source, s, type, true));
        }
        // Rule 3
        if (MarksSource.AI.equals(source)) {
            return new Derived(released ? MarkState.MARKED : MarkState.AI_DRAFT, false, MarkedByKind.AI);
        }
        // Rule 4
        if (source != null && (MarksSource.isProtected(source) || MarksSource.AUTO.equals(source)
                || MarksSource.KEYWORD.equals(source))) {
            return new Derived(MarkState.MARKED, false, byKind(source, MarkState.MARKED, type, false));
        }
        boolean pending = row.status() == null || "PENDING".equals(row.status());
        // Rule 5: the answer-sheet test, marked by a teacher before history existed.
        if ("MANUAL".equalsIgnoreCase(evaluationType)) {
            return pending ? new Derived(MarkState.NEEDS_MARKING, false, MarkedByKind.NONE)
                    : new Derived(MarkState.MARKED, false, MarkedByKind.TEACHER_LEGACY);
        }
        boolean statusPending = "PENDING".equals(row.status());
        if (QuestionKinds.isCbe(type)) {
            if (statusPending) {
                return new Derived(isBlank(row, key) ? MarkState.NOT_ANSWERED : MarkState.NEEDS_MARKING, false,
                        MarkedByKind.NONE);
            }
            return new Derived(MarkState.MARKED, false, MarkedByKind.TEACHER_LEGACY);
        }
        if (QuestionKinds.isLongAnswer(type)) {
            if (statusPending) {
                return new Derived(isBlank(row, key) ? MarkState.NOT_ANSWERED : MarkState.NEEDS_MARKING, false,
                        MarkedByKind.NONE);
            }
            return new Derived(MarkState.MARKED, false, MarkedByKind.KEYWORD);
        }
        if (QuestionKinds.isObjective(type)) {
            return statusPending ? new Derived(MarkState.NOT_ANSWERED, false, MarkedByKind.NONE)
                    : new Derived(MarkState.MARKED, false, MarkedByKind.ANSWER_KEY);
        }
        return statusPending ? new Derived(MarkState.NEEDS_MARKING, false, MarkedByKind.NONE)
                : new Derived(MarkState.MARKED, false, MarkedByKind.TEACHER_LEGACY);
    }

    static MarkedByKind byKind(String source, MarkState state, String type, boolean stored) {
        if (state == MarkState.NOT_ANSWERED || state == MarkState.NEEDS_MARKING) return MarkedByKind.NONE;
        if (source == null) {
            if (QuestionKinds.isObjective(type)) return MarkedByKind.ANSWER_KEY;
            return MarkedByKind.TEACHER_LEGACY;
        }
        return switch (source) {
            case MarksSource.AUTO -> MarkedByKind.ANSWER_KEY;
            case MarksSource.KEYWORD -> MarkedByKind.KEYWORD;
            case MarksSource.AI -> MarkedByKind.AI;
            case MarksSource.AI_REVIEWED -> MarkedByKind.AI_REVIEWED;
            case MarksSource.MANUAL, MarksSource.TEACHER -> MarkedByKind.TEACHER;
            case MarksSource.OMR -> MarkedByKind.OMR;
            case MarksSource.OFFLINE -> MarkedByKind.OFFLINE;
            default -> MarkedByKind.TEACHER_LEGACY;
        };
    }

    /**
     * Whether a written answer is empty. Long answer: no typed text. CBE: nothing beyond
     * the template (CbeAnswers.isAnswered). Without the answer JSON it counts as answered,
     * so an unreadable row is never hidden as "Not answered".
     */
    public static boolean isBlank(Review.MarkRow row, Review.PaperKey key) {
        String json = row.responseJson();
        if (json == null || json.isBlank()) return true;
        try {
            if (key != null && QuestionKinds.isCbe(key.questionType())) {
                JsonNode answer = CbeAnswers.answerFromResponseJson(json);
                if (answer == null) return true;
                return !CbeAnswers.isAnswered(answer, CbeAnswers.configData(key.autoEvaluationJson()));
            }
            JsonNode answer = JSON.readTree(json).path("responseData").path("answer");
            return !(answer.isValueNode() && !answer.isNull() && !answer.asText().isBlank());
        } catch (Exception e) {
            return false;
        }
    }
}
