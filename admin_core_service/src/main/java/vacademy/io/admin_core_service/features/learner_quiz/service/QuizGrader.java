package vacademy.io.admin_core_service.features.learner_quiz.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.learner_tracking.util.AutoEvaluationScorer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns one learner answer into marks, by the rules the learner app has always shown: a
 * question's own marks or else the quiz default, negative marks on a wrong answer, a share
 * of the marks for a correct subset on partial-marking quizzes, and a total floored at 0.
 * Correctness itself comes from {@link AutoEvaluationScorer}.
 */
@Component
@RequiredArgsConstructor
public class QuizGrader {

    /** response_json marker: graded by the submit endpoint. */
    public static final String GRADED_BY_SERVER = "server";
    /** response_json marker: posted to the older activity-log endpoint with client marks. */
    public static final String GRADED_BY_LEGACY = "server-legacy";

    public enum Outcome { CORRECT, PARTIAL, WRONG, SKIPPED, PENDING }

    public record Rules(double marksPerQuestion, double negativeMarking, boolean partialMarking) {
    }

    public record Option(String id, String text) {
    }

    public record Question(String id, String questionType, Double marks, Double negativeMarking,
            String autoEvaluationJson, String text, String explanation, List<Option> options) {

        List<String> optionIds() {
            return options == null ? List.of() : options.stream().map(Option::id).toList();
        }
    }

    public record Graded(String questionId, Outcome outcome, double marks, double maxMarks,
            String responseStatus, String responseJson) {
    }

    private final AutoEvaluationScorer scorer;
    private final ObjectMapper objectMapper;

    /**
     * @param selected what the learner chose: option ids, or the typed answer as its single
     *                 entry. Option ids the question does not have are dropped.
     */
    public Graded grade(Question question, Rules rules, List<String> selected, String gradedBy) {
        boolean optionQuestion = hasRealOptions(question);
        List<String> known = new ArrayList<>();
        if (selected != null) {
            Set<String> optionIds = new LinkedHashSet<>(question.optionIds());
            for (String id : new LinkedHashSet<>(selected)) {
                if (id == null || id.isBlank()) {
                    continue;
                }
                if (!optionQuestion || optionIds.contains(id)) {
                    known.add(id.trim());
                }
            }
        }

        double maxMarks = question.marks() != null ? question.marks() : rules.marksPerQuestion();
        double negative = question.negativeMarking() != null ? question.negativeMarking() : rules.negativeMarking();

        AutoEvaluationScorer.Verdict verdict = scorer.evaluateForQuestionType(question.questionType(),
                question.autoEvaluationJson(), selectionJson(known), question::optionIds);
        Set<String> correctIds = scorer.correctAnswerIdsForQuestionType(question.questionType(),
                question.autoEvaluationJson(), question::optionIds);

        Outcome outcome;
        double marks;
        switch (verdict) {
            case CORRECT -> {
                outcome = Outcome.CORRECT;
                marks = maxMarks;
            }
            case SKIPPED -> {
                outcome = Outcome.SKIPPED;
                marks = 0;
            }
            case WRONG -> {
                double share = rules.partialMarking() && AutoEvaluationScorer.isMultiSelect(question.questionType())
                        ? AutoEvaluationScorer.partialCreditFraction(correctIds, new LinkedHashSet<>(known))
                        : 0;
                if (share > 0) {
                    outcome = Outcome.PARTIAL;
                    marks = maxMarks * share;
                } else {
                    outcome = Outcome.WRONG;
                    marks = -negative;
                }
            }
            default -> {
                outcome = Outcome.PENDING;
                marks = 0;
            }
        }

        ObjectNode json = objectMapper.createObjectNode();
        json.put("questionName", question.text() == null ? "" : question.text());
        json.set("selectedOptions", namedOptions(known, question));
        json.set("correctOptions", namedOptions(correctIds, question));
        json.put("marks", marks);
        json.put("maxMarks", maxMarks);
        json.put("isCorrect", outcome == Outcome.CORRECT);
        json.put("isPartial", outcome == Outcome.PARTIAL);
        json.put("questionType", question.questionType() == null ? "" : question.questionType());
        json.put("gradedBy", gradedBy);
        return new Graded(question.id(), outcome, marks, maxMarks, statusOf(outcome), json.toString());
    }

    /**
     * Regrades what an older client recorded. Its stored answer stays as it sent it, so
     * nothing it wrote is lost; the marks and verdict become the server's.
     *
     * @return null when the stored answer has a shape this cannot read: leave it alone
     */
    public Graded regrade(Question question, Rules rules, String clientResponseJson, String gradedBy) {
        if (!scorer.recognisesResponse(clientResponseJson)) {
            return null;
        }
        Set<String> selected = scorer.selectedAnswerIds(clientResponseJson);
        return grade(question, rules, new ArrayList<>(selected), gradedBy);
    }

    /** Written by the learner app's AI tutor flow, which posts to the older endpoint. */
    public boolean isTutorRecord(String responseJson) {
        if (responseJson == null || !responseJson.contains("\"source\"")) {
            return false;
        }
        try {
            return "tutor".equals(objectMapper.readTree(responseJson).path("source").asText(null));
        } catch (Exception e) {
            return false;
        }
    }

    /** Marks across a whole attempt. The learner never goes below zero overall. */
    public static double totalEarned(List<Graded> graded) {
        return Math.max(0, graded.stream().mapToDouble(Graded::marks).sum());
    }

    public static double totalMarks(List<Graded> graded) {
        return graded.stream().mapToDouble(Graded::maxMarks).sum();
    }

    /**
     * Pass or fail against the pass mark. A fail is not reported while answers wait for a
     * person to mark them: those marks could still change it.
     */
    public static Boolean passed(double earned, double total, int pending, Double passPercentage) {
        if (passPercentage == null || total <= 0) {
            return null;
        }
        boolean reached = earned * 100.0 / total >= passPercentage;
        return !reached && pending > 0 ? null : Boolean.valueOf(reached);
    }

    public static String statusOf(Outcome outcome) {
        return switch (outcome) {
            case CORRECT -> "CORRECT";
            case SKIPPED -> "SKIPPED";
            case PENDING -> "SUBMITTED";
            // A partly-right answer is stored WRONG plus isPartial, which is what the
            // Quiz Results tab and the activity dialog already read.
            case PARTIAL, WRONG -> "WRONG";
        };
    }

    private boolean hasRealOptions(Question question) {
        return !AutoEvaluationScorer.isNumeric(question.questionType())
                && !AutoEvaluationScorer.isFreeText(question.questionType())
                && question.options() != null && !question.options().isEmpty();
    }

    private String selectionJson(List<String> selected) {
        ObjectNode root = objectMapper.createObjectNode();
        ArrayNode ids = root.putArray("selected_option_ids");
        selected.forEach(ids::add);
        return root.toString();
    }

    private JsonNode namedOptions(Iterable<String> ids, Question question) {
        Map<String, String> names = new LinkedHashMap<>();
        if (question.options() != null) {
            question.options().forEach(o -> names.put(o.id(), o.text()));
        }
        ArrayNode out = objectMapper.createArrayNode();
        for (String id : ids) {
            ObjectNode entry = out.addObject();
            entry.put("id", id);
            String name = names.get(id);
            entry.put("name", name == null ? id : name);
        }
        return out;
    }
}
