package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.question_core.dto.OptionDTO;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;
import vacademy.io.common.core.utils.PlainText;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Partner question ⇄ the platform's question tables (spec 5 "Question", 7.2).
 *
 * <ul>
 *   <li>Text and option text are plain text, stored HTML-escaped as rich text (G15).</li>
 *   <li>{@code question.source_meta} = {@code {"source":"API","question_number":label,
 *       "section":name,"option_labels":{label: option uuid},…}}; the copy checker already
 *       reads {@code question_number} and {@code section} from it.</li>
 *   <li>The answer key is written the way the import manager expects it: option labels as
 *       {@code previewId}s in {@code correctOptionIds}, mapped to the new option ids on save.</li>
 *   <li>Marking JSON on the section mapping:
 *       {@code {"type":T,"data":{"totalMark":m,"negativeMark":n,"negativeMarkingPercentage":0}}}.</li>
 * </ul>
 */
public final class QuestionMapper {

    public static final String SOURCE_API = "API";
    public static final String RICH_TEXT_TYPE = "HTML";

    // source_meta keys
    static final String META_SOURCE = "source";
    static final String META_LABEL = "question_number";
    static final String META_SECTION = "section";
    static final String META_OPTION_LABELS = "option_labels";
    static final String META_PARENT_LABEL = "parent_label";
    static final String META_TAGS = "tags";
    static final String META_EXTERNAL_ID = "external_id";
    static final String META_WORD_LIMIT = "word_limit";
    static final String META_EXPECTS_DIAGRAM = "expects_diagram";
    static final String META_ASSESS_LANGUAGE = "assess_language";
    /** "partner" once the partner set a rubric for the question through the API. */
    static final String META_RUBRIC_SOURCE = "rubric_source";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private QuestionMapper() {
    }

    /** The {@link QuestionDTO} {@code AddQuestionPaperFromImportManager.makeQuestionAndOptionFromImportQuestion} builds from. */
    public static QuestionDTO toQuestionDto(ExamValidator.ValidatedQuestion q, String instituteId) {
        QuestionDTO dto = new QuestionDTO();
        dto.setPreviewId(q.label());
        dto.setQuestionType(q.internalType());
        dto.setText(richText(q.text()));
        dto.setInstituteId(instituteId);
        dto.setSourceType(SOURCE_API);
        dto.setSourceMeta(sourceMeta(q, Map.of(), false).toString());
        dto.setAutoEvaluationJson(autoEvaluationJson(q));
        List<OptionDTO> options = new ArrayList<>();
        if (q.isChoice()) {
            for (ExamInputs.OptionInput o : q.options()) {
                options.add(new OptionDTO(o.getLabel(), richText(o.getText())));
            }
        }
        dto.setOptions(options);
        return dto;
    }

    public static AssessmentRichTextDataDTO richText(String plain) {
        return new AssessmentRichTextDataDTO(null, RICH_TEXT_TYPE, PlainText.escape(plain == null ? "" : plain));
    }

    /**
     * auto_evaluation_json in the shapes the scoring strategies and the copy checker read:
     * MCQ {@code correctOptionIds} (labels here, mapped to ids by the import manager),
     * NUMERIC {@code validAnswers}, ONE_WORD {@code answer}, LONG_ANSWER
     * {@code answer.content} = escaped model answer (read by {@code referenceAnswerFor}).
     */
    static String autoEvaluationJson(ExamValidator.ValidatedQuestion q) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("type", q.internalType());
        ObjectNode data = root.putObject("data");
        switch (q.internalType()) {
            case "MCQS", "MCQM", "TRUE_FALSE" -> {
                ArrayNode ids = data.putArray("correctOptionIds");
                q.correctLabels().forEach(ids::add);
            }
            case "NUMERIC" -> {
                ArrayNode values = data.putArray("validAnswers");
                q.numericAnswers().forEach(values::add);
            }
            case "ONE_WORD" -> data.put("answer", q.oneWordAnswer());
            case "LONG_ANSWER" -> {
                if (q.modelAnswer() != null) {
                    data.set("answer", longAnswer(q.modelAnswer()));
                }
            }
            default -> {
            }
        }
        return root.toString();
    }

    static ObjectNode longAnswer(String modelAnswer) {
        ObjectNode answer = MAPPER.createObjectNode();
        answer.putNull("id");
        answer.put("type", RICH_TEXT_TYPE);
        answer.put("content", PlainText.escape(modelAnswer));
        return answer;
    }

    /** Replaces (or removes, when null) the model answer inside a LONG_ANSWER auto_evaluation_json. */
    public static String withModelAnswer(String autoEvaluationJson, String modelAnswer) {
        ObjectNode root = parseObject(autoEvaluationJson);
        if (!root.has("type")) {
            root.put("type", "LONG_ANSWER");
        }
        JsonNode data = root.get("data");
        ObjectNode d = data instanceof ObjectNode o ? o : root.putObject("data");
        if (modelAnswer == null) {
            d.remove("answer");
        } else {
            d.set("answer", longAnswer(modelAnswer));
        }
        return root.toString();
    }

    /** source_meta for a new question; option labels are added once the option ids exist. */
    static ObjectNode sourceMeta(ExamValidator.ValidatedQuestion q, Map<String, String> optionIdsByLabel,
            boolean partnerRubric) {
        ObjectNode meta = MAPPER.createObjectNode();
        meta.put(META_SOURCE, SOURCE_API);
        meta.put(META_LABEL, q.label());
        meta.put(META_SECTION, q.section());
        if (!optionIdsByLabel.isEmpty()) {
            ObjectNode labels = meta.putObject(META_OPTION_LABELS);
            optionIdsByLabel.forEach(labels::put);
        }
        if (q.parentLabel() != null) {
            meta.put(META_PARENT_LABEL, q.parentLabel());
        }
        if (q.tags() != null) {
            meta.set(META_TAGS, MAPPER.valueToTree(q.tags()));
        }
        if (q.externalId() != null) {
            meta.put(META_EXTERNAL_ID, q.externalId());
        }
        if (q.wordLimit() != null) {
            meta.put(META_WORD_LIMIT, q.wordLimit());
        }
        if (q.expectsDiagram() != null) {
            meta.put(META_EXPECTS_DIAGRAM, q.expectsDiagram());
        }
        if (q.assessLanguage() != null) {
            meta.put(META_ASSESS_LANGUAGE, q.assessLanguage());
        }
        if (partnerRubric) {
            meta.put(META_RUBRIC_SOURCE, "partner");
        }
        return meta;
    }

    /**
     * Labels the options of a freshly built question (the import manager builds options in
     * request order, so they line up with the partner's labels) and records
     * {@code option_labels} in source_meta. Returns label → option id.
     */
    public static Map<String, String> labelOptions(Question question, ExamValidator.ValidatedQuestion q,
            boolean partnerRubric) {
        Map<String, String> byLabel = new LinkedHashMap<>();
        if (q.isChoice()) {
            List<Option> options = question.getOptions();
            for (int i = 0; i < q.options().size() && i < options.size(); i++) {
                byLabel.put(q.options().get(i).getLabel(), options.get(i).getId());
            }
        }
        question.setSourceMeta(sourceMeta(q, byLabel, partnerRubric).toString());
        return byLabel;
    }

    /** {@code {"type":T,"data":{"totalMark":m,"negativeMark":n,"negativeMarkingPercentage":0}}}. */
    public static String markingJson(String internalType, BigDecimal maxMarks, BigDecimal negativeMarks) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("type", internalType);
        ObjectNode data = root.putObject("data");
        data.put("totalMark", maxMarks.doubleValue());
        data.put("negativeMark", negativeMarks == null ? 0.0 : negativeMarks.doubleValue());
        data.put("negativeMarkingPercentage", 0);
        return root.toString();
    }

    /** {@code data.totalMark} of a marking JSON; null when absent or unreadable. */
    public static Double totalMark(String markingJson) {
        JsonNode v = parseObject(markingJson).path("data").path("totalMark");
        return v.isNumber() ? v.asDouble() : null;
    }

    /** {@code data.negativeMark} of a marking JSON; 0 when absent. */
    public static double negativeMark(String markingJson) {
        JsonNode v = parseObject(markingJson).path("data").path("negativeMark");
        return v.isNumber() ? v.asDouble() : 0.0;
    }

    /** Rewrites totalMark / negativeMark of a marking JSON, keeping any other field. */
    public static String withMarks(String markingJson, String internalType, BigDecimal maxMarks, BigDecimal negativeMarks) {
        ObjectNode root = parseObject(markingJson);
        if (!root.has("type")) {
            root.put("type", internalType);
        }
        JsonNode data = root.get("data");
        ObjectNode d = data instanceof ObjectNode o ? o : root.putObject("data");
        if (maxMarks != null) {
            d.put("totalMark", maxMarks.doubleValue());
        }
        if (negativeMarks != null) {
            d.put("negativeMark", negativeMarks.doubleValue());
        }
        if (!d.has("negativeMarkingPercentage")) {
            d.put("negativeMarkingPercentage", 0);
        }
        return root.toString();
    }

    // ------------------------------------------------------------------ read side

    public static ObjectNode meta(Question question) {
        return parseObject(question.getSourceMeta());
    }

    public static String label(Question question) {
        String label = textOrNull(meta(question), META_LABEL);
        return label != null ? label : question.getId();
    }

    /** Option id → partner label; options without a recorded label get A, B, C… by position. */
    static Map<String, String> labelsById(Question question) {
        Map<String, String> out = new LinkedHashMap<>();
        JsonNode labels = meta(question).path(META_OPTION_LABELS);
        if (labels.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = labels.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                out.put(e.getValue().asText(), e.getKey());
            }
        }
        return out;
    }

    /** Partner option label → option id, as recorded in {@code source_meta.option_labels}. */
    public static Map<String, String> optionIdsByLabel(Question question) {
        Map<String, String> out = new LinkedHashMap<>();
        JsonNode labels = meta(question).path(META_OPTION_LABELS);
        if (labels.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = labels.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                out.put(e.getKey(), e.getValue().asText());
            }
        }
        return out;
    }

    /** The question's section name as the partner sent it, or null. */
    public static String sectionName(Question question) {
        return textOrNull(meta(question), META_SECTION);
    }

    /**
     * The public question view.
     *
     * @param full false = the compact create-response shape (id, label, section, max
     *             marks, option ids); true = everything partner-editable
     */
    public static ExamViews.Question toView(Question question, String markingJson, boolean full) {
        ObjectNode meta = meta(question);
        Map<String, String> labelsById = labelsById(question);
        List<ExamViews.Option> options = null;
        List<Option> stored = question.getOptions();
        if (stored != null && !stored.isEmpty()) {
            options = new ArrayList<>();
            int position = 0;
            for (Option o : stored) {
                String label = labelsById.getOrDefault(o.getId(), String.valueOf((char) ('A' + Math.min(position, 25))));
                String text = full && o.getText() != null ? PlainText.unescape(o.getText().getContent()) : null;
                options.add(new ExamViews.Option(label, o.getId(), text));
                position++;
            }
        }
        ExamViews.Question.QuestionBuilder b = ExamViews.Question.builder()
                .id(question.getId())
                .label(label(question))
                .section(textOrNull(meta, META_SECTION))
                .maxMarks(totalMark(markingJson))
                .options(options);
        if (!full) {
            return b.build();
        }
        b.type(ExamValidator.INTERNAL_TO_TYPE.getOrDefault(question.getQuestionType(), question.getQuestionType()))
                .text(question.getTextData() == null ? null : PlainText.unescape(question.getTextData().getContent()))
                .negativeMarks(negativeMark(markingJson))
                .parentLabel(textOrNull(meta, META_PARENT_LABEL))
                .externalId(textOrNull(meta, META_EXTERNAL_ID));
        if (meta.path(META_WORD_LIMIT).isNumber()) {
            b.wordLimit(meta.get(META_WORD_LIMIT).asInt());
        }
        if (meta.path(META_EXPECTS_DIAGRAM).isBoolean()) {
            b.expectsDiagram(meta.get(META_EXPECTS_DIAGRAM).asBoolean());
        }
        if (meta.path(META_ASSESS_LANGUAGE).isBoolean()) {
            b.assessLanguage(meta.get(META_ASSESS_LANGUAGE).asBoolean());
        }
        if (meta.path(META_TAGS).isObject()) {
            b.tags(MAPPER.convertValue(meta.get(META_TAGS), Map.class));
        }
        JsonNode data = parseObject(question.getAutoEvaluationJson()).path("data");
        switch (question.getQuestionType() == null ? "" : question.getQuestionType()) {
            case "MCQS", "MCQM", "TRUE_FALSE" -> {
                List<String> correct = new ArrayList<>();
                JsonNode ids = data.path("correctOptionIds");
                if (ids.isArray()) {
                    ids.forEach(id -> correct.add(labelsById.getOrDefault(id.asText(), id.asText())));
                }
                b.correctOptions(correct);
            }
            case "NUMERIC" -> {
                JsonNode values = data.path("validAnswers");
                if (values.isArray() && values.size() == 1) {
                    b.answer(values.get(0).numberValue());
                } else if (values.isArray()) {
                    List<Object> all = new ArrayList<>();
                    values.forEach(v -> all.add(v.numberValue()));
                    b.answer(all);
                }
            }
            case "ONE_WORD" -> {
                if (data.path("answer").isTextual()) {
                    b.answer(data.get("answer").asText());
                }
            }
            default -> {
            }
        }
        return b.build();
    }

    /** The model answer stored on a LONG_ANSWER question (unescaped), or null. */
    public static String modelAnswer(Question question) {
        JsonNode answer = parseObject(question.getAutoEvaluationJson()).path("data").path("answer");
        String html = answer.isTextual() ? answer.asText() : answer.path("content").asText(null);
        return html == null || html.isEmpty() ? null : PlainText.unescape(html);
    }

    static ObjectNode parseObject(String json) {
        if (json == null || json.isBlank()) {
            return MAPPER.createObjectNode();
        }
        try {
            JsonNode node = MAPPER.readTree(json);
            return node instanceof ObjectNode o ? o : MAPPER.createObjectNode();
        } catch (Exception e) {
            return MAPPER.createObjectNode();
        }
    }

    static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? null : v.asText();
    }
}
