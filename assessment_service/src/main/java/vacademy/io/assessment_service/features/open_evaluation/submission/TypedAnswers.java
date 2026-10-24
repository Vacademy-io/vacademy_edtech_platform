package vacademy.io.assessment_service.features.open_evaluation.submission;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.QuestionMapper;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.support.Devanagari;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Typed answers of a submission (spec 7.6, typed): each answer is keyed by
 * {@code question_id} or {@code question_label}; {@code text} for long_answer,
 * {@code option_labels} for MCQ / true-false (translated through
 * {@code source_meta.option_labels}), {@code value} for numeric / one_word.
 *
 * <p>Refusals: unknown option label → 422 {@code unknown_option_label}; any text more than 20%
 * Devanagari → 422 {@code language_not_supported}; everything else → 422
 * {@code validation_failed} with the failing field.
 *
 * <p>Blank answers (empty text, no labels) are "not answered": they are not written to the
 * attempt and never reach the AI or the bill.
 */
public final class TypedAnswers {

    public static final int MAX_TEXT = 20_000;
    public static final int MAX_ONE_WORD = 1_000;

    private TypedAnswers() {
    }

    /** One answer resolved against the paper. Exactly one of the answer fields is set. */
    public record Resolved(OpenQuestionService.ExamQuestion question, String internalType, String text,
            List<String> optionIds, Double numeric) {

        public boolean isLongAnswer() {
            return "LONG_ANSWER".equals(internalType);
        }
    }

    /**
     * Validates and resolves, in paper order; blank answers are dropped.
     *
     * @param paper the exam's live questions in paper order
     */
    public static List<Resolved> resolve(List<OpenQuestionService.ExamQuestion> paper,
            List<SubmissionInputs.AnswerInput> answers) {
        if (answers == null) {
            throw OpenApiException.validation("answers", "required", "answers is required for a typed exam.");
        }
        if (answers.size() > paper.size()) {
            throw OpenApiException.validation("answers", "too_many",
                    "The exam has " + paper.size() + " questions; " + answers.size() + " answers were sent.");
        }
        Map<String, OpenQuestionService.ExamQuestion> byId = new LinkedHashMap<>();
        Map<String, OpenQuestionService.ExamQuestion> byLabel = new LinkedHashMap<>();
        Map<String, OpenQuestionService.ExamQuestion> byLabelLower = new LinkedHashMap<>();
        for (OpenQuestionService.ExamQuestion q : paper) {
            byId.put(q.id(), q);
            byLabel.put(q.label(), q);
            byLabelLower.putIfAbsent(q.label().toLowerCase(Locale.ROOT), q);
        }
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        List<Resolved> out = new ArrayList<>();
        for (int i = 0; i < answers.size(); i++) {
            String p = "answers[" + i + "]";
            SubmissionInputs.AnswerInput a = answers.get(i);
            if (a == null) {
                errors.add(new OpenApiException.FieldError(p, "required", "Answer is empty."));
                continue;
            }
            OpenQuestionService.ExamQuestion q = null;
            if (a.getQuestionId() != null && !a.getQuestionId().isBlank()) {
                q = byId.get(a.getQuestionId().trim());
                if (q == null) {
                    errors.add(new OpenApiException.FieldError(p + ".question_id", "unknown",
                            "No question with this id in the exam."));
                    continue;
                }
                if (a.getQuestionLabel() != null && !a.getQuestionLabel().isBlank()
                        && !a.getQuestionLabel().trim().equalsIgnoreCase(q.label())) {
                    errors.add(new OpenApiException.FieldError(p + ".question_label", "mismatch",
                            "question_label does not match question_id."));
                    continue;
                }
            } else if (a.getQuestionLabel() != null && !a.getQuestionLabel().isBlank()) {
                String label = a.getQuestionLabel().trim();
                q = byLabel.containsKey(label) ? byLabel.get(label) : byLabelLower.get(label.toLowerCase(Locale.ROOT));
                if (q == null) {
                    errors.add(new OpenApiException.FieldError(p + ".question_label", "unknown",
                            "No question with this label in the exam."));
                    continue;
                }
            } else {
                errors.add(new OpenApiException.FieldError(p, "required", "Send question_id or question_label."));
                continue;
            }
            if (!seen.add(q.id())) {
                errors.add(new OpenApiException.FieldError(p, "duplicate", "Question " + q.label() + " is answered twice."));
                continue;
            }
            Resolved r = resolveOne(q, a, p, errors);
            if (r != null) {
                out.add(r);
            }
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        // Paper order (the order the paper lists them), whatever order the partner sent.
        Map<String, Integer> position = new LinkedHashMap<>();
        for (int i = 0; i < paper.size(); i++) {
            position.put(paper.get(i).id(), i);
        }
        out.sort(java.util.Comparator.comparingInt(r -> position.getOrDefault(r.question().id(), Integer.MAX_VALUE)));
        return out;
    }

    private static Resolved resolveOne(OpenQuestionService.ExamQuestion q, SubmissionInputs.AnswerInput a, String p,
            List<OpenApiException.FieldError> errors) {
        String type = q.question().getQuestionType() == null ? "" : q.question().getQuestionType().toUpperCase(Locale.ROOT);
        boolean hasText = a.getText() != null;
        boolean hasLabels = a.getOptionLabels() != null;
        boolean hasValue = a.getValue() != null && !a.getValue().isNull();
        switch (type) {
            case "LONG_ANSWER" -> {
                if (hasLabels || hasValue) {
                    errors.add(new OpenApiException.FieldError(p, "wrong_field",
                            "Question " + q.label() + " is a long answer: send text."));
                    return null;
                }
                String text = a.getText();
                if (text == null || text.isBlank()) {
                    return null; // not answered
                }
                if (text.length() > MAX_TEXT) {
                    errors.add(new OpenApiException.FieldError(p + ".text", "too_long",
                            "text may be at most " + MAX_TEXT + " characters."));
                    return null;
                }
                requireLanguage(q, text);
                return new Resolved(q, type, text, null, null);
            }
            case "MCQS", "MCQM", "TRUE_FALSE" -> {
                if (hasText || hasValue) {
                    errors.add(new OpenApiException.FieldError(p, "wrong_field",
                            "Question " + q.label() + " has options: send option_labels."));
                    return null;
                }
                List<String> labels = a.getOptionLabels();
                if (labels == null || labels.isEmpty()) {
                    return null; // not answered
                }
                if (!"MCQM".equals(type) && labels.size() > 1) {
                    errors.add(new OpenApiException.FieldError(p + ".option_labels", "too_many",
                            "Question " + q.label() + " takes one option."));
                    return null;
                }
                Map<String, String> idsByLabel = QuestionMapper.optionIdsByLabel(q.question());
                List<String> ids = new ArrayList<>();
                for (String label : labels) {
                    String id = optionId(idsByLabel, label);
                    if (id == null) {
                        Map<String, Object> details = new LinkedHashMap<>();
                        details.put("question_label", q.label());
                        details.put("option_label", label);
                        throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UNKNOWN_OPTION_LABEL,
                                "Question " + q.label() + " has no option " + label + ".", details);
                    }
                    if (!ids.contains(id)) {
                        ids.add(id);
                    }
                }
                return new Resolved(q, type, null, ids, null);
            }
            case "NUMERIC" -> {
                if (hasText || hasLabels) {
                    errors.add(new OpenApiException.FieldError(p, "wrong_field",
                            "Question " + q.label() + " is numeric: send value."));
                    return null;
                }
                if (!hasValue) {
                    return null;
                }
                JsonNode v = a.getValue();
                if (!v.isNumber() || !Double.isFinite(v.asDouble())) {
                    errors.add(new OpenApiException.FieldError(p + ".value", "invalid", "value must be a number."));
                    return null;
                }
                return new Resolved(q, type, null, null, v.asDouble());
            }
            case "ONE_WORD" -> {
                if (hasText || hasLabels) {
                    errors.add(new OpenApiException.FieldError(p, "wrong_field",
                            "Question " + q.label() + " is a one-word answer: send value."));
                    return null;
                }
                if (!hasValue) {
                    return null;
                }
                JsonNode v = a.getValue();
                if (!v.isTextual() && !v.isNumber()) {
                    errors.add(new OpenApiException.FieldError(p + ".value", "invalid", "value must be a string."));
                    return null;
                }
                String text = v.asText();
                if (text.isBlank()) {
                    return null;
                }
                if (text.length() > MAX_ONE_WORD) {
                    errors.add(new OpenApiException.FieldError(p + ".value", "too_long",
                            "value may be at most " + MAX_ONE_WORD + " characters."));
                    return null;
                }
                requireLanguage(q, text);
                return new Resolved(q, type, text, null, null);
            }
            default -> {
                errors.add(new OpenApiException.FieldError(p, "unsupported",
                        "Question " + q.label() + " cannot be answered through the API."));
                return null;
            }
        }
    }

    private static String optionId(Map<String, String> idsByLabel, String label) {
        if (label == null) {
            return null;
        }
        String trimmed = label.trim();
        if (idsByLabel.containsKey(trimmed)) {
            return idsByLabel.get(trimmed);
        }
        for (Map.Entry<String, String> e : idsByLabel.entrySet()) {
            if (e.getKey().equalsIgnoreCase(trimmed)) {
                return e.getValue();
            }
        }
        return null;
    }

    private static void requireLanguage(OpenQuestionService.ExamQuestion q, String text) {
        if (Devanagari.exceedsLimit(text)) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.LANGUAGE_NOT_SUPPORTED,
                    "The answer to question " + q.label() + " is in Hindi (Devanagari). Only English answers are "
                            + "supported in v1.",
                    Map.of("question_label", q.label()));
        }
    }

    /** Non-blank long answers: the typed quote (1 credit each at the default price). */
    public static int nonBlankLongAnswers(List<Resolved> resolved) {
        return (int) resolved.stream().filter(Resolved::isLongAnswer).count();
    }
}
