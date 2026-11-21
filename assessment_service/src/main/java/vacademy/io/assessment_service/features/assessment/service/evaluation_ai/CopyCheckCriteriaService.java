package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The evaluation criteria the AI copy check marks an assessment by, for the dashboard:
 * read every question of the paper with the rubric the check will use, and save the
 * teacher's criteria for some of them.
 *
 * <p>The rubric store belongs to ai_service (copy_check_rubric); a saved rubric is used
 * for every copy of the paper from the next check on. A question with no stored rubric
 * gets one generated on its first check, as before. The question's own
 * {@code evaluation_criteria_json} is shown as a starting point but never written here:
 * a question can sit in several papers through the question bank.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CopyCheckCriteriaService {

    static final int TEXT_PREVIEW_CHARS = 400;

    private final QuestionAssessmentSectionMappingRepository mappingRepository;
    private final AiServiceCopyCheckClient aiServiceClient;
    private final DashboardChoiceGroups choiceGroups;
    private final ObjectMapper objectMapper;

    /** One question of the paper, in paper order. */
    public record PaperQuestion(String questionId, int number, String text, String questionType, double maxMarks,
                                JsonNode questionCriteria) {
    }

    /** The live questions of the paper in the order the copy check numbers them. */
    @Transactional(readOnly = true)
    public List<PaperQuestion> paperQuestions(String assessmentId) {
        Map<String, Double> marks = choiceGroups.maxMarksByQuestion(assessmentId);
        List<QuestionAssessmentSectionMapping> live = new ArrayList<>();
        for (QuestionAssessmentSectionMapping m : mappingRepository.getQuestionAssessmentSectionMappingByAssessmentId(assessmentId)) {
            if (m.getQuestion() == null || "DELETED".equalsIgnoreCase(m.getStatus())) continue;
            live.add(m);
        }
        live.sort(Comparator
                .comparingLong((QuestionAssessmentSectionMapping m) -> m.getSection() != null
                        && m.getSection().getSectionOrder() != null ? m.getSection().getSectionOrder() : Integer.MAX_VALUE)
                .thenComparingLong(m -> m.getQuestionOrder() != null ? m.getQuestionOrder() : Integer.MAX_VALUE));
        List<PaperQuestion> out = new ArrayList<>();
        Set<String> seen = new java.util.HashSet<>();
        for (QuestionAssessmentSectionMapping m : live) {
            Question q = m.getQuestion();
            if (!seen.add(q.getId())) continue;
            out.add(new PaperQuestion(q.getId(), out.size() + 1, plainText(q), q.getQuestionType(),
                    marks.getOrDefault(q.getId(), 0.0), readJson(q.getEvaluationCriteriaJson())));
        }
        return out;
    }

    /**
     * {questions: [{question_id, number, text, question_type, max_marks, rubric, question_criteria}],
     * rubric_version}. {@code rubric} is what the copy check will mark the question by (null =
     * generated on its first check); {@code question_criteria} the question's own criteria.
     */
    public Map<String, Object> view(String instituteId, String assessmentId) {
        List<PaperQuestion> questions = paperQuestions(assessmentId);
        JsonNode stored;
        try {
            stored = aiServiceClient.fetchRubric(assessmentId, instituteId).orElse(null);
        } catch (AiServiceCopyCheckClient.RubricStoreUnavailableException e) {
            // Not "no rubric": showing every question as unset would invite overwriting.
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "the criteria could not be loaded; try again");
        }
        JsonNode rubrics = stored == null ? null : stored.path("rubric");
        List<Map<String, Object>> rows = new ArrayList<>();
        for (PaperQuestion q : questions) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("question_id", q.questionId());
            row.put("number", q.number());
            row.put("text", q.text());
            row.put("question_type", q.questionType());
            row.put("max_marks", q.maxMarks());
            JsonNode rubric = rubrics == null ? null : rubrics.get(q.questionId());
            row.put("rubric", rubric == null || rubric.isNull() ? null : rubric);
            row.put("question_criteria", q.questionCriteria());
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("questions", rows);
        out.put("rubric_version", stored != null && stored.hasNonNull("rubric_version")
                ? stored.get("rubric_version").asInt() : null);
        return out;
    }

    /**
     * Save rubrics for some questions of the paper ({@code question_id -> rubric}); the rest
     * are left as they are. Refuses a question that is not on the paper, and a rubric with
     * no criteria. {@code ifMatch} = the rubric_version the caller read (null = no check).
     * Returns the new rubric_version.
     */
    public int save(String instituteId, String assessmentId, JsonNode rubrics, Integer ifMatch) {
        if (rubrics == null || !rubrics.isObject() || rubrics.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "no rubrics to save");
        }
        Map<String, PaperQuestion> onPaper = new LinkedHashMap<>();
        for (PaperQuestion q : paperQuestions(assessmentId)) onPaper.put(q.questionId(), q);
        ObjectNode patch = objectMapper.createObjectNode();
        var fields = rubrics.fields();
        while (fields.hasNext()) {
            var e = fields.next();
            PaperQuestion q = onPaper.get(e.getKey());
            if (q == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "question " + e.getKey() + " is not on this paper");
            }
            patch.set(e.getKey(), objectMapper.createObjectNode().set("rubric", cleanRubric(e.getValue(), q.maxMarks())));
        }
        AiServiceCopyCheckClient.RubricPatchResult result = aiServiceClient.patchRubric(assessmentId, instituteId, patch, ifMatch);
        if (result.ok()) {
            return result.version();
        }
        log.warn("[copy-check] saving criteria for {} failed: {} {}", assessmentId, result.status(), result.detail());
        if (result.status() == 412) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "the criteria were changed by someone else; reload and try again");
        }
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "the criteria could not be saved; try again");
    }

    /**
     * The rubric as ai_service stores it: {max_marks, partial_marking_enabled,
     * evaluation_instructions, rubric: [{criteria_name, max_marks, keywords, evaluation_guidelines}]}.
     * Unnamed criteria are dropped; max_marks is the question's.
     */
    ObjectNode cleanRubric(JsonNode in, double questionMax) {
        if (in == null || !in.isObject()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a rubric must be an object");
        }
        ObjectNode out = objectMapper.createObjectNode();
        out.put("max_marks", questionMax > 0 ? questionMax : in.path("max_marks").asDouble(0));
        out.put("partial_marking_enabled", !in.has("partial_marking_enabled") || in.path("partial_marking_enabled").asBoolean(true));
        out.put("evaluation_instructions", truncate(in.path("evaluation_instructions").asText(""), 2000));
        var items = out.putArray("rubric");
        for (JsonNode c : in.path("rubric")) {
            String name = truncate(c.path("criteria_name").asText("").trim(), 200);
            if (name.isEmpty()) continue;
            ObjectNode item = items.addObject();
            item.put("criteria_name", name);
            item.put("max_marks", Math.max(0, c.path("max_marks").asDouble(0)));
            var keywords = item.putArray("keywords");
            for (JsonNode k : c.path("keywords")) {
                String kw = k.asText("").trim();
                if (!kw.isEmpty() && keywords.size() < 30) keywords.add(truncate(kw, 80));
            }
            item.put("evaluation_guidelines", truncate(c.path("evaluation_guidelines").asText(""), 3000));
        }
        if (items.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a rubric needs at least one criterion");
        }
        return out;
    }

    private JsonNode readJson(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String plainText(Question q) {
        String html = q.getTextData() != null ? q.getTextData().getContent() : null;
        if (html == null) return "";
        String text = html.replaceAll("(?i)<br\\s*/?>|</p>|</div>|</li>", " ")
                .replaceAll("<[^>]+>", "")
                .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#39;", "'")
                .replaceAll("\\s+", " ").trim();
        return truncate(text, TEXT_PREVIEW_CHARS);
    }

    private static String truncate(String s, int cap) {
        if (s == null) return "";
        return s.length() <= cap ? s : s.substring(0, cap).trim();
    }
}
