package vacademy.io.admin_core_service.features.learner_tracking.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Server-side correctness for content questions (QUIZ slides, QUESTION slides).
 *
 * <p>Scoring used to be entirely client-side: the answer key ships to the learner in
 * {@code auto_evaluation_json} so the viewer can grade instantly, and whatever
 * {@code response_status} the client sent was persisted verbatim. The main quiz
 * "Finish" path sent the literal string {@code "SUBMITTED"} for every question, so
 * {@code quiz_slide_question_tracked.response_status} was never CORRECT for anyone.
 * Everything reading that column downstream - the LLM analytics raw JSON
 * ({@code is_correct}), the student report's marks-by-subject, the pulse weak-area
 * queries - therefore saw a perfect scorer as a total failure.
 *
 * <p>This recomputes the verdict from the stored answer key so the DB never depends on
 * the client agreeing to tell the truth. It deliberately returns {@link Verdict#UNKNOWN}
 * rather than guessing whenever the question is not auto-gradable (free text, manual
 * evaluation, an answer key shape it does not recognise); callers leave the client's
 * value alone in that case.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AutoEvaluationScorer {

    public enum Verdict {
        CORRECT,
        /**
         * Answered, but not matching the key. Named WRONG rather than INCORRECT to match
         * what the learner app has always written and what the admin activity-log dialog
         * renders.
         */
        WRONG,
        SKIPPED,
        /** Not auto-gradable - the caller should keep whatever the client claimed. */
        UNKNOWN
    }

    private final ObjectMapper objectMapper;

    /**
     * @param autoEvaluationJson the question's stored answer key
     * @param responseJson       the learner's submitted response
     * @param optionIdsInOrder   supplier of the question's option ids, in the same order
     *                           the learner app received them. Only consulted when the
     *                           answer key stores positional indices instead of option
     *                           ids (the AI-copilot authoring path still does), so it is
     *                           lazy - most questions never pay for the lookup.
     */
    public Verdict evaluate(String autoEvaluationJson, String responseJson,
            Supplier<List<String>> optionIdsInOrder) {
        Set<String> key = extractCorrectAnswers(autoEvaluationJson, optionIdsInOrder);
        if (key == null || key.isEmpty()) {
            return Verdict.UNKNOWN;
        }
        Set<String> selected = extractSelectedAnswers(responseJson);
        if (selected == null) {
            return Verdict.UNKNOWN;
        }
        if (selected.isEmpty()) {
            return Verdict.SKIPPED;
        }
        return key.equals(selected) ? Verdict.CORRECT : Verdict.WRONG;
    }

    /** Convenience for questions with no options to index into. */
    public Verdict evaluate(String autoEvaluationJson, String responseJson) {
        return evaluate(autoEvaluationJson, responseJson, List::of);
    }

    /**
     * The option ids the answer key marks correct, resolved through positional indices
     * where the key stores those. Empty when the question is not auto-gradable.
     *
     * <p>Exposed so the LLM analytics payload can render the correct answer as readable
     * text instead of shipping the raw key and a pile of ids for the model to join.
     */
    public Set<String> correctAnswerIds(String autoEvaluationJson, Supplier<List<String>> optionIdsInOrder) {
        Set<String> key = extractCorrectAnswers(autoEvaluationJson, optionIdsInOrder);
        return key == null ? Set.of() : key;
    }

    /**
     * Share of a question's marks a partially-marked quiz awards: 1 for the exact key,
     * picked / key-size when the learner chose only correct options but not all of them
     * (a 1-mark question with two correct options gives 0.5 per option), and 0 as soon
     * as any wrong option is picked. Mirrors the learner app's scoring.
     */
    public static double partialCreditFraction(Set<String> correctIds, Set<String> selectedIds) {
        // Callers gate on isMultiSelect(questionType): a single-select question keyed with
        // two acceptable options is graded by the learner app as correct on either one.
        if (correctIds == null || correctIds.isEmpty() || selectedIds == null || selectedIds.isEmpty()
                || !correctIds.containsAll(selectedIds)) {
            return 0.0;
        }
        return (double) selectedIds.size() / correctIds.size();
    }

    /** Question types the learner app renders as tick-any-number checkboxes - the only ones partial marking applies to. */
    public static boolean isMultiSelect(String questionType) {
        return "MCQM".equals(questionType) || "CMCQM".equals(questionType);
    }

    /**
     * Whether the stored response was scored as partially correct ({@code "isPartial": true},
     * written by the learner app on partial-marking quizzes). Readers award partial marks
     * only to these, so switching partial marking on later never re-scores old attempts
     * behind the learner's back - their own review keeps showing what they were given.
     */
    public boolean isMarkedPartial(String responseJson) {
        if (responseJson == null || responseJson.isBlank() || !responseJson.contains("isPartial")) {
            return false;
        }
        try {
            JsonNode partial = objectMapper.readTree(responseJson).get("isPartial");
            return partial != null && partial.asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /** The option ids the learner selected; empty when unanswered or unrecognised. */
    public Set<String> selectedAnswerIds(String responseJson) {
        Set<String> selected = extractSelectedAnswers(responseJson);
        return selected == null ? Set.of() : selected;
    }

    /**
     * Parse the answer key.
     *
     * <p>Recognises the flat {@code {"correctAnswers":[...]}} shape written by the quiz and
     * question-slide authoring flows, and the same key nested under {@code data}. Entries
     * are normally option ids; the older authoring path stored positional indices, so a
     * numeric entry that matches no option id is resolved through the option list.
     *
     * <p>Returns null for the subjective {@code {"data":{"answer":...}}} shape - free text
     * is not something to grade on string equality.
     */
    private Set<String> extractCorrectAnswers(String autoEvaluationJson, Supplier<List<String>> optionIdsInOrder) {
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) {
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(autoEvaluationJson);
            JsonNode correctAnswers = root.get("correctAnswers");
            if (correctAnswers == null && root.has("data")) {
                correctAnswers = root.get("data").get("correctAnswers");
            }
            if (correctAnswers == null || !correctAnswers.isArray() || correctAnswers.isEmpty()) {
                return null;
            }

            Set<String> raw = new LinkedHashSet<>();
            boolean allNumeric = true;
            for (JsonNode node : correctAnswers) {
                if (!node.isTextual() && !node.isNumber()) {
                    return null;
                }
                String value = node.asText().trim();
                if (value.isEmpty()) {
                    continue;
                }
                allNumeric &= node.isNumber() || isNonNegativeInteger(value);
                raw.add(value);
            }
            if (raw.isEmpty()) {
                return null;
            }
            if (!allNumeric) {
                return raw;
            }

            // Numeric key: option ids only if they really are the option ids, otherwise
            // positional indices into the option list.
            List<String> optionIds = optionIdsInOrder.get();
            if (optionIds == null || optionIds.isEmpty() || optionIds.containsAll(raw)) {
                return raw;
            }
            Set<String> resolved = new LinkedHashSet<>();
            for (String value : raw) {
                int index = Integer.parseInt(value);
                if (index < 0 || index >= optionIds.size()) {
                    return null; // key we cannot trust - do not guess
                }
                resolved.add(optionIds.get(index));
            }
            return resolved;
        } catch (Exception e) {
            log.warn("[AutoEvaluationScorer] Unparseable auto_evaluation_json: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Parse what the learner selected.
     *
     * <p>Handles every response shape the learner app has written: the rich
     * {@code {"selectedOptions":[{"id":...}]}} the quiz viewer sends today, the
     * {@code selected_option_ids} / {@code optionIds} variants, and the legacy
     * {@code {"answer":<optionId>}} the quiz "Finish" button used to send.
     *
     * @return the selected ids; empty when the question was left unanswered; null when
     *         the shape is not recognised (caller must not treat that as wrong)
     */
    private Set<String> extractSelectedAnswers(String responseJson) {
        if (responseJson == null || responseJson.isBlank()) {
            return Set.of();
        }
        try {
            JsonNode root = objectMapper.readTree(responseJson);
            if (!root.isObject()) {
                return null;
            }

            JsonNode answers = firstPresent(root, "selectedOptions", "selected_option_ids", "optionIds", "answer");
            if (answers == null) {
                // `{}` is an unanswered question: the legacy quiz payload builder
                // serialised `{answer: undefined}` to exactly that. Any other shape is
                // one we do not understand, and guessing "wrong" would be worse.
                return root.isEmpty() ? Set.of() : null;
            }
            if (answers.isNull()) {
                return Set.of();
            }

            Set<String> selected = new LinkedHashSet<>();
            if (answers.isArray()) {
                for (JsonNode node : answers) {
                    String id = readAnswerId(node);
                    if (id == null) {
                        return null;
                    }
                    if (!id.isEmpty()) {
                        selected.add(id);
                    }
                }
                return selected;
            }

            String id = readAnswerId(answers);
            if (id == null) {
                return null;
            }
            if (!id.isEmpty()) {
                selected.add(id);
            }
            return selected;
        } catch (Exception e) {
            log.warn("[AutoEvaluationScorer] Unparseable response_json: {}", e.getMessage());
            return null;
        }
    }

    private JsonNode firstPresent(JsonNode root, String... fields) {
        for (String field : fields) {
            if (root.has(field)) {
                return root.get(field);
            }
        }
        return null;
    }

    /** @return the id, "" when the entry is an explicit blank, or null when unrecognised */
    private String readAnswerId(JsonNode node) {
        if (node == null || node.isNull()) {
            return "";
        }
        if (node.isTextual() || node.isNumber()) {
            return node.asText().trim();
        }
        if (node.isObject() && node.has("id")) {
            return node.get("id").asText().trim();
        }
        return null;
    }

    private boolean isNonNegativeInteger(String value) {
        if (value.isEmpty()) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            if (!Character.isDigit(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }
}
