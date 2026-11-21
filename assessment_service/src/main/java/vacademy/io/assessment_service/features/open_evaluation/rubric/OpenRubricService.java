package vacademy.io.assessment_service.features.open_evaluation.rubric;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamValidator;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.QuestionMapper;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Rubrics and model answers (spec 7.4): {@code GET /exams/{id}/rubrics},
 * {@code PUT /exams/{id}/questions/{qid}/rubric}, {@code PATCH /exams/{id}/rubrics}.
 *
 * <p>The store is ai_service's {@code copy_check_rubric} (the only rubric the live engine
 * reads); writes go through its per-question PATCH (contract C4: missing key = leave alone,
 * null = delete, one version bump). Writes are validated here (marks add up, unique
 * criterion names, no mark figures in guidance), staged in the exam's outbox inside the
 * transaction, and pushed after commit by {@link RubricSyncService}. The model answer is
 * also kept on {@code question.auto_evaluation_json} (escaped), where typed grading reads
 * it as the reference answer.
 */
@Service
public class OpenRubricService {

    public static final String SYNC_PENDING = "pending";

    private final ApiExamStore examStore;
    private final OpenQuestionService questions;
    private final QuestionRepository questionRepository;
    private final RubricSyncService rubricSync;
    private final AiServiceCopyCheckClient client;
    private final ObjectMapper objectMapper;

    public OpenRubricService(ApiExamStore examStore, OpenQuestionService questions, QuestionRepository questionRepository,
            RubricSyncService rubricSync, AiServiceCopyCheckClient client, ObjectMapper objectMapper) {
        this.examStore = examStore;
        this.questions = questions;
        this.questionRepository = questionRepository;
        this.rubricSync = rubricSync;
        this.client = client;
        this.objectMapper = objectMapper;
    }

    // ------------------------------------------------------------------ GET

    /** {@code GET /exams/{id}/rubrics}: the store's view with not-yet-synced changes laid over it. */
    public Map<String, Object> list(ApiKeyPrincipal key, String examId) {
        ExamGuards.requireLive(examStore, key.getInstituteId(), examId, false);
        List<OpenQuestionService.ExamQuestion> examQuestions = questions.load(examId);
        JsonNode stored = readStore(examId, key.getInstituteId()).orElse(null);
        ObjectNode pending = rubricSync.pending(examId);
        JsonNode storedRubrics = stored == null ? objectMapper.createObjectNode() : stored.path("rubric");
        JsonNode storedAnswers = stored == null ? objectMapper.createObjectNode() : stored.path("model_answers");
        boolean locked = stored != null && stored.hasNonNull("locked_at");

        List<Map<String, Object>> rows = new ArrayList<>();
        for (OpenQuestionService.ExamQuestion eq : examQuestions) {
            String qid = eq.id();
            JsonNode change = pending.path(qid);
            JsonNode rubric = change.has("rubric") ? change.get("rubric") : storedRubrics.path(qid);
            JsonNode answer = change.has("model_answer") ? change.get("model_answer") : storedAnswers.path(qid);
            boolean hasRubric = rubric.isObject();
            boolean partner = "partner".equals(QuestionMapper.meta(eq.question()).path("rubric_source").asText(null));
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("question_id", qid);
            row.put("label", eq.label());
            row.put("source", !hasRubric ? "none" : partner ? "partner" : "generated");
            row.put("state", locked ? "final" : "draft");
            row.put("rubric", hasRubric ? RubricMapper.toPartner(objectMapper.convertValue(rubric, Map.class)) : null);
            row.put("model_answer", answer.isTextual() ? answer.asText() : null);
            row.put("updated_at", stored == null ? null : stored.path("updated_at").asText(null));
            rows.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", stored == null || !stored.path("rubric_version").isNumber() ? null
                : stored.get("rubric_version").asInt());
        out.put("locked", locked);
        out.put("locked_at", stored == null ? null : stored.path("locked_at").asText(null));
        if (!pending.isEmpty()) {
            out.put("sync", SYNC_PENDING);
        } else {
            rubricSync.syncError(examId).ifPresent(error -> {
                out.put("sync", RubricSyncService.SYNC_FAILED);
                out.put("sync_error", objectMapper.convertValue(error, Map.class));
            });
        }
        out.put("questions", rows);
        return out;
    }

    /** The store's rubric row, empty when none exists yet; 503 {@code engine_unavailable} when ai_service is down. */
    public Optional<JsonNode> readStore(String examId, String instituteId) {
        try {
            return client.fetchRubric(examId, instituteId);
        } catch (AiServiceCopyCheckClient.RubricStoreUnavailableException e) {
            throw new OpenApiException(HttpStatus.SERVICE_UNAVAILABLE, ApiErrorCode.ENGINE_UNAVAILABLE,
                    "The rubric store is not reachable right now. Retry shortly.", null, Map.of("Retry-After", "30"));
        }
    }

    // ------------------------------------------------------------------ writes

    /** What a write staged, for the response after the flush. */
    public record Staged(String examId, List<String> questionIds, Map<String, ExamViews.Question> views,
            List<ExamViews.Warning> warnings) {
    }

    /**
     * {@code PUT /exams/{id}/questions/{qid}/rubric} and {@code PATCH /exams/{id}/rubrics}:
     * validates and stages, in one transaction. The caller flushes after commit.
     *
     * @param changes question id → {@code {"rubric": {...}|null, "model_answer": "..."|null}}
     * @param ifMatch expected rubric version (If-Match), or null
     */
    @Transactional
    public Staged stage(ApiKeyPrincipal key, String examId, Map<String, JsonNode> changes, Integer ifMatch) {
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        if (changes == null || changes.isEmpty()) {
            throw OpenApiException.validation("questions", "required", "Send at least one question.");
        }
        if (changes.size() > ExamValidator.MAX_QUESTIONS) {
            throw OpenApiException.validation("questions", "too_many", "At most " + ExamValidator.MAX_QUESTIONS + " questions.");
        }
        if (ifMatch != null) {
            checkVersion(exam, ifMatch);
        }
        Map<String, OpenQuestionService.ExamQuestion> byId = new LinkedHashMap<>();
        questions.load(examId).forEach(q -> byId.put(q.id(), q));

        List<OpenApiException.FieldError> errors = new ArrayList<>();
        List<ExamViews.Warning> warnings = new ArrayList<>();
        Map<String, ObjectNode> staged = new LinkedHashMap<>();
        Map<String, ExamInputs.RubricInput> rubrics = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> e : changes.entrySet()) {
            String qid = e.getKey();
            String f = "questions." + qid;
            OpenQuestionService.ExamQuestion eq = byId.get(qid);
            if (eq == null) {
                throw new OpenApiException(HttpStatus.NOT_FOUND, ApiErrorCode.QUESTION_NOT_FOUND,
                        "No question with id " + qid + " in this exam.", Map.of("question_id", qid));
            }
            JsonNode body = e.getValue();
            if (body == null || !body.isObject() || (!body.has("rubric") && !body.has("model_answer"))) {
                errors.add(new OpenApiException.FieldError(f, "required", "Send rubric and/or model_answer."));
                continue;
            }
            if (!"LONG_ANSWER".equals(eq.question().getQuestionType())) {
                errors.add(new OpenApiException.FieldError(f, "not_allowed",
                        "Rubrics and model answers are only for long_answer questions."));
                continue;
            }
            ObjectNode change = objectMapper.createObjectNode();
            if (body.has("rubric")) {
                JsonNode r = body.get("rubric");
                if (r.isNull()) {
                    change.putNull("rubric");
                } else if (!r.isObject()) {
                    errors.add(new OpenApiException.FieldError(f + ".rubric", "invalid", "rubric must be an object or null."));
                } else {
                    try {
                        ExamInputs.RubricInput rubric = objectMapper.treeToValue(r, ExamInputs.RubricInput.class);
                        RubricRules.checkShape(rubric, f + ".rubric", errors);
                        rubrics.put(qid, rubric);
                    } catch (Exception ex) {
                        errors.add(new OpenApiException.FieldError(f + ".rubric", "invalid", "rubric does not match the rubric object."));
                    }
                }
            }
            if (body.has("model_answer")) {
                JsonNode m = body.get("model_answer");
                if (m.isNull()) {
                    change.putNull("model_answer");
                } else if (!m.isTextual() || m.asText().isBlank()) {
                    errors.add(new OpenApiException.FieldError(f + ".model_answer", "invalid",
                            "model_answer must be a non-empty string or null."));
                } else if (m.asText().length() > ExamValidator.MAX_MODEL_ANSWER) {
                    errors.add(new OpenApiException.FieldError(f + ".model_answer", "too_long",
                            "model_answer is at most " + ExamValidator.MAX_MODEL_ANSWER + " characters."));
                } else {
                    change.put("model_answer", m.asText().trim());
                }
            }
            staged.put(qid, change);
        }
        if (!errors.isEmpty()) {
            throw OpenApiException.validation(errors);
        }
        for (Map.Entry<String, ExamInputs.RubricInput> e : rubrics.entrySet()) {
            OpenQuestionService.ExamQuestion eq = byId.get(e.getKey());
            RubricRules.checkAgainstQuestion(e.getValue(), eq.maxMarks(), eq.label(), "questions." + e.getKey() + ".rubric",
                    warnings);
            staged.get(e.getKey()).set("rubric", objectMapper.valueToTree(RubricMapper.toEngine(e.getValue(), eq.maxMarks())));
        }

        Map<String, ExamViews.Question> views = new LinkedHashMap<>();
        for (Map.Entry<String, ObjectNode> e : staged.entrySet()) {
            OpenQuestionService.ExamQuestion eq = byId.get(e.getKey());
            Question question = eq.question();
            ObjectNode change = e.getValue();
            ObjectNode meta = QuestionMapper.meta(question);
            if (change.has("rubric")) {
                if (change.get("rubric").isNull()) {
                    meta.remove("rubric_source");
                } else {
                    meta.put("rubric_source", "partner");
                }
                question.setSourceMeta(meta.toString());
            }
            if (change.has("model_answer")) {
                question.setAutoEvaluationJson(QuestionMapper.withModelAnswer(question.getAutoEvaluationJson(),
                        change.get("model_answer").isNull() ? null : change.get("model_answer").asText()));
            }
            questionRepository.save(question);
            ExamViews.Question view = QuestionMapper.toView(question, eq.mapping().getMarkingJson(), true);
            view.setModelAnswer(QuestionMapper.modelAnswer(question));
            if (change.has("rubric") && !change.get("rubric").isNull()) {
                view.setRubric(RubricMapper.toPartner(objectMapper.convertValue(change.get("rubric"), Map.class)));
            }
            views.put(e.getKey(), view);
        }
        rubricSync.stage(examId, staged);
        return new Staged(examId, new ArrayList<>(staged.keySet()), views, warnings);
    }

    /**
     * {@code If-Match}: refuse before anything is written when the store's version differs,
     * or when earlier changes are still waiting to sync (the version is not known then).
     */
    private void checkVersion(ApiExamStore.ApiExamRow exam, int ifMatch) {
        if (rubricSync.hasPending(exam.assessmentId())) {
            throw new OpenApiException(HttpStatus.PRECONDITION_FAILED, ApiErrorCode.RUBRIC_VERSION_MISMATCH,
                    "Earlier rubric changes are still syncing, so the current version is not known yet. Retry shortly.",
                    Map.of("expected", ifMatch));
        }
        JsonNode stored = readStore(exam.assessmentId(), exam.instituteId()).orElse(null);
        int current = stored == null || !stored.path("rubric_version").isNumber() ? 0 : stored.get("rubric_version").asInt();
        if (current != ifMatch) {
            throw new OpenApiException(HttpStatus.PRECONDITION_FAILED, ApiErrorCode.RUBRIC_VERSION_MISMATCH,
                    "The rubric is at version " + current + ", not " + ifMatch + ". Re-read it and retry.",
                    Map.of("expected", ifMatch, "current", current));
        }
        if (stored != null && stored.hasNonNull("locked_at")) {
            throw rubricLocked(exam.assessmentId());
        }
    }

    static OpenApiException rubricLocked(String examId) {
        return OpenApiException.conflict(ApiErrorCode.RUBRIC_LOCKED,
                "The rubric of this exam is locked; unlock it before changing rubrics or model answers.",
                Map.of("exam_id", examId));
    }

    /**
     * Pushes staged changes and turns the outcome into the response fields: the new version,
     * or {@code sync: pending}; a permanent refusal by ai_service becomes 412/409.
     */
    public Map<String, Object> flushForResponse(String examId, Integer ifMatch) {
        RubricSyncService.FlushResult result = rubricSync.flush(examId, ifMatch);
        Map<String, Object> out = new LinkedHashMap<>();
        switch (result.outcome()) {
            case SYNCED -> out.put("version", result.version());
            case NOTHING -> out.put("version", null);
            case PENDING -> {
                out.put("version", null);
                out.put("sync", SYNC_PENDING);
            }
            case REJECTED -> throw rejected(examId, result);
            default -> {
            }
        }
        return out;
    }

    static OpenApiException rejected(String examId, RubricSyncService.FlushResult result) {
        if (result.status() == 412) {
            return new OpenApiException(HttpStatus.PRECONDITION_FAILED, ApiErrorCode.RUBRIC_VERSION_MISMATCH,
                    "The rubric changed meanwhile. Re-read it and retry.", Map.of("exam_id", examId));
        }
        if (result.status() == 409 && result.detail() != null && result.detail().toLowerCase().contains("lock")) {
            return rubricLocked(examId);
        }
        if (result.status() == 409) {
            return OpenApiException.conflict(ApiErrorCode.CONFLICT,
                    "The rubric store refused the change for this exam.", Map.of("exam_id", examId));
        }
        return new OpenApiException(HttpStatus.INTERNAL_SERVER_ERROR, ApiErrorCode.INTERNAL_ERROR,
                "The rubric store refused the change.");
    }

    /** Converts a {@code PATCH /exams/{id}/rubrics} body into question id → change. */
    public static Map<String, JsonNode> changesOf(JsonNode body) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        JsonNode questions = body == null ? null : body.get("questions");
        if (questions == null || !questions.isObject()) {
            throw OpenApiException.validation("questions", "required",
                    "questions must be an object of question id to {rubric, model_answer}.");
        }
        Iterator<Map.Entry<String, JsonNode>> it = questions.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            out.put(e.getKey(), e.getValue());
        }
        return out;
    }

    /** Parses an {@code If-Match} header ("5" or "\"5\""); 422 when it is not a version number. */
    public static Integer ifMatch(String header) {
        if (header == null || header.isBlank()) {
            return null;
        }
        String v = header.trim();
        if (v.startsWith("W/")) {
            v = v.substring(2);
        }
        v = v.replace("\"", "");
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            throw OpenApiException.validation("If-Match", "invalid", "If-Match must be a rubric version number.");
        }
    }
}
