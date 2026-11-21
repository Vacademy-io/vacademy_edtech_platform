package vacademy.io.admin_core_service.features.learner_tracking.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;
import vacademy.io.admin_core_service.features.slide.cbe.CbeConfigSecrets;
import vacademy.io.admin_core_service.features.slide.entity.Option;
import vacademy.io.admin_core_service.features.slide.entity.QuestionSlide;

import java.sql.Timestamp;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * Correctness and the answer key of a QUESTION slide, in the key shapes the slide editor
 * writes: {@code data.correctOptionIds} for choice questions, {@code data.validAnswers} for
 * numeric ones and {@code data.answer} for one-word and long answers.
 *
 * <p>Choice and numeric questions use {@link AutoEvaluationScorer#evaluateForQuestionType},
 * which reads those shapes. A one-word answer is compared with the model answer the way
 * assessments compare it (trimmed, whitespace collapsed, case ignored). A long answer is
 * never graded. Spreadsheet & Written Response slides are graded by AI elsewhere.
 */
@Component
@RequiredArgsConstructor
public class QuestionSlideGrader {

    private static final Set<String> CHOICE_TYPES = Set.of("MCQS", "MCQM", "CMCQS", "CMCQM", "TRUE_FALSE");

    private final AutoEvaluationScorer scorer;

    /** What a learner may be shown as the correct answer once they have submitted. */
    public record AnswerKey(List<String> correctOptionIds, List<String> correctAnswers) {
        public boolean isEmpty() {
            return correctOptionIds.isEmpty() && correctAnswers.isEmpty();
        }
    }

    public AutoEvaluationScorer.Verdict grade(QuestionSlide question, String responseJson) {
        if (question == null) {
            return AutoEvaluationScorer.Verdict.UNKNOWN;
        }
        String type = question.getQuestionType();
        String key = question.getAutoEvaluationJson();
        if (CbeConfigSecrets.isCbe(type, key)) {
            return AutoEvaluationScorer.Verdict.UNKNOWN;
        }
        if ("ONE_WORD".equals(type)) {
            String model = textOf(scorer.modelAnswerText(key));
            if (StringUtils.hasText(model)) {
                return gradeOneWord(model, responseJson);
            }
        }
        return scorer.evaluateForQuestionType(type, key, responseJson, () -> optionIdsInOrder(question));
    }

    public AnswerKey answerKey(QuestionSlide question) {
        if (question == null || CbeConfigSecrets.isCbe(question.getQuestionType(), question.getAutoEvaluationJson())) {
            return new AnswerKey(List.of(), List.of());
        }
        String type = question.getQuestionType();
        String key = question.getAutoEvaluationJson();
        if (type != null && CHOICE_TYPES.contains(type)) {
            List<String> optionIds = optionIdsInOrder(question);
            List<String> correct = scorer.correctAnswerIdsForQuestionType(type, key, () -> optionIds).stream()
                    .filter(optionIds::contains)
                    .toList();
            return new AnswerKey(correct, List.of());
        }
        if (AutoEvaluationScorer.isNumeric(type)) {
            return new AnswerKey(List.of(),
                    List.copyOf(scorer.correctAnswerIdsForQuestionType(type, key, List::of)));
        }
        String model = scorer.modelAnswerText(key);
        return StringUtils.hasText(textOf(model))
                ? new AnswerKey(List.of(), List.of(model))
                : new AnswerKey(List.of(), List.of());
    }

    private AutoEvaluationScorer.Verdict gradeOneWord(String model, String responseJson) {
        if (!scorer.recognisesResponse(responseJson)) {
            return AutoEvaluationScorer.Verdict.UNKNOWN;
        }
        Set<String> given = scorer.selectedAnswerIds(responseJson);
        if (given.isEmpty()) {
            return AutoEvaluationScorer.Verdict.SKIPPED;
        }
        String expected = normalise(model);
        return given.size() == 1 && normalise(given.iterator().next()).equals(expected)
                ? AutoEvaluationScorer.Verdict.CORRECT
                : AutoEvaluationScorer.Verdict.WRONG;
    }

    /** The option ids in the order the learner app lists them, for keys stored as positions. */
    static List<String> optionIdsInOrder(QuestionSlide question) {
        if (question.getOptions() == null) {
            return List.of();
        }
        return question.getOptions().stream()
                .sorted(Comparator.comparing(Option::getCreatedOn, Comparator.nullsLast(Comparator.<Timestamp>naturalOrder()))
                        .thenComparing(Option::getId, Comparator.nullsLast(Comparator.<String>naturalOrder())))
                .map(Option::getId)
                .toList();
    }

    /** Trim, collapse internal whitespace, lower-case, as assessments grade one-word answers. */
    static String normalise(String answer) {
        return answer == null ? "" : textOf(answer).trim().replaceAll("\\s+", " ").toLowerCase();
    }

    /** Plain text of an answer that may have been saved from a rich-text field. */
    private static String textOf(String value) {
        if (value == null) {
            return null;
        }
        return value.replaceAll("<[^>]*>", " ").replace("&nbsp;", " ").trim();
    }
}
