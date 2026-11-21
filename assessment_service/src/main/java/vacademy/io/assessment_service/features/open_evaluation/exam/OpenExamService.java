package vacademy.io.assessment_service.features.open_evaluation.exam;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentSaveResponseDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.manager.AssessmentBasicDetailsManager;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.open_evaluation.auth.ApiActorPrincipals;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateService;
import vacademy.io.assessment_service.features.open_evaluation.candidate.ApiCandidateStore;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricRules;
import vacademy.io.assessment_service.features.open_evaluation.rubric.RubricSyncService;
import vacademy.io.assessment_service.features.open_evaluation.support.Paging;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;
import vacademy.io.assessment_service.features.question_core.enums.EvaluationTypes;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.PlainText;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Exams of the partner API (spec 7.1, T1.21): a thin facade over the dashboard's own
 * managers. An API exam is an ordinary assessment row ({@code source = 'API'},
 * {@code source_id = key id}) plus an {@code api_exam} row for the API-only fields, with
 * the settings of spec 5 "Exam settings the facade always writes":
 * <pre>
 * assessment_type ASSESSMENT · play_mode EXAM · evaluation_type MANUAL (handwritten) / AUTO (typed)
 * ai_evaluation_enabled true · result_type MANUAL · submission_type AUTO · visibility PRIVATE
 * can_switch_section / can_request_reattempt / can_request_time_increase false
 * instructions / about / registration_instructions: escaped text, "" allowed, never null
 * bound_start_time = conducted_on; bound_end_time = open time (exam sits in Previous)
 * duration_distribution ASSESSMENT · no creation / evaluation user ids on the institute mapping
 * </pre>
 * Workflow events ASSESSMENT_CREATE / _PUBLISHED are suppressed for API exams by the
 * publisher (unless the institute opted in), so nothing here fires them by hand.
 */
@Slf4j
@Service
public class OpenExamService {

    static final String EXAM_PLAY_MODE = "EXAM";
    static final String ASSESSMENT_TYPE = "ASSESSMENT";
    static final String DURATION_DISTRIBUTION = "ASSESSMENT";
    static final String STATUS_DELETED = "DELETED";
    static final int INLINE_CANDIDATE_LIMIT = 200;

    /** Labels that look like an internal choice: "33-OR", "11 OR 12", "(or)". */
    static final Pattern OR_LABEL = Pattern.compile("(?i)(-\\s*or\\b|\\sor\\s|\\(\\s*or\\s*\\)|\\bor$)");

    /** Exam fields PATCH accepts at any time before finalize (spec 7.1). */
    static final Set<String> PATCHABLE = Set.of("title", "external_ref", "conducted_on", "subject", "board", "class",
            "level", "instructions", "feedback_language");
    /** Exam fields PATCH accepts only while the exam is a draft. */
    static final Set<String> PATCHABLE_IN_DRAFT = Set.of("sections", "blind", "mode");
    /** Never editable through the API. */
    static final Set<String> NEVER_PATCHABLE = Set.of("result_type", "evaluation_type", "answer_language", "status");

    private final AssessmentBasicDetailsManager basicDetailsManager;
    private final AssessmentRepository assessmentRepository;
    private final SectionRepository sectionRepository;
    private final ApiExamStore store;
    private final OpenQuestionService questions;
    private final ApiCandidateService candidates;
    private final ApiCandidateStore candidateStore;
    private final ChoiceGroupService choiceGroups;
    private final RubricSyncService rubricSync;
    private final AiServiceCopyCheckClient aiClient;
    private final ObjectMapper objectMapper;
    private final String dashboardBaseUrl;
    private Clock clock = Clock.systemUTC();

    public OpenExamService(AssessmentBasicDetailsManager basicDetailsManager, AssessmentRepository assessmentRepository,
            SectionRepository sectionRepository, ApiExamStore store, OpenQuestionService questions,
            ApiCandidateService candidates, ApiCandidateStore candidateStore, ChoiceGroupService choiceGroups,
            RubricSyncService rubricSync, AiServiceCopyCheckClient aiClient, ObjectMapper objectMapper,
            @Value("${assessment.open-api.dashboard-base-url:https://dash.vacademy.io}") String dashboardBaseUrl) {
        this.basicDetailsManager = basicDetailsManager;
        this.assessmentRepository = assessmentRepository;
        this.sectionRepository = sectionRepository;
        this.store = store;
        this.questions = questions;
        this.candidates = candidates;
        this.candidateStore = candidateStore;
        this.choiceGroups = choiceGroups;
        this.rubricSync = rubricSync;
        this.aiClient = aiClient;
        this.objectMapper = objectMapper;
        this.dashboardBaseUrl = dashboardBaseUrl.replaceAll("/+$", "");
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** Activity log (T1.32); optional so tests that build this class by hand keep working. */
    private vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit audit;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setAudit(vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit audit) {
        this.audit = audit;
    }

    // ------------------------------------------------------------------ POST /exams

    /** What create did; the controller flushes rubrics and then renders the exam. */
    public record CreateResult(String examId, List<ExamViews.Warning> warnings, List<Map<String, Object>> candidates,
            boolean rubricStaged, int questionsWithRubric) {
    }

    @Transactional
    public CreateResult createExam(ApiKeyPrincipal key, ExamInputs.CreateExam req) {
        if (req != null && req.getChoiceGroups() != null && !req.getChoiceGroups().isEmpty()) {
            choiceGroups.requireEnabled();
        }
        ExamValidator.ValidatedExam v = ExamValidator.validateCreate(req, LocalDate.now(clock));
        String instituteId = key.getInstituteId();
        if (v.externalRef() != null) {
            store.findIdByExternalRef(instituteId, v.externalRef()).ifPresent(existing -> {
                throw examExists(existing);
            });
        }
        CustomUserDetails actor = ApiActorPrincipals.forKey(key);
        String escapedInstructions = v.instructions() == null ? "" : PlainText.escape(v.instructions());

        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setAssessmentType(ASSESSMENT_TYPE);
        dto.setTestCreation(new BasicAssessmentDetailsDTO.TestCreation(v.title(), null, escapedInstructions));
        dto.setSwitchSections(false);
        dto.setRaiseReattemptRequest(false);
        dto.setRaiseTimeIncreaseRequest(false);
        dto.setSubmissionType(EvaluationTypes.AUTO.name());
        dto.setEvaluationType(evaluationTypeFor(v.mode()));
        dto.setAiEvaluationEnabled(true);
        ResponseEntity<AssessmentSaveResponseDto> saved = basicDetailsManager.createApiAssessment(actor, dto, instituteId,
                EXAM_PLAY_MODE, key.getKeyId());
        String examId = saved.getBody().getAssessmentId();

        Assessment assessment = assessmentRepository.findById(examId)
                .orElseThrow(() -> new IllegalStateException("assessment vanished: " + examId));
        assessment.setDurationDistribution(DURATION_DISTRIBUTION);
        assessment.setAbout(emptyRichText());
        assessment.setRegistrationInstructions(emptyRichText());
        if (assessment.getInstructions() == null) {
            assessment.setInstructions(richText(escapedInstructions));
        }
        assessment.setBoundStartTime(startOfDay(v.conductedOn()));
        assessmentRepository.save(assessment);

        try {
            store.insert(examId, instituteId, key.getKeyId(), v, escapedInstructions);
        } catch (DuplicateKeyException race) {
            // Two creates with the same external_ref raced past the check above.
            throw examExists(null);
        }

        OpenQuestionService.Created created = questions.createQuestions(key, examId, v.questions(), v.sections());
        questions.ensureSections(examId, v.sections());
        Map<String, OpenQuestionService.ExamQuestion> byLabel = questions.byLabel(examId);
        choiceGroups.storeForCreate(examId, v.choiceGroups(), byLabel);

        ApiExamStore.ApiExamRow row = store.find(instituteId, examId)
                .orElseThrow(() -> new IllegalStateException("api_exam vanished: " + examId));
        List<Map<String, Object>> registered = List.of();
        if (!v.candidates().isEmpty()) {
            List<String> ids = new ArrayList<>();
            for (ExamInputs.CandidateInput c : v.candidates()) {
                ids.add(candidateStore.upsert(instituteId, key.getKeyId(), c).id());
            }
            List<ApiCandidateStore.CandidateRow> rows = orderBy(ids, candidateStore.findByIds(instituteId, ids));
            registered = candidates.registerRows(key, row, rows).candidates();
        }
        rubricSync.stage(examId, created.rubricChanges());

        List<ExamViews.Warning> warnings = new ArrayList<>(v.warnings());
        if (v.open()) {
            warnings.addAll(openChecked(key, row, false));
        }
        int withRubric = (int) v.questions().stream().filter(q -> q.rubric() != null).count();
        if (audit != null) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("exam_id", examId);
            payload.put("mode", v.mode());
            payload.put("questions", v.questions().size());
            payload.put("candidates", registered.size());
            payload.put("open", v.open());
            audit.record(key, vacademy.io.assessment_service.features.open_evaluation.audit.OpenApiAudit.ACTION_EXAM_CREATE,
                    examId, "Exam created through the API", payload);
        }
        return new CreateResult(examId, warnings, registered, !created.rubricChanges().isEmpty(), withRubric);
    }

    static OpenApiException examExists(String existingId) {
        Map<String, Object> details = new LinkedHashMap<>();
        if (existingId != null) {
            details.put("exam_id", existingId);
        }
        return OpenApiException.conflict(ApiErrorCode.EXAM_EXISTS,
                "An exam with this external_ref already exists.", details);
    }

    static String evaluationTypeFor(String mode) {
        return ExamValidator.MODE_TYPED.equals(mode) ? EvaluationTypes.AUTO.name() : EvaluationTypes.MANUAL.name();
    }

    static AssessmentRichTextData richText(String escaped) {
        return new AssessmentRichTextData(null, QuestionMapper.RICH_TEXT_TYPE, escaped == null ? "" : escaped);
    }

    static AssessmentRichTextData emptyRichText() {
        return richText("");
    }

    static Date startOfDay(LocalDate day) {
        return day == null ? null : Date.from(day.atStartOfDay(ZoneOffset.UTC).toInstant());
    }

    private static List<ApiCandidateStore.CandidateRow> orderBy(List<String> ids, List<ApiCandidateStore.CandidateRow> rows) {
        Map<String, ApiCandidateStore.CandidateRow> byId = new LinkedHashMap<>();
        rows.forEach(r -> byId.put(r.id(), r));
        List<ApiCandidateStore.CandidateRow> out = new ArrayList<>();
        new LinkedHashSet<>(ids).forEach(id -> {
            if (byId.containsKey(id)) {
                out.add(byId.get(id));
            }
        });
        return out;
    }

    // ------------------------------------------------------------------ POST /exams/{id}/open

    /** {@code POST /exams/{id}/open}: returns the warnings to show. */
    @Transactional
    public List<ExamViews.Warning> open(ApiKeyPrincipal key, String examId) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(store, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        if (exam.isOpen()) {
            // Idempotent: opening an open exam changes nothing.
            return choiceWarnings(examId);
        }
        return openChecked(key, exam, true);
    }

    /**
     * Runs the open checks and opens the exam: ≥ 1 question, every question has max marks,
     * every rubric adds up to its question's max (staged changes and, when asked, the store).
     * Then PUBLISHED, bound_start = conducted_on (never after now), bound_end = now.
     */
    List<ExamViews.Warning> openChecked(ApiKeyPrincipal key, ApiExamStore.ApiExamRow exam, boolean readStore) {
        String examId = exam.assessmentId();
        List<ExamViews.Warning> warnings = new ArrayList<>();
        List<OpenQuestionService.ExamQuestion> examQuestions = questions.load(examId);
        Map<String, Map<String, Object>> rubrics = new LinkedHashMap<>();
        if (readStore) {
            try {
                aiClient.fetchRubric(examId, key.getInstituteId()).ifPresent(stored -> {
                    JsonNode r = stored.path("rubric");
                    r.fieldNames().forEachRemaining(qid -> rubrics.put(qid, objectMapper.convertValue(r.get(qid), Map.class)));
                });
            } catch (AiServiceCopyCheckClient.RubricStoreUnavailableException e) {
                warnings.add(new ExamViews.Warning("rubric_check_skipped",
                        "The rubric store was not reachable, so stored rubrics were not re-checked against max marks.",
                        "rubrics"));
            }
        }
        ObjectNode pending = rubricSync.pending(examId);
        pending.fieldNames().forEachRemaining(qid -> {
            JsonNode change = pending.get(qid);
            if (change.has("rubric")) {
                if (change.get("rubric").isObject()) {
                    rubrics.put(qid, objectMapper.convertValue(change.get("rubric"), Map.class));
                } else {
                    rubrics.remove(qid);
                }
            }
        });
        List<Map<String, Object>> problems = openProblems(examQuestions, rubrics);
        if (!problems.isEmpty()) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.EXAM_NOT_READY,
                    "The exam cannot be opened yet; see details.problems.", Map.of("problems", problems));
        }
        CustomUserDetails actor = ApiActorPrincipals.forKey(key);
        basicDetailsManager.publishAssessment(actor, Map.of(), examId, key.getInstituteId(), EXAM_PLAY_MODE);
        Assessment assessment = assessmentRepository.findById(examId)
                .orElseThrow(() -> new IllegalStateException("assessment vanished: " + examId));
        Instant now = clock.instant();
        Date start = startOfDay(exam.conductedOn() == null ? LocalDate.now(clock) : exam.conductedOn());
        if (start.toInstant().isAfter(now)) {
            // A future conducted_on would put the exam in Upcoming as well as Previous.
            start = Date.from(now);
        }
        assessment.setBoundStartTime(start);
        assessment.setBoundEndTime(Date.from(now));
        assessmentRepository.save(assessment);
        store.markOpened(examId, now);
        warnings.addAll(choiceWarnings(examId));
        return warnings;
    }

    static List<Map<String, Object>> openProblems(List<OpenQuestionService.ExamQuestion> examQuestions,
            Map<String, Map<String, Object>> rubrics) {
        List<Map<String, Object>> problems = new ArrayList<>();
        if (examQuestions.isEmpty()) {
            problems.add(problem("no_questions", "The exam has no questions.", null, null));
        }
        for (OpenQuestionService.ExamQuestion eq : examQuestions) {
            BigDecimal max = eq.maxMarks();
            if (max == null || max.signum() <= 0) {
                problems.add(problem("max_marks_missing", "Question " + eq.label() + " has no max marks.", eq.id(), eq.label()));
                continue;
            }
            BigDecimal total = RubricRules.engineCriteriaTotal(rubrics.get(eq.id()));
            if (total != null && total.compareTo(max) != 0) {
                problems.add(problem("rubric_marks_mismatch", "Criteria for question " + eq.label() + " add up to "
                        + total.stripTrailingZeros().toPlainString() + ", question max is "
                        + max.stripTrailingZeros().toPlainString() + ".", eq.id(), eq.label()));
            }
        }
        return problems;
    }

    private static Map<String, Object> problem(String code, String message, String questionId, String label) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("code", code);
        p.put("message", message);
        if (questionId != null) {
            p.put("question_id", questionId);
            p.put("question_label", label);
        }
        return p;
    }

    /** Warnings for labels that look like an internal choice and no choice group covers. */
    List<ExamViews.Warning> choiceWarnings(String examId) {
        Set<String> grouped = new HashSet<>();
        if (choiceGroups.enabled()) {
            // Groups only count once the engine applies them; otherwise warn on every OR label.
            choiceGroups.list(examId).forEach(g -> grouped.addAll(g.questionIds()));
        }
        return orLabelWarnings(questions.load(examId), grouped);
    }

    static List<ExamViews.Warning> orLabelWarnings(List<OpenQuestionService.ExamQuestion> examQuestions,
            Set<String> groupedIds) {
        List<ExamViews.Warning> out = new ArrayList<>();
        for (OpenQuestionService.ExamQuestion eq : examQuestions) {
            if (OR_LABEL.matcher(eq.label()).find() && !groupedIds.contains(eq.id())) {
                out.add(new ExamViews.Warning("internal_choice_suspected",
                        "Question " + eq.label() + " looks like an internal choice but no choice group covers it; "
                                + "both alternatives will be added to the total.", "questions." + eq.id()));
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ DELETE /exams/{id}

    @Transactional
    public void delete(ApiKeyPrincipal key, String examId) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(store, key.getInstituteId(), examId, true);
        if (!exam.isDraft() && store.hasSubmissions(examId)) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_HAS_SUBMISSIONS,
                    "The exam has submissions and cannot be deleted.", Map.of("exam_id", examId));
        }
        Assessment assessment = assessmentRepository.findById(examId)
                .orElseThrow(ExamGuards::examNotFound);
        assessment.setStatus(STATUS_DELETED);
        assessmentRepository.save(assessment);
        store.releaseExternalRef(examId);
        store.touch(examId);
    }

    // ------------------------------------------------------------------ PATCH /exams/{id}

    @Transactional
    public List<ExamViews.Warning> patch(ApiKeyPrincipal key, String examId, ObjectNode body) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(store, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        if (body == null || body.isEmpty()) {
            throw OpenApiException.validation(null, "required", "Send at least one field to change.");
        }
        Set<String> fields = new LinkedHashSet<>();
        body.fieldNames().forEachRemaining(fields::add);
        for (String f : fields) {
            if (NEVER_PATCHABLE.contains(f)) {
                throw OpenApiException.validation(f, "not_editable", f + " cannot be changed through the API.");
            }
            if (!PATCHABLE.contains(f) && !PATCHABLE_IN_DRAFT.contains(f)) {
                // A typo must not look like a successful edit.
                throw OpenApiException.validation(f, "unknown_field", f + " is not an editable exam field.");
            }
        }
        if (!exam.isDraft()) {
            List<String> draftOnly = fields.stream().filter(PATCHABLE_IN_DRAFT::contains).toList();
            if (!draftOnly.isEmpty()) {
                throw OpenApiException.conflict(ApiErrorCode.EXAM_OPEN,
                        "The exam is open; sections, blind and mode can only change while it is a draft.",
                        Map.of("fields", draftOnly));
            }
        }
        List<OpenApiException.FieldError> errors = new ArrayList<>();
        List<ExamViews.Warning> warnings = new ArrayList<>();

        String title = exam.title();
        if (fields.contains("title")) {
            title = ExamValidator.requiredText(text(body, "title"), "title", ExamValidator.MAX_TITLE, errors);
            ExamValidator.noAngles(title, "title", errors);
        }
        String externalRef = fields.contains("external_ref")
                ? ExamValidator.optionalText(text(body, "external_ref"), "external_ref", ExamValidator.MAX_EXTERNAL_REF, errors)
                : exam.externalRef();
        LocalDate conductedOn = exam.conductedOn();
        if (fields.contains("conducted_on")) {
            conductedOn = ExamValidator.parseDate(text(body, "conducted_on"), "conducted_on", errors);
            if (conductedOn == null && errors.isEmpty()) {
                errors.add(new OpenApiException.FieldError("conducted_on", "required", "conducted_on cannot be cleared."));
            }
        }
        String subject = fields.contains("subject")
                ? ExamValidator.optionalText(text(body, "subject"), "subject", ExamValidator.MAX_SHORT, errors) : exam.subject();
        String board = fields.contains("board")
                ? ExamValidator.optionalText(text(body, "board"), "board", 64, errors) : exam.board();
        String className = fields.contains("class")
                ? ExamValidator.optionalText(text(body, "class"), "class", 32, errors) : exam.className();
        String level = exam.level();
        if (fields.contains("level")) {
            String l = ExamValidator.lower(text(body, "level"));
            level = l == null ? ExamValidator.DEFAULT_LEVEL : l;
            if (!ExamValidator.LEVELS.contains(level)) {
                errors.add(new OpenApiException.FieldError("level", "invalid", "level must be one of school, ug, pg, upsc."));
            }
        }
        String feedbackLanguage = fields.contains("feedback_language")
                ? ExamValidator.language(text(body, "feedback_language"), "feedback_language", errors)
                : exam.feedbackLanguage();
        String instructions = PlainText.unescape(exam.instructions());
        if (fields.contains("instructions")) {
            instructions = ExamValidator.optionalText(text(body, "instructions"), "instructions",
                    ExamValidator.MAX_INSTRUCTIONS, errors);
        }
        boolean blind = exam.blind();
        if (fields.contains("blind")) {
            if (body.get("blind").isBoolean()) {
                blind = body.get("blind").booleanValue();
            } else {
                errors.add(new OpenApiException.FieldError("blind", "invalid", "blind must be true or false."));
            }
        }
        String mode = exam.mode();
        if (fields.contains("mode")) {
            String m = ExamValidator.lower(text(body, "mode"));
            if (m == null || !ExamValidator.MODES.contains(m)) {
                errors.add(new OpenApiException.FieldError("mode", "invalid", "mode must be handwritten or typed."));
            } else {
                mode = m;
            }
        }
        List<ExamInputs.SectionInput> sections = null;
        if (fields.contains("sections")) {
            List<ExamInputs.SectionInput> raw = new ArrayList<>();
            JsonNode s = body.get("sections");
            if (s == null || !s.isArray() || s.isEmpty()) {
                errors.add(new OpenApiException.FieldError("sections", "required", "sections must be a non-empty list."));
            } else {
                s.forEach(n -> raw.add(objectMapper.convertValue(n, ExamInputs.SectionInput.class)));
                sections = ExamValidator.sections(raw, List.of(), errors);
            }
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        if (fields.contains("feedback_language")) {
            ExamValidator.checkLanguage(feedbackLanguage, "feedback_language");
        }
        if (externalRef != null && !externalRef.equals(exam.externalRef())) {
            Optional<String> other = store.findIdByExternalRef(key.getInstituteId(), externalRef);
            if (other.isPresent() && !other.get().equals(examId)) {
                throw examExists(other.get());
            }
        }

        Assessment assessment = assessmentRepository.findById(examId).orElseThrow(ExamGuards::examNotFound);
        String escapedInstructions = instructions == null ? "" : PlainText.escape(instructions);
        assessment.setName(title);
        if (assessment.getInstructions() == null) {
            assessment.setInstructions(richText(escapedInstructions));
        } else {
            assessment.getInstructions().setContent(escapedInstructions);
        }
        if (fields.contains("conducted_on")) {
            Date start = startOfDay(conductedOn);
            if (assessment.getBoundEndTime() != null && start.after(assessment.getBoundEndTime())) {
                start = assessment.getBoundEndTime();
            }
            assessment.setBoundStartTime(start);
        }
        if (!mode.equals(exam.mode())) {
            assessment.setEvaluationType(evaluationTypeFor(mode));
            if (ExamValidator.MODE_HANDWRITTEN.equals(mode) && zeroNegativeMarks(examId)) {
                warnings.add(new ExamViews.Warning("negative_marks_ignored",
                        "Negative marks are not applied to handwritten copies; they were set to 0.", "mode"));
            }
        }
        assessmentRepository.save(assessment);
        if (sections != null) {
            replaceSections(examId, sections);
        }
        try {
            store.updateDetails(examId, externalRef, mode, level, subject, board, className, feedbackLanguage,
                    escapedInstructions, conductedOn, blind);
        } catch (DuplicateKeyException race) {
            throw examExists(null);
        }
        return warnings;
    }

    private static String text(JsonNode body, String field) {
        JsonNode v = body.get(field);
        return v == null || v.isNull() ? null : v.isValueNode() ? v.asText() : v.toString();
    }

    /** Sets negative marks to 0 on every question; true when any was non-zero. */
    private boolean zeroNegativeMarks(String examId) {
        boolean changed = false;
        for (OpenQuestionService.ExamQuestion eq : questions.load(examId)) {
            if (QuestionMapper.negativeMark(eq.mapping().getMarkingJson()) != 0.0) {
                eq.mapping().setMarkingJson(QuestionMapper.withMarks(eq.mapping().getMarkingJson(),
                        eq.question().getQuestionType(), null, BigDecimal.ZERO));
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Draft-only section list replace: sections are matched by name; new names are created,
     * orders updated, and sections left out are removed if they hold no questions.
     */
    private void replaceSections(String examId, List<ExamInputs.SectionInput> sections) {
        Set<String> keep = new HashSet<>();
        sections.forEach(s -> keep.add(s.getName().toLowerCase(Locale.ROOT)));
        Set<String> used = new HashSet<>();
        questions.load(examId).forEach(q -> used.add(q.section().getName().toLowerCase(Locale.ROOT)));
        for (Map.Entry<String, Section> e : questions.sectionsByName(examId).entrySet()) {
            if (!keep.contains(e.getKey())) {
                if (used.contains(e.getKey())) {
                    throw OpenApiException.validation("sections", "section_not_empty",
                            "Section " + e.getValue().getName() + " still has questions; move or delete them first.");
                }
                e.getValue().setStatus(STATUS_DELETED);
                sectionRepository.save(e.getValue());
            }
        }
        questions.ensureSections(examId, sections);
    }

    // ------------------------------------------------------------------ reads

    /** What to add to an exam view. */
    public record Include(boolean questions, boolean candidates, boolean choiceGroups, boolean stats, boolean rubric) {
        public static Include parse(String include) {
            Set<String> parts = new HashSet<>();
            if (include != null) {
                for (String p : include.split(",")) {
                    if (!p.isBlank()) {
                        parts.add(p.trim().toLowerCase(Locale.ROOT));
                    }
                }
            }
            return new Include(parts.contains("questions"), parts.contains("candidates"),
                    parts.contains("choice_groups"), parts.contains("stats"), parts.contains("rubric"));
        }
    }

    /** {@code GET /exams/{id}} (deleted exams are returned with status {@code deleted}). */
    @Transactional(readOnly = true)
    public ExamViews.Exam get(ApiKeyPrincipal key, String examId, Include include) {
        ApiExamStore.ApiExamRow exam = store.find(key.getInstituteId(), examId).orElseThrow(ExamGuards::examNotFound);
        return view(key, exam, include);
    }

    /** The full view of one exam. */
    public ExamViews.Exam view(ApiKeyPrincipal key, ApiExamStore.ApiExamRow exam, Include include) {
        String examId = exam.assessmentId();
        List<OpenQuestionService.ExamQuestion> examQuestions = questions.load(examId);
        List<ChoiceGroupStore.ChoiceGroupRow> groups = choiceGroups.list(examId);
        ChoiceGroupService.Totals totals = ChoiceGroupService.totals(examQuestions, groups);
        ExamViews.Exam.ExamBuilder b = summaryBuilder(exam)
                .totalMarks(totals.totalMarks())
                .paperMax(totals.paperMax())
                .questionCount(examQuestions.size());
        if (include.questions()) {
            List<ExamViews.Question> qs = new ArrayList<>();
            examQuestions.forEach(eq -> qs.add(QuestionMapper.toView(eq.question(), eq.mapping().getMarkingJson(), false)));
            b.questions(qs);
        }
        if (include.choiceGroups()) {
            Map<String, OpenQuestionService.ExamQuestion> byLabel = new LinkedHashMap<>();
            examQuestions.forEach(q -> byLabel.put(q.label(), q));
            b.choiceGroups(ChoiceGroupService.views(groups, byLabel));
        }
        if (include.candidates()) {
            List<Map<String, Object>> rows = new ArrayList<>();
            candidateStore.examCandidates(examId, key.getInstituteId(), null, null, INLINE_CANDIDATE_LIMIT)
                    .forEach(r -> {
                        Map<String, Object> row = new LinkedHashMap<>();
                        row.put("id", r.candidate().id());
                        row.put("external_id", r.candidate().externalId());
                        row.put("registration_id", r.registrationId());
                        rows.add(row);
                    });
            b.candidates(rows);
        }
        if (include.stats()) {
            b.stats(store.stats(examId));
        }
        if (include.rubric()) {
            b.rubric(rubricSummary(key, exam, examQuestions));
        } else if (exam.rubricPending()) {
            b.rubric(ExamViews.RubricSummary.builder().sync("pending").build());
        }
        return b.build();
    }

    private ExamViews.RubricSummary rubricSummary(ApiKeyPrincipal key, ApiExamStore.ApiExamRow exam,
            List<OpenQuestionService.ExamQuestion> examQuestions) {
        Set<String> withRubric = new HashSet<>();
        Integer version = null;
        boolean locked = false;
        try {
            Optional<JsonNode> stored = aiClient.fetchRubric(exam.assessmentId(), key.getInstituteId());
            if (stored.isPresent()) {
                version = stored.get().path("rubric_version").isNumber() ? stored.get().get("rubric_version").asInt() : null;
                locked = stored.get().hasNonNull("locked_at");
                stored.get().path("rubric").fieldNames().forEachRemaining(withRubric::add);
            }
        } catch (AiServiceCopyCheckClient.RubricStoreUnavailableException e) {
            log.info("Rubric store unavailable for exam {}: {}", exam.assessmentId(), e.getMessage());
        }
        ObjectNode pending = rubricSync.pending(exam.assessmentId());
        pending.fieldNames().forEachRemaining(qid -> {
            JsonNode r = pending.get(qid).get("rubric");
            if (r != null && r.isObject()) {
                withRubric.add(qid);
            } else if (r != null) {
                withRubric.remove(qid);
            }
        });
        int count = (int) examQuestions.stream().filter(q -> withRubric.contains(q.id())).count();
        ExamViews.RubricSummary.RubricSummaryBuilder summary = ExamViews.RubricSummary.builder()
                .version(version)
                .locked(locked)
                .questionsWithRubric(count)
                .questionsWithoutRubric(examQuestions.size() - count);
        if (!pending.isEmpty()) {
            summary.sync("pending");
        } else {
            rubricSync.syncError(exam.assessmentId()).ifPresent(error -> summary
                    .sync(RubricSyncService.SYNC_FAILED)
                    .syncError(objectMapper.convertValue(error, Map.class)));
        }
        return summary.build();
    }

    /** Fields every exam view carries (list rows included). */
    ExamViews.Exam.ExamBuilder summaryBuilder(ApiExamStore.ApiExamRow exam) {
        return ExamViews.Exam.builder()
                .id(exam.assessmentId())
                .status(PublicStatus.exam(exam.assessmentStatus(), exam.isFinalized()))
                .mode(exam.mode())
                .title(exam.title())
                .externalRef(exam.externalRef())
                .conductedOn(exam.conductedOn() == null ? null : exam.conductedOn().toString())
                .subject(exam.subject())
                .level(exam.level())
                .board(exam.board())
                .className(exam.className())
                .answerLanguage(exam.answerLanguage())
                .feedbackLanguage(exam.feedbackLanguage())
                .instructions(exam.instructions() == null || exam.instructions().isEmpty() ? null
                        : PlainText.unescape(exam.instructions()))
                .blind(exam.blind())
                .dashboardUrl(dashboardUrl(exam.assessmentId()))
                .openedAt(iso(exam.openedAt()))
                .finalizedAt(iso(exam.finalizedAt()))
                .createdAt(iso(exam.createdAt()))
                .updatedAt(iso(exam.updatedAt()));
    }

    String dashboardUrl(String examId) {
        return dashboardBaseUrl + "/assessment/assessment-list/assessment-details/" + examId + "/EXAM/PRIVATE/overview";
    }

    static String iso(Instant at) {
        return at == null ? null : at.toString();
    }

    /** {@code GET /exams}: this institute's API exams, newest change last. */
    @Transactional(readOnly = true)
    public Paging.Page<ExamViews.Exam> list(ApiKeyPrincipal key, String status, String updatedSince, String cursor,
            Integer limit) {
        int size = Paging.limit(limit);
        Paging.Cursor after = Paging.decode(cursor);
        Instant since = Paging.updatedSince(updatedSince);
        List<String> statuses = null;
        Boolean finalized = null;
        if (status != null && !status.isBlank()) {
            switch (status.trim().toLowerCase(Locale.ROOT)) {
                case PublicStatus.EXAM_DRAFT -> statuses = List.of("DRAFT");
                case PublicStatus.EXAM_OPEN -> {
                    statuses = List.of("PUBLISHED");
                    finalized = false;
                }
                case PublicStatus.EXAM_FINALIZED -> {
                    statuses = List.of("PUBLISHED");
                    finalized = true;
                }
                case PublicStatus.EXAM_DELETED -> statuses = List.of(STATUS_DELETED);
                default -> throw OpenApiException.validation("status", "invalid",
                        "status must be one of draft, open, finalized, deleted.");
            }
        }
        List<ApiExamStore.ApiExamRow> rows = store.list(key.getInstituteId(), statuses, finalized, since, after, size + 1);
        Paging.Page<ApiExamStore.ApiExamRow> page = Paging.page(rows, size,
                r -> new Paging.Cursor(r.updatedAt(), r.assessmentId()));
        List<ExamViews.Exam> data = page.data().stream().map(r -> summaryBuilder(r).build()).toList();
        return new Paging.Page<>(data, page.nextCursor(), page.hasMore());
    }

    /** {@code POST /exams/search}: lookup by external_ref (in the body, never the URL). */
    @Transactional(readOnly = true)
    public List<ExamViews.Exam> search(ApiKeyPrincipal key, List<String> externalRefs) {
        if (externalRefs == null || externalRefs.isEmpty() || externalRefs.size() > 500) {
            throw OpenApiException.validation("external_refs", "out_of_range", "Send 1 to 500 external_refs.");
        }
        Set<String> refs = new LinkedHashSet<>();
        externalRefs.stream().filter(r -> r != null && !r.isBlank()).forEach(r -> refs.add(r.trim()));
        return store.findByExternalRefs(key.getInstituteId(), refs).stream()
                .filter(r -> !r.isDeleted())
                .map(r -> summaryBuilder(r).build()).toList();
    }

    /** The row behind an exam id of this institute (for the controller after a write). */
    @Transactional(readOnly = true)
    public ExamViews.Exam render(ApiKeyPrincipal key, String examId, Include include) {
        ApiExamStore.ApiExamRow exam = store.find(key.getInstituteId(), examId).orElseThrow(ExamGuards::examNotFound);
        return view(key, exam, include);
    }
}
