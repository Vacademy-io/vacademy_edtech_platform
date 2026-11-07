package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.assessment_service.core.exception.VacademyException;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Internal choice on a dashboard assessment ("Answer any FOUR of these five"), kept in
 * {@code assessment_choice_group} - the table the partner API already uses.
 *
 * <p>An assessment with no group is untouched by everything here: no choice is sent to
 * ai_service, no question is left out of a total, and the paper's maximum stays the sum
 * of its questions.
 */
@Slf4j
@Component
public class DashboardChoiceGroups {

    public static final String BEST = "best";
    public static final String FIRST = "first";

    private final ChoiceGroupStore store;
    private final QuestionAssessmentSectionMappingRepository mappings;
    private final ObjectMapper objectMapper;

    public DashboardChoiceGroups(ChoiceGroupStore store, QuestionAssessmentSectionMappingRepository mappings,
            ObjectMapper objectMapper) {
        this.store = store;
        this.mappings = mappings;
        this.objectMapper = objectMapper;
    }

    /** Each live question's maximum marks (marking_json data.totalMark; missing = 0). */
    public Map<String, Double> maxMarksByQuestion(String assessmentId) {
        Map<String, Double> out = new LinkedHashMap<>();
        for (QuestionAssessmentSectionMapping m : mappings.getQuestionAssessmentSectionMappingByAssessmentId(assessmentId)) {
            if (m.getQuestion() == null || (m.getStatus() != null && "DELETED".equalsIgnoreCase(m.getStatus()))) continue;
            double max = 0;
            try {
                JsonNode mark = objectMapper.readTree(m.getMarkingJson() == null ? "{}" : m.getMarkingJson())
                        .path("data").path("totalMark");
                max = mark.isNumber() ? mark.asDouble() : Double.parseDouble(mark.asText("0").trim());
            } catch (Exception ignored) {
                max = 0;
            }
            out.put(m.getQuestion().getId(), max);
        }
        return out;
    }

    /** The assessment's groups; empty when it has none or they cannot be read. */
    public List<ChoiceGroupStore.ChoiceGroupRow> groups(String assessmentId) {
        if (assessmentId == null) return List.of();
        try {
            return store.list(assessmentId);
        } catch (Exception e) {
            log.warn("[choice] could not read choice groups of assessment {}: {}", assessmentId, e.getMessage());
            return List.of();
        }
    }

    /** What the paper is out of under its groups; null when it has none. */
    public Double paperMax(String assessmentId) {
        List<ChoiceGroupStore.ChoiceGroupRow> rows = groups(assessmentId);
        if (rows.isEmpty()) return null;
        return paperMax(rows, maxMarksByQuestion(assessmentId));
    }

    /**
     * Adds the groups and the paper maximum to an uploaded copy's grade request, unless
     * a provider already did (a partner API exam). ai_service then grades every answer
     * and marks the extra ones as not counted.
     */
    public void contribute(String assessmentId, CopyCheckGradeRequestDto request) {
        if (request == null || request.getChoiceGroups() != null || !"COPY".equals(request.getAnswerMode())) {
            return;
        }
        List<ChoiceGroupStore.ChoiceGroupRow> rows = groups(assessmentId);
        if (rows.isEmpty()) return;
        List<Map<String, Object>> out = new ArrayList<>();
        for (ChoiceGroupStore.ChoiceGroupRow g : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("question_ids", g.questionIds());
            m.put("attempt", g.attempt());
            m.put("policy", g.policy());
            out.add(m);
        }
        request.setChoiceGroups(out);
        request.setPaperMax(paperMax(rows, maxMarksByQuestion(assessmentId)));
    }

    /**
     * The questions of a graded copy that do not count toward its total: in each group,
     * all but {@code attempt} of them.
     * <ul>
     *   <li>{@code best} - the highest-marked count, recomputed from the current marks,
     *       so a teacher's edit moves the choice with it;</li>
     *   <li>{@code first} - the AI's own decision ({@code counted} in the verdict), as only
     *       it saw the order the answers were written in; without one, paper order of the
     *       attempted questions.</li>
     * </ul>
     * A question in two groups counts only when both count it. Empty without groups.
     */
    public Set<String> notCounted(String assessmentId, List<AiQuestionEvaluation> rows) {
        List<ChoiceGroupStore.ChoiceGroupRow> groups = groups(assessmentId);
        if (groups.isEmpty() || rows == null || rows.isEmpty()) return Set.of();
        Map<String, AiQuestionEvaluation> byQuestion = new HashMap<>();
        for (AiQuestionEvaluation row : rows) {
            if (row.getQuestion() != null) byQuestion.put(row.getQuestion().getId(), row);
        }
        Set<String> out = new HashSet<>();
        for (ChoiceGroupStore.ChoiceGroupRow g : groups) {
            List<AiQuestionEvaluation> members = new ArrayList<>();
            for (String id : g.questionIds()) {
                AiQuestionEvaluation row = byQuestion.get(id);
                if (row != null) members.add(row);
            }
            if (g.attempt() <= 0 || members.size() <= g.attempt()) continue;
            List<AiQuestionEvaluation> counted = FIRST.equals(g.policy()) ? firstN(members, g.attempt())
                    : bestN(members, g.attempt());
            for (AiQuestionEvaluation m : members) {
                if (!counted.contains(m)) out.add(m.getQuestion().getId());
            }
        }
        return out;
    }

    /** A group as the teacher (or the paper reader) set it: question ids in paper order. */
    public record GroupInput(String label, List<String> questionIds, Integer attempt, String policy) {
    }

    /**
     * Validates and stores an assessment's groups (replacing any it had) and returns the
     * paper's maximum under them, from each question's marks. An empty list clears them.
     *
     * @throws VacademyException when a group does not describe a real choice: fewer than
     *         two questions, a question outside the paper or in two groups, or an attempt
     *         that is not below the group's size.
     */
    public double replace(String assessmentId, List<GroupInput> groups, Map<String, Double> marksByQuestion) {
        List<ChoiceGroupStore.ChoiceGroupRow> rows = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        int order = 0;
        for (GroupInput g : groups == null ? List.<GroupInput>of() : groups) {
            List<String> ids = g.questionIds() == null ? List.of()
                    : g.questionIds().stream().filter(id -> id != null && !id.isBlank()).distinct().toList();
            String label = g.label() == null || g.label().isBlank() ? "Choice " + (order + 1) : g.label().trim();
            if (ids.size() < 2) {
                throw new VacademyException(label + ": a choice needs at least two questions");
            }
            for (String id : ids) {
                if (!marksByQuestion.containsKey(id)) {
                    throw new VacademyException(label + ": a question is not part of this paper");
                }
                if (!seen.add(id)) {
                    throw new VacademyException(label + ": a question can be in only one choice");
                }
            }
            int attempt = g.attempt() == null ? 0 : g.attempt();
            if (attempt < 1 || attempt >= ids.size()) {
                throw new VacademyException(label + ": answer any " + attempt + " of " + ids.size()
                        + " is not a choice - it must be between 1 and " + (ids.size() - 1));
            }
            String policy = g.policy() == null ? BEST : g.policy().trim().toLowerCase(java.util.Locale.ROOT);
            if (!BEST.equals(policy) && !FIRST.equals(policy)) {
                throw new VacademyException(label + ": counting must be 'best' or 'first'");
            }
            rows.add(new ChoiceGroupStore.ChoiceGroupRow(null, label, ids, attempt, policy, order++));
        }
        store.replace(assessmentId, rows);
        return paperMax(rows, marksByQuestion);
    }

    /** Ungrouped marks plus, per group, its {@code attempt} highest-marked questions. */
    static double paperMax(List<ChoiceGroupStore.ChoiceGroupRow> rows, Map<String, Double> marksByQuestion) {
        Set<String> grouped = new HashSet<>();
        double total = 0;
        for (ChoiceGroupStore.ChoiceGroupRow g : rows) {
            grouped.addAll(g.questionIds());
            total += g.questionIds().stream().map(id -> marksByQuestion.getOrDefault(id, 0.0))
                    .sorted(Comparator.reverseOrder()).limit(g.attempt()).mapToDouble(Double::doubleValue).sum();
        }
        for (Map.Entry<String, Double> e : marksByQuestion.entrySet()) {
            if (!grouped.contains(e.getKey()) && e.getValue() != null) total += e.getValue();
        }
        return total;
    }

    /**
     * For totals summed from per-question marks (a teacher's manual marks, a
     * revaluation): the questions to leave out. {@code best} keeps the highest marks;
     * {@code first} keeps the first answered ones in paper order. Empty without groups.
     */
    public Set<String> notCountedByMarks(String assessmentId, Map<String, Double> marksByQuestion) {
        List<ChoiceGroupStore.ChoiceGroupRow> groups = groups(assessmentId);
        if (groups.isEmpty() || marksByQuestion == null || marksByQuestion.isEmpty()) return Set.of();
        Set<String> out = new HashSet<>();
        for (ChoiceGroupStore.ChoiceGroupRow g : groups) {
            List<String> members = g.questionIds().stream().filter(marksByQuestion::containsKey).toList();
            if (g.attempt() <= 0 || members.size() <= g.attempt()) continue;
            List<String> keep;
            if (FIRST.equals(g.policy())) {
                List<String> answered = new ArrayList<>(members.stream()
                        .filter(id -> marksByQuestion.get(id) != null && marksByQuestion.get(id) > 0).toList());
                for (String id : members) if (!answered.contains(id)) answered.add(id);
                keep = answered.subList(0, g.attempt());
            } else {
                List<String> sorted = new ArrayList<>(members);
                sorted.sort(Comparator.comparing((String id) -> marksByQuestion.get(id) == null ? 0.0
                        : marksByQuestion.get(id)).reversed());
                keep = sorted.subList(0, g.attempt());
            }
            for (String id : members) if (!keep.contains(id)) out.add(id);
        }
        return out;
    }

    private static List<AiQuestionEvaluation> bestN(List<AiQuestionEvaluation> members, int n) {
        List<AiQuestionEvaluation> sorted = new ArrayList<>(members);
        // Highest marks first; ties keep paper order. A question still awaiting a grade
        // ranks as its maximum, so it is never silently left out before it is marked.
        sorted.sort(Comparator.comparing(DashboardChoiceGroups::rankMarks).reversed()
                .thenComparing(DashboardChoiceGroups::paperOrder));
        return sorted.subList(0, n);
    }

    private List<AiQuestionEvaluation> firstN(List<AiQuestionEvaluation> members, int n) {
        List<AiQuestionEvaluation> byAi = new ArrayList<>();
        boolean aiDecided = false;
        for (AiQuestionEvaluation m : members) {
            Boolean c = aiCounted(m);
            if (c != null) aiDecided = true;
            if (!Boolean.FALSE.equals(c)) byAi.add(m);
        }
        if (aiDecided && byAi.size() == n) return byAi;
        List<AiQuestionEvaluation> ordered = new ArrayList<>(members);
        ordered.sort(Comparator.comparing(DashboardChoiceGroups::paperOrder));
        List<AiQuestionEvaluation> out = new ArrayList<>();
        for (AiQuestionEvaluation m : ordered) {
            if (out.size() < n && attempted(m)) out.add(m);
        }
        for (AiQuestionEvaluation m : ordered) {
            if (out.size() < n && !out.contains(m)) out.add(m);
        }
        return out;
    }

    private Boolean aiCounted(AiQuestionEvaluation row) {
        String json = row.getEvaluationResultJson();
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(json).path("counted");
            return node.isBoolean() ? node.asBoolean() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static double rankMarks(AiQuestionEvaluation row) {
        if (!"COMPLETED".equals(row.getStatus())) {
            return row.getMaxMarks() == null ? Double.MAX_VALUE : row.getMaxMarks().doubleValue();
        }
        return row.getMarksAwarded() == null ? 0.0 : row.getMarksAwarded().doubleValue();
    }

    private static int paperOrder(AiQuestionEvaluation row) {
        return row.getQuestionNumber() == null ? Integer.MAX_VALUE : row.getQuestionNumber();
    }

    private static boolean attempted(AiQuestionEvaluation row) {
        if (!"COMPLETED".equals(row.getStatus())) return true;
        BigDecimal marks = row.getMarksAwarded();
        if (marks != null && marks.signum() > 0) return true;
        String answer = row.getExtractedAnswer();
        return answer != null && !answer.isBlank();
    }
}
