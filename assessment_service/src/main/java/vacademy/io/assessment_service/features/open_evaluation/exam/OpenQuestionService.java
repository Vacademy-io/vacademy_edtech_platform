package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.SectionAddEditRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentLinkQuestionsManager;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiActorPrincipals;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricMapper;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricSyncService;
import vacademy.io.assessment_service.features.question_bank.manager.AddQuestionPaperFromImportManager;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.OptionRepository;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.PlainText;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Questions of an API exam (spec 7.2): build through
 * {@code AddQuestionPaperFromImportManager.makeQuestionAndOptionFromImportQuestion}, link
 * through {@code AssessmentLinkQuestionsManager.saveQuestionsToAssessment} (the dashboard's
 * own paths), and keep labels, option labels and provenance in {@code question.source_meta}.
 *
 * <p>After {@code open} the structure is frozen (no add/remove, no max-marks change): this
 * service refuses it for partner calls, and {@code AssessmentLinkQuestionsManager} refuses it
 * for dashboard edits of API exams.
 */
@Slf4j
@Service
public class OpenQuestionService {

    static final String EXAM_PLAY_MODE = "EXAM";
    static final String STATUS_ACTIVE = "ACTIVE";
    static final String STATUS_DELETED = "DELETED";

    /** Fields a partner may still change after open (spec 7.2 PATCH). */
    static final Set<String> OPEN_EDITABLE = Set.of("text", "model_answer", "rubric", "tags", "word_limit",
            "expects_diagram");
    /** Fields that never change through PATCH; delete and re-add the question instead. */
    static final Set<String> NOT_PATCHABLE = Set.of("type", "section");
    /** Every field of the question object (spec 7.2). */
    static final Set<String> QUESTION_FIELDS = Set.of("label", "parent_label", "section", "type", "text", "max_marks",
            "negative_marks", "options", "correct_options", "answer", "model_answer", "rubric", "word_limit",
            "expects_diagram", "assess_language", "tags", "external_id");

    private final AddQuestionPaperFromImportManager importManager;
    private final AssessmentLinkQuestionsManager linkManager;
    private final QuestionRepository questionRepository;
    private final OptionRepository optionRepository;
    private final QuestionAssessmentSectionMappingRepository mappingRepository;
    private final SectionRepository sectionRepository;
    private final ApiExamStore examStore;
    private final ChoiceGroupStore choiceGroupStore;
    private final RubricSyncService rubricSync;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    public OpenQuestionService(AddQuestionPaperFromImportManager importManager, AssessmentLinkQuestionsManager linkManager,
            QuestionRepository questionRepository, OptionRepository optionRepository,
            QuestionAssessmentSectionMappingRepository mappingRepository, SectionRepository sectionRepository,
            ApiExamStore examStore, ChoiceGroupStore choiceGroupStore, RubricSyncService rubricSync,
            ObjectMapper objectMapper) {
        this.importManager = importManager;
        this.linkManager = linkManager;
        this.questionRepository = questionRepository;
        this.optionRepository = optionRepository;
        this.mappingRepository = mappingRepository;
        this.sectionRepository = sectionRepository;
        this.examStore = examStore;
        this.choiceGroupStore = choiceGroupStore;
        this.rubricSync = rubricSync;
        this.objectMapper = objectMapper;
    }

    /** One question of the exam as linked: mapping (marks, order), question, section. */
    public record ExamQuestion(QuestionAssessmentSectionMapping mapping, Question question, Section section) {
        public String id() {
            return question.getId();
        }

        public String label() {
            return QuestionMapper.label(question);
        }

        public BigDecimal maxMarks() {
            Double total = QuestionMapper.totalMark(mapping.getMarkingJson());
            return total == null ? null : BigDecimal.valueOf(total);
        }
    }

    // ------------------------------------------------------------------ reads

    /** The exam's linked questions in paper order (section order, then question order). */
    public List<ExamQuestion> load(String examId) {
        List<ExamQuestion> out = new ArrayList<>();
        for (QuestionAssessmentSectionMapping m : mappingRepository.getQuestionAssessmentSectionMappingByAssessmentId(examId)) {
            if (STATUS_DELETED.equalsIgnoreCase(m.getStatus()) || m.getQuestion() == null || m.getSection() == null) {
                continue;
            }
            out.add(new ExamQuestion(m, m.getQuestion(), m.getSection()));
        }
        out.sort(Comparator.<ExamQuestion>comparingInt(q -> q.section().getSectionOrder() == null ? 0 : q.section().getSectionOrder())
                .thenComparingInt(q -> q.mapping().getQuestionOrder() == null ? 0 : q.mapping().getQuestionOrder()));
        return out;
    }

    // ------------------------------------------------------------------ create (shared with POST /exams)

    /** Result of creating questions: entities by label and the rubric changes to stage. */
    public record Created(Map<String, Question> byLabel, Map<String, ObjectNode> rubricChanges) {
    }

    /**
     * Builds, saves and links questions. Sections named by the questions that do not exist
     * yet are created (with {@code sectionOrders} giving their order when known).
     */
    public Created createQuestions(ApiKeyPrincipal key, String examId, List<ExamValidator.ValidatedQuestion> questions,
            List<ExamInputs.SectionInput> sectionOrders) {
        String instituteId = key.getInstituteId();
        Map<String, Question> byLabel = new LinkedHashMap<>();
        Map<String, ObjectNode> rubricChanges = new LinkedHashMap<>();
        if (questions.isEmpty()) {
            return new Created(byLabel, rubricChanges);
        }
        List<Question> built = new ArrayList<>();
        List<Option> options = new ArrayList<>();
        for (ExamValidator.ValidatedQuestion q : questions) {
            Question question;
            try {
                question = importManager.makeQuestionAndOptionFromImportQuestion(
                        QuestionMapper.toQuestionDto(q, instituteId), false, null);
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("Could not build question " + q.label(), e);
            }
            // The import manager does not copy institute_id from the DTO (only the paper path sets it).
            question.setInstituteId(instituteId);
            QuestionMapper.labelOptions(question, q, q.rubric() != null);
            built.add(question);
            options.addAll(question.getOptions());
            byLabel.put(q.label(), question);
        }
        questionRepository.saveAll(built);
        optionRepository.saveAll(options);

        link(key, examId, questions, byLabel, sectionOrders);

        for (ExamValidator.ValidatedQuestion q : questions) {
            ObjectNode change = objectMapper.createObjectNode();
            if (q.rubric() != null) {
                change.set("rubric", objectMapper.valueToTree(RubricMapper.toEngine(q.rubric(), q.maxMarks())));
            }
            if (q.modelAnswer() != null) {
                change.put("model_answer", q.modelAnswer());
            }
            if (change.size() > 0) {
                rubricChanges.put(byLabel.get(q.label()).getId(), change);
            }
        }
        return new Created(byLabel, rubricChanges);
    }

    private void link(ApiKeyPrincipal key, String examId, List<ExamValidator.ValidatedQuestion> questions,
            Map<String, Question> byLabel, List<ExamInputs.SectionInput> sectionOrders) {
        Map<String, Section> existing = sectionsByName(examId);
        Map<String, Integer> nextOrder = new HashMap<>();
        Map<String, BigDecimal> sectionTotals = new HashMap<>();
        for (ExamQuestion eq : load(examId)) {
            String name = eq.section().getName().toLowerCase(Locale.ROOT);
            int order = eq.mapping().getQuestionOrder() == null ? 0 : eq.mapping().getQuestionOrder();
            nextOrder.merge(name, order + 1, Math::max);
            BigDecimal max = eq.maxMarks();
            sectionTotals.merge(name, max == null ? BigDecimal.ZERO : max, BigDecimal::add);
        }
        Map<String, Integer> declaredOrder = new HashMap<>();
        if (sectionOrders != null) {
            sectionOrders.forEach(s -> declaredOrder.put(s.getName().toLowerCase(Locale.ROOT), s.getOrder()));
        }
        int maxSectionOrder = existing.values().stream()
                .mapToInt(s -> s.getSectionOrder() == null ? 0 : s.getSectionOrder()).max().orElse(0);

        Map<String, SectionAddEditRequestDto> bySection = new LinkedHashMap<>();
        for (ExamValidator.ValidatedQuestion q : questions) {
            String key0 = q.section().toLowerCase(Locale.ROOT);
            Section section = existing.get(key0);
            SectionAddEditRequestDto dto = bySection.get(key0);
            if (dto == null) {
                dto = new SectionAddEditRequestDto();
                dto.setQuestionAndMarking(new ArrayList<>());
                if (section != null) {
                    dto.setSectionId(section.getId());
                    dto.setSectionName(section.getName());
                    dto.setSectionOrder(section.getSectionOrder());
                } else {
                    dto.setSectionName(q.section());
                    Integer order = declaredOrder.get(key0);
                    dto.setSectionOrder(order != null ? order : ++maxSectionOrder);
                }
                bySection.put(key0, dto);
            }
            int order = nextOrder.getOrDefault(key0, 1);
            nextOrder.put(key0, order + 1);
            SectionAddEditRequestDto.QuestionAndMarking qm = new SectionAddEditRequestDto.QuestionAndMarking();
            qm.setQuestionId(byLabel.get(q.label()).getId());
            qm.setMarkingJson(QuestionMapper.markingJson(q.internalType(), q.maxMarks(), q.negativeMarks()));
            qm.setQuestionDurationInMin(0);
            qm.setQuestionOrder(order);
            qm.setIsAdded(true);
            qm.setIsDeleted(false);
            qm.setIsUpdated(false);
            dto.getQuestionAndMarking().add(qm);
            sectionTotals.merge(key0, q.maxMarks(), BigDecimal::add);
        }
        AddQuestionsAssessmentDetailsDTO request = new AddQuestionsAssessmentDetailsDTO();
        bySection.forEach((name, dto) -> {
            dto.setTotalMarks(sectionTotals.getOrDefault(name, BigDecimal.ZERO).doubleValue());
            if (dto.getSectionId() != null) {
                request.getUpdatedSections().add(dto);
            } else {
                request.getAddedSections().add(dto);
            }
        });
        CustomUserDetails actor = ApiActorPrincipals.forKey(key);
        linkManager.saveQuestionsToAssessment(actor, request, examId, key.getInstituteId(), EXAM_PLAY_MODE);
    }

    /** Active sections of the exam keyed by lower-case name. */
    Map<String, Section> sectionsByName(String examId) {
        Map<String, Section> out = new LinkedHashMap<>();
        List<Section> sections = entityManager.createQuery(
                        "SELECT s FROM Section s WHERE s.assessment.id = :id AND s.status = :status ORDER BY s.sectionOrder",
                        Section.class)
                .setParameter("id", examId)
                .setParameter("status", STATUS_ACTIVE)
                .getResultList();
        for (Section s : sections) {
            out.putIfAbsent(s.getName().toLowerCase(Locale.ROOT), s);
        }
        return out;
    }

    /** Creates empty sections that do not exist yet (PATCH /exams sections in draft). */
    void ensureSections(String examId, List<ExamInputs.SectionInput> sections) {
        Map<String, Section> existing = sectionsByName(examId);
        for (ExamInputs.SectionInput s : sections) {
            Section section = existing.get(s.getName().toLowerCase(Locale.ROOT));
            if (section == null) {
                SectionAddEditRequestDto dto = new SectionAddEditRequestDto();
                dto.setSectionName(s.getName());
                dto.setSectionOrder(s.getOrder());
                dto.setTotalMarks(0.0);
                linkManager.createUpdateSection(new Section(), dto, entityManager.getReference(
                        vacademy.io.assessment_service.features.assessment.entity.Assessment.class, examId), STATUS_ACTIVE);
            } else if (s.getOrder() != null && !s.getOrder().equals(section.getSectionOrder())) {
                section.setSectionOrder(s.getOrder());
                sectionRepository.save(section);
            }
        }
    }

    // ------------------------------------------------------------------ POST /exams/{id}/questions

    /** Result of a question write: the views, rubric changes staged, and warnings. */
    public record Written(List<ExamViews.Question> questions, boolean rubricStaged, List<ExamViews.Warning> warnings) {
    }

    @Transactional
    public Written addQuestions(ApiKeyPrincipal key, String examId, ExamInputs.AddQuestions body) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireDraft(exam, "adding questions");
        List<ExamInputs.QuestionInput> raw = body == null || body.getQuestions() == null ? List.of() : body.getQuestions();
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        if (raw.isEmpty()) {
            errors.add(ExamValidator.err("questions", "required", "Send 1 to " + ExamValidator.MAX_QUESTIONS + " questions."));
        }
        List<ExamQuestion> current = load(examId);
        if (current.size() + raw.size() > ExamValidator.MAX_QUESTIONS) {
            errors.add(ExamValidator.err("questions", "too_many",
                    "An exam has at most " + ExamValidator.MAX_QUESTIONS + " questions; it has " + current.size() + "."));
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        List<ExamViews.Warning> warnings = new ArrayList<>();
        Set<String> existingLabels = new LinkedHashSet<>();
        current.forEach(q -> existingLabels.add(q.label()));
        // New section names are accepted here: they become new sections at the end.
        List<ExamValidator.ValidatedQuestion> questions = ExamValidator.validateQuestions(raw, exam.mode(), existingLabels,
                Set.of(), "questions", errors, warnings);
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        ExamValidator.checkQuestionRules(questions, "questions", warnings);
        ExamValidator.autoRubricWarning(questions, warnings);
        // A question without a section goes to the first existing section, not to a new "A".
        Map<String, Section> sections = sectionsByName(examId);
        if (!sections.isEmpty()) {
            String first = sections.values().iterator().next().getName();
            List<ExamValidator.ValidatedQuestion> placed = new ArrayList<>();
            for (int i = 0; i < questions.size(); i++) {
                ExamValidator.ValidatedQuestion q = questions.get(i);
                boolean noSection = raw.get(i).getSection() == null || raw.get(i).getSection().isBlank();
                placed.add(noSection ? withSection(q, first) : withSection(q, canonical(sections, q.section())));
            }
            questions = placed;
        }

        Created created = createQuestions(key, examId, questions, null);
        rubricSync.stage(examId, created.rubricChanges());
        examStore.touch(examId);
        entityManager.flush();
        Map<String, String> markingById = new HashMap<>();
        load(examId).forEach(eq -> markingById.put(eq.id(), eq.mapping().getMarkingJson()));
        List<ExamViews.Question> views = new ArrayList<>();
        for (Question q : created.byLabel().values()) {
            views.add(QuestionMapper.toView(q, markingById.get(q.getId()), false));
        }
        return new Written(views, !created.rubricChanges().isEmpty(), warnings);
    }

    private static String canonical(Map<String, Section> sections, String name) {
        Section s = sections.get(name.toLowerCase(Locale.ROOT));
        return s == null ? name : s.getName();
    }

    static ExamValidator.ValidatedQuestion withSection(ExamValidator.ValidatedQuestion q, String section) {
        return new ExamValidator.ValidatedQuestion(q.label(), q.parentLabel(), section, q.type(), q.internalType(),
                q.text(), q.maxMarks(), q.negativeMarks(), q.options(), q.correctLabels(), q.numericAnswers(),
                q.oneWordAnswer(), q.modelAnswer(), q.rubric(), q.wordLimit(), q.expectsDiagram(), q.assessLanguage(),
                q.tags(), q.externalId());
    }

    // ------------------------------------------------------------------ GET /exams/{id}/questions

    @Transactional(readOnly = true)
    public List<ExamViews.Question> listQuestions(ApiKeyPrincipal key, String examId, boolean withModelAnswer) {
        ApiExamStore.ApiExamRow exam = examStore.find(key.getInstituteId(), examId)
                .orElseThrow(ExamGuards::examNotFound);
        List<ExamViews.Question> out = new ArrayList<>();
        for (ExamQuestion eq : load(exam.assessmentId())) {
            ExamViews.Question view = QuestionMapper.toView(eq.question(), eq.mapping().getMarkingJson(), true);
            if (withModelAnswer && "LONG_ANSWER".equals(eq.question().getQuestionType())) {
                view.setModelAnswer(QuestionMapper.modelAnswer(eq.question()));
            }
            out.add(view);
        }
        return out;
    }

    // ------------------------------------------------------------------ PATCH /exams/{id}/questions/{qid}

    /** PATCH result: the updated view and whether a rubric change was staged. */
    public record Patched(ExamViews.Question question, boolean rubricStaged, List<ExamViews.Warning> warnings) {
    }

    @Transactional
    public Patched patchQuestion(ApiKeyPrincipal key, String examId, String questionId, ObjectNode body) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        if (body == null || body.isEmpty()) {
            throw OpenApiException.validation(null, "required", "Send at least one field to change.");
        }
        List<ExamQuestion> all = load(examId);
        ExamQuestion target = all.stream().filter(q -> q.id().equals(questionId)).findFirst()
                .orElseThrow(ExamGuards::questionNotFound);

        Set<String> fields = new LinkedHashSet<>();
        body.fieldNames().forEachRemaining(fields::add);
        List<String> unknown = fields.stream().filter(f -> !QUESTION_FIELDS.contains(f)).toList();
        if (!unknown.isEmpty()) {
            throw OpenApiException.validation(unknown.get(0), "unknown_field",
                    unknown.get(0) + " is not a field of the question object.");
        }
        List<String> notPatchable = fields.stream().filter(NOT_PATCHABLE::contains).toList();
        if (!notPatchable.isEmpty()) {
            throw OpenApiException.validation(notPatchable.get(0), "not_editable",
                    notPatchable.get(0) + " cannot be changed; delete the question and add it again.");
        }
        if (!exam.isDraft()) {
            List<String> frozen = fields.stream().filter(f -> !OPEN_EDITABLE.contains(f)).toList();
            if (!frozen.isEmpty()) {
                throw OpenApiException.conflict(ApiErrorCode.EXAM_OPEN,
                        "The exam is open; only text, model_answer, rubric, tags, word_limit and expects_diagram can change.",
                        Map.of("fields", frozen));
            }
        }

        ExamInputs.QuestionInput merged = currentInput(target);
        try {
            merged = objectMapper.readerForUpdating(merged).readValue(body);
        } catch (Exception e) {
            throw OpenApiException.validation(null, "invalid", "The body does not match the question object.");
        }
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        List<ExamViews.Warning> warnings = new ArrayList<>();
        Set<String> otherLabels = new LinkedHashSet<>();
        all.stream().filter(q -> !q.id().equals(questionId)).forEach(q -> otherLabels.add(q.label()));
        List<ExamValidator.ValidatedQuestion> validated = ExamValidator.validateQuestions(List.of(merged), exam.mode(),
                otherLabels, Set.of(target.section().getName()), "question", errors, warnings);
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        ExamValidator.checkQuestionRules(validated, "question", warnings);
        ExamValidator.ValidatedQuestion v = withSection(validated.get(0), target.section().getName());

        Question question = target.question();
        ObjectNode change = objectMapper.createObjectNode();
        if (fields.contains("text") && question.getTextData() != null) {
            question.getTextData().setContent(PlainText.escape(v.text()));
        } else if (fields.contains("text")) {
            question.setTextData(new AssessmentRichTextData(null, QuestionMapper.RICH_TEXT_TYPE, PlainText.escape(v.text())));
        }
        if (fields.contains("options") || fields.contains("correct_options")) {
            replaceOptions(question, v);
        }
        if (fields.contains("answer") && ("NUMERIC".equals(v.internalType()) || "ONE_WORD".equals(v.internalType()))) {
            question.setAutoEvaluationJson(QuestionMapper.autoEvaluationJson(v));
        }
        if (fields.contains("model_answer")) {
            question.setAutoEvaluationJson(QuestionMapper.withModelAnswer(question.getAutoEvaluationJson(), v.modelAnswer()));
            if (v.modelAnswer() == null) {
                change.putNull("model_answer");
            } else {
                change.put("model_answer", v.modelAnswer());
            }
        }
        boolean partnerRubric = "partner".equals(QuestionMapper.textOrNull(QuestionMapper.meta(question),
                QuestionMapper.META_RUBRIC_SOURCE));
        if (fields.contains("rubric")) {
            if (body.get("rubric").isNull()) {
                change.putNull("rubric");
                partnerRubric = false;
            } else {
                change.set("rubric", objectMapper.valueToTree(RubricMapper.toEngine(v.rubric(), v.maxMarks())));
                partnerRubric = true;
            }
        }
        // Rewrite source_meta from the validated question, keeping option labels.
        ObjectNode meta = QuestionMapper.sourceMeta(v, currentOptionLabels(question), partnerRubric);
        question.setSourceMeta(meta.toString());
        questionRepository.save(question);

        if (fields.contains("max_marks") || fields.contains("negative_marks")) {
            QuestionAssessmentSectionMapping mapping = target.mapping();
            mapping.setMarkingJson(QuestionMapper.withMarks(mapping.getMarkingJson(), v.internalType(), v.maxMarks(),
                    v.negativeMarks()));
            mappingRepository.save(mapping);
            recomputeSectionTotal(examId, target.section());
        }
        // A text change after open bumps the rubric version so results show rubric_stale (spec 7.2).
        if (change.isEmpty() && fields.contains("text") && !exam.isDraft()) {
            rubricSync.stage(examId, Map.of(questionId, change));
        } else if (!change.isEmpty()) {
            rubricSync.stage(examId, Map.of(questionId, change));
        }
        examStore.touch(examId);
        entityManager.flush();
        ExamViews.Question view = QuestionMapper.toView(question, target.mapping().getMarkingJson(), true);
        if ("LONG_ANSWER".equals(question.getQuestionType())) {
            view.setModelAnswer(QuestionMapper.modelAnswer(question));
        }
        if (change.path("rubric").isObject()) {
            view.setRubric(RubricMapper.toPartner(objectMapper.convertValue(change.get("rubric"),
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {
                    })));
        }
        boolean staged = !change.isEmpty() || (fields.contains("text") && !exam.isDraft());
        return new Patched(view, staged, warnings);
    }

    /** The question as a partner input, for merging a PATCH onto it. */
    ExamInputs.QuestionInput currentInput(ExamQuestion eq) {
        ExamViews.Question view = QuestionMapper.toView(eq.question(), eq.mapping().getMarkingJson(), true);
        ExamInputs.QuestionInput in = new ExamInputs.QuestionInput();
        in.setLabel(view.getLabel());
        in.setParentLabel(view.getParentLabel());
        in.setSection(eq.section().getName());
        in.setType(view.getType());
        in.setText(view.getText());
        in.setMaxMarks(view.getMaxMarks() == null ? null : BigDecimal.valueOf(view.getMaxMarks()));
        in.setNegativeMarks(BigDecimal.valueOf(view.getNegativeMarks() == null ? 0.0 : view.getNegativeMarks()));
        if (view.getOptions() != null && !view.getOptions().isEmpty()) {
            List<ExamInputs.OptionInput> options = new ArrayList<>();
            view.getOptions().forEach(o -> options.add(new ExamInputs.OptionInput(o.label(), o.text())));
            in.setOptions(options);
            in.setCorrectOptions(view.getCorrectOptions());
        }
        if (view.getAnswer() != null) {
            in.setAnswer(objectMapper.valueToTree(view.getAnswer()));
        }
        if ("LONG_ANSWER".equals(eq.question().getQuestionType())) {
            in.setModelAnswer(QuestionMapper.modelAnswer(eq.question()));
        }
        in.setWordLimit(view.getWordLimit());
        in.setExpectsDiagram(view.getExpectsDiagram());
        in.setAssessLanguage(view.getAssessLanguage());
        in.setTags(view.getTags());
        in.setExternalId(view.getExternalId());
        return in;
    }

    private Map<String, String> currentOptionLabels(Question question) {
        Map<String, String> out = new LinkedHashMap<>();
        JsonNode labels = QuestionMapper.meta(question).path(QuestionMapper.META_OPTION_LABELS);
        if (labels.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = labels.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                out.put(e.getKey(), e.getValue().asText());
            }
        }
        return out;
    }

    /**
     * Draft-only: replaces options and answer key. Options keep their id when their label
     * stays, so nothing pointing at them breaks; options whose label disappeared are deleted
     * (the copy checker loads every option row of the question).
     */
    void replaceOptions(Question question, ExamValidator.ValidatedQuestion v) {
        Map<String, String> idByLabel = currentOptionLabels(question);
        Map<String, Option> existingById = new HashMap<>();
        for (Option o : optionRepository.findByQuestionId(question.getId())) {
            existingById.put(o.getId(), o);
        }
        Map<String, String> newIdByLabel = new LinkedHashMap<>();
        List<Option> keep = new ArrayList<>();
        for (ExamInputs.OptionInput in : v.options()) {
            String id = idByLabel.get(in.getLabel());
            Option option = id == null ? null : existingById.remove(id);
            if (option == null) {
                option = new Option();
                option.setId(UUID.randomUUID().toString());
                option.setQuestion(question);
            }
            if (option.getText() == null) {
                option.setText(new AssessmentRichTextData(null, QuestionMapper.RICH_TEXT_TYPE, PlainText.escape(in.getText())));
            } else {
                option.getText().setContent(PlainText.escape(in.getText()));
            }
            keep.add(option);
            newIdByLabel.put(in.getLabel(), option.getId());
        }
        optionRepository.saveAll(keep);
        if (!existingById.isEmpty()) {
            optionRepository.deleteAll(existingById.values());
        }
        question.setOptions(keep);
        ObjectNode root = objectMapper.createObjectNode();
        root.put("type", v.internalType());
        var ids = root.putObject("data").putArray("correctOptionIds");
        v.correctLabels().forEach(label -> ids.add(newIdByLabel.get(label)));
        question.setAutoEvaluationJson(root.toString());
        ObjectNode meta = QuestionMapper.meta(question);
        ObjectNode labels = meta.putObject(QuestionMapper.META_OPTION_LABELS);
        newIdByLabel.forEach(labels::put);
        question.setSourceMeta(meta.toString());
    }

    private void recomputeSectionTotal(String examId, Section section) {
        BigDecimal total = BigDecimal.ZERO;
        for (ExamQuestion eq : load(examId)) {
            if (eq.section().getId().equals(section.getId()) && eq.maxMarks() != null) {
                total = total.add(eq.maxMarks());
            }
        }
        section.setTotalMarks(total.doubleValue());
        sectionRepository.save(section);
    }

    // ------------------------------------------------------------------ DELETE /exams/{id}/questions/{qid}

    @Transactional
    public boolean deleteQuestion(ApiKeyPrincipal key, String examId, String questionId) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireDraft(exam, "removing questions");
        ExamQuestion target = load(examId).stream().filter(q -> q.id().equals(questionId)).findFirst()
                .orElseThrow(ExamGuards::questionNotFound);
        if (choiceGroupStore.isQuestionGrouped(examId, questionId)) {
            throw OpenApiException.validation("question_id", "in_choice_group",
                    "Question " + target.label() + " is in a choice group; update choice groups first.");
        }
        SectionAddEditRequestDto dto = new SectionAddEditRequestDto();
        dto.setSectionId(target.section().getId());
        dto.setSectionName(target.section().getName());
        dto.setSectionOrder(target.section().getSectionOrder());
        SectionAddEditRequestDto.QuestionAndMarking qm = new SectionAddEditRequestDto.QuestionAndMarking();
        qm.setQuestionId(questionId);
        qm.setMarkingJson(target.mapping().getMarkingJson());
        qm.setQuestionOrder(target.mapping().getQuestionOrder());
        qm.setQuestionDurationInMin(0);
        qm.setIsAdded(false);
        qm.setIsDeleted(true);
        qm.setIsUpdated(false);
        dto.setQuestionAndMarking(new ArrayList<>(List.of(qm)));
        BigDecimal remaining = BigDecimal.ZERO;
        for (ExamQuestion eq : load(examId)) {
            if (eq.section().getId().equals(target.section().getId()) && !eq.id().equals(questionId) && eq.maxMarks() != null) {
                remaining = remaining.add(eq.maxMarks());
            }
        }
        dto.setTotalMarks(remaining.doubleValue());
        AddQuestionsAssessmentDetailsDTO request = new AddQuestionsAssessmentDetailsDTO();
        request.getUpdatedSections().add(dto);
        linkManager.saveQuestionsToAssessment(ApiActorPrincipals.forKey(key), request, examId, key.getInstituteId(),
                EXAM_PLAY_MODE);
        Question question = target.question();
        question.setStatus(STATUS_DELETED);
        questionRepository.save(question);
        // Clear its rubric and model answer in the store too.
        ObjectNode clear = objectMapper.createObjectNode();
        clear.putNull("rubric");
        clear.putNull("model_answer");
        rubricSync.stage(examId, Map.of(questionId, clear));
        examStore.touch(examId);
        return true;
    }

    /** Labels of the exam's questions, for choice groups and open checks. */
    public Map<String, ExamQuestion> byLabel(String examId) {
        Map<String, ExamQuestion> out = new LinkedHashMap<>();
        load(examId).forEach(q -> out.put(q.label(), q));
        return out;
    }
}
