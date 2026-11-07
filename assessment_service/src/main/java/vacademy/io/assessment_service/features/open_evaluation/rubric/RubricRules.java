package vacademy.io.assessment_service.features.open_evaluation.rubric;

import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Rubric validation at the API (spec 7.4), instead of the engine's silent rescale
 * ({@code CC/rubric.py:83-97}):
 * <ul>
 *   <li>criterion marks add up to the question's max marks, else 422 {@code rubric_marks_mismatch};</li>
 *   <li>criterion names are unique within a question (the grader echoes exact names),
 *       else 422 {@code rubric_duplicate_criterion};</li>
 *   <li>guidance carries no mark figures ("2 marks", "award 1", "half marks"; section
 *       numbers and years are fine), else 422 {@code rubric_guidance_has_marks};</li>
 *   <li>a criterion worth a non-multiple of 0.5 is accepted with a warning (finals round to 0.5).</li>
 * </ul>
 * Shape problems (missing name, non-positive marks, oversize strings) are
 * {@code validation_failed} field errors, collected by the caller.
 */
public final class RubricRules {

    public static final int MAX_CRITERIA = 30;
    public static final int MAX_NAME = 200;
    public static final int MAX_GUIDANCE = 2_000;
    public static final int MAX_INSTRUCTIONS = 4_000;
    public static final int MAX_KEYWORDS = 30;
    public static final int MAX_KEYWORD = 100;

    private static final BigDecimal HALF = new BigDecimal("0.5");

    /**
     * Mark figures in guidance: a number or number word followed by "mark(s)"/"point(s)",
     * an awarding verb followed by an amount, or the ½ sign. Bare numbers (article and
     * section numbers, years) do not match.
     */
    static final Pattern GUIDANCE_MARKS = Pattern.compile(
            "(?i)(\\b\\d+(?:\\.\\d+)?\\s*(?:marks?|mks?|points?|pts?)\\b"
                    + "|\\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|full|quarter)\\s+marks?\\b"
                    + "|\\b(?:award|awarding|give|giving|deduct|deducting|allot|allocate|assign|grant|cut)\\s+"
                    + "(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|half|a\\s+half|full|quarter)\\b"
                    + "|½|¼|¾)");

    private RubricRules() {
    }

    /** Shape checks; appends field errors (prefix like {@code questions[3].rubric}). */
    public static void checkShape(ExamInputs.RubricInput rubric, String field, List<OpenApiException.FieldError> errors) {
        if (rubric == null) {
            return;
        }
        List<ExamInputs.CriterionInput> criteria = rubric.getCriteria();
        if (criteria == null || criteria.isEmpty()) {
            errors.add(new OpenApiException.FieldError(field + ".criteria", "required",
                    "A rubric needs at least one criterion."));
            return;
        }
        if (criteria.size() > MAX_CRITERIA) {
            errors.add(new OpenApiException.FieldError(field + ".criteria", "too_many",
                    "A rubric has at most " + MAX_CRITERIA + " criteria."));
        }
        if (rubric.getInstructions() != null && rubric.getInstructions().length() > MAX_INSTRUCTIONS) {
            errors.add(new OpenApiException.FieldError(field + ".instructions", "too_long",
                    "Rubric instructions are at most " + MAX_INSTRUCTIONS + " characters."));
        }
        for (int i = 0; i < criteria.size(); i++) {
            ExamInputs.CriterionInput c = criteria.get(i);
            String cf = field + ".criteria[" + i + "]";
            if (c == null) {
                errors.add(new OpenApiException.FieldError(cf, "required", "Criterion is empty."));
                continue;
            }
            if (c.getName() == null || c.getName().isBlank()) {
                errors.add(new OpenApiException.FieldError(cf + ".name", "required", "Criterion name is required."));
            } else if (c.getName().length() > MAX_NAME) {
                errors.add(new OpenApiException.FieldError(cf + ".name", "too_long",
                        "Criterion name is at most " + MAX_NAME + " characters."));
            } else if (c.getName().indexOf('<') >= 0 || c.getName().indexOf('>') >= 0) {
                // The grader echoes criterion names back verbatim into marks the dashboard
                // shows; angle brackets are refused rather than escaped so names stay exact.
                errors.add(new OpenApiException.FieldError(cf + ".name", "invalid_characters",
                        "Criterion names cannot contain < or >."));
            }
            if (c.getMarks() == null) {
                errors.add(new OpenApiException.FieldError(cf + ".marks", "required", "Criterion marks are required."));
            } else if (c.getMarks().signum() <= 0) {
                errors.add(new OpenApiException.FieldError(cf + ".marks", "out_of_range",
                        "Criterion marks must be greater than 0."));
            }
            if (c.getGuidance() != null && c.getGuidance().length() > MAX_GUIDANCE) {
                errors.add(new OpenApiException.FieldError(cf + ".guidance", "too_long",
                        "Guidance is at most " + MAX_GUIDANCE + " characters."));
            }
            if (c.getKeywords() != null) {
                if (c.getKeywords().size() > MAX_KEYWORDS) {
                    errors.add(new OpenApiException.FieldError(cf + ".keywords", "too_many",
                            "At most " + MAX_KEYWORDS + " keywords per criterion."));
                }
                for (String k : c.getKeywords()) {
                    if (k == null || k.isBlank() || k.length() > MAX_KEYWORD) {
                        errors.add(new OpenApiException.FieldError(cf + ".keywords", "invalid",
                                "Keywords are non-empty strings of at most " + MAX_KEYWORD + " characters."));
                        break;
                    }
                }
            }
        }
    }

    /**
     * Semantic checks against the question's max marks; call after {@link #checkShape}
     * found nothing. Throws the first rule broken; appends warnings.
     */
    public static void checkAgainstQuestion(ExamInputs.RubricInput rubric, BigDecimal maxMarks, String questionLabel,
            String field, List<ExamViews.Warning> warnings) {
        if (rubric == null) {
            return;
        }
        BigDecimal total = BigDecimal.ZERO;
        Set<String> names = new HashSet<>();
        for (ExamInputs.CriterionInput c : rubric.getCriteria()) {
            total = total.add(c.getMarks());
            String key = c.getName().trim().toLowerCase(Locale.ROOT);
            if (!names.add(key)) {
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("question_label", questionLabel);
                details.put("criterion", c.getName().trim());
                throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.RUBRIC_DUPLICATE_CRITERION,
                        "Question " + questionLabel + " has two criteria named \"" + c.getName().trim() + "\".", details);
            }
            if (c.getGuidance() != null && GUIDANCE_MARKS.matcher(c.getGuidance()).find()) {
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("question_label", questionLabel);
                details.put("criterion", c.getName().trim());
                throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.RUBRIC_GUIDANCE_HAS_MARKS,
                        "Guidance for \"" + c.getName().trim() + "\" in question " + questionLabel
                                + " mentions marks. Put marks in criteria[].marks only.", details);
            }
            if (c.getMarks().remainder(HALF).signum() != 0) {
                warnings.add(new ExamViews.Warning("rubric_marks_not_half_step",
                        "Criterion \"" + c.getName().trim() + "\" in question " + questionLabel
                                + " is worth " + c.getMarks().stripTrailingZeros().toPlainString()
                                + "; final marks are rounded to 0.5.", field));
            }
        }
        if (maxMarks != null && total.compareTo(maxMarks) != 0) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("question_label", questionLabel);
            details.put("criteria_total", total.stripTrailingZeros());
            details.put("max_marks", maxMarks.stripTrailingZeros());
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.RUBRIC_MARKS_MISMATCH,
                    "Criteria for question " + questionLabel + " add up to " + total.stripTrailingZeros().toPlainString()
                            + ", question max is " + maxMarks.stripTrailingZeros().toPlainString() + ".", details);
        }
    }

    /** Total of an engine rubric's criteria ({@code rubric[].max_marks}); null when unreadable. */
    public static BigDecimal engineCriteriaTotal(Map<String, Object> engineRubric) {
        if (engineRubric == null) {
            return null;
        }
        Object items = engineRubric.get("rubric");
        if (!(items instanceof List<?> list) || list.isEmpty()) {
            return null;
        }
        BigDecimal total = BigDecimal.ZERO;
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> m) || !(m.get("max_marks") instanceof Number n)) {
                return null;
            }
            total = total.add(new BigDecimal(n.toString()));
        }
        return total;
    }
}
