package vacademy.io.assessment_service.features.submission_review.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.entity.AiQuestionEvaluation;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.EvaluationLogs;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.EvaluationLogsRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.QuestionBasedStrategyFactory;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.question_core.util.CbeAnswers;
import vacademy.io.assessment_service.features.submission_review.entity.MarkEvent;
import vacademy.io.assessment_service.features.submission_review.model.MarkState;
import vacademy.io.assessment_service.features.submission_review.model.MarkingStatus;
import vacademy.io.assessment_service.features.submission_review.model.MarksSource;
import vacademy.io.assessment_service.features.submission_review.model.QuestionKinds;
import vacademy.io.assessment_service.features.submission_review.model.ResultStatusView;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionKind;
import vacademy.io.assessment_service.features.submission_review.model.SubmissionReviewException;
import vacademy.io.assessment_service.features.submission_review.repository.MarkEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The submission review API (contract 5): reads (A1, A1d, A2, A10, A11) and the thin
 * orchestration of the writes (A3-A9b) over MarkWriter and SubmissionReleaseService.
 * Responses are snake_case maps shaped exactly as the shared dashboard client expects.
 */
@Slf4j
@Service
public class SubmissionReviewService {

    private static final ObjectMapper JSON = new ObjectMapper();
    static final String SUMMARY_CACHE = "markingSummary";

    private final StudentAttemptRepository attemptRepository;
    private final QuestionWiseMarksRepository marksRepository;
    private final SubmissionReviewStore store;
    private final PaperOutline paperOutline;
    private final SubmissionSnapshots snapshots;
    private final MarkWriter markWriter;
    private final SubmissionReleaseService releaseService;
    private final SubmissionReviewAccess access;
    private final MarkEventRepository eventRepository;
    private final AiVerdictMirror mirror;
    private final UserNames userNames;

    @Autowired(required = false)
    private EvaluationLogsRepository evaluationLogsRepository;
    @Autowired(required = false)
    private AdminCoreServiceClient adminCoreServiceClient;
    @Autowired(required = false)
    private CacheManager cacheManager;
    @Autowired(required = false)
    private QuestionRepository questionRepository;
    @Autowired(required = false)
    private QuestionAssessmentSectionMappingRepository mappingRepository;
    @Autowired(required = false)
    private StudentAttemptService studentAttemptService;
    @Autowired(required = false)
    private AssessmentRepository assessmentRepository;

    public SubmissionReviewService(StudentAttemptRepository attemptRepository,
                                   QuestionWiseMarksRepository marksRepository, SubmissionReviewStore store,
                                   PaperOutline paperOutline, SubmissionSnapshots snapshots, MarkWriter markWriter,
                                   SubmissionReleaseService releaseService, SubmissionReviewAccess access,
                                   MarkEventRepository eventRepository, AiVerdictMirror mirror, UserNames userNames) {
        this.attemptRepository = attemptRepository;
        this.marksRepository = marksRepository;
        this.store = store;
        this.paperOutline = paperOutline;
        this.snapshots = snapshots;
        this.markWriter = markWriter;
        this.releaseService = releaseService;
        this.access = access;
        this.eventRepository = eventRepository;
        this.mirror = mirror;
        this.userNames = userNames;
    }

    /** Everything one response needs about an attempt, read once. */
    record Loaded(StudentAttempt attempt, Assessment assessment, SubmissionReviewStore.AttemptState state,
                  Review.Paper paper, List<Review.MarkRow> rows, Review.RunInfo run, SubmissionKind kind,
                  SubmissionSnapshots.Snapshot snapshot) {
    }

    Loaded load(StudentAttempt attempt) {
        SubmissionReviewStore.AttemptState state = store.attempt(attempt.getId());
        if (state == null) throw notFound();
        Assessment assessment = attempt.getRegistration().getAssessment();
        Review.Paper paper = paperOutline.get(assessment.getId());
        List<Review.MarkRow> rows = store.rows(List.of(attempt.getId()));
        Review.RunInfo run = store.runs(attempt.getId());
        SubmissionKind kind = SubmissionSnapshots.kind(state.status(), assessment, attempt.getAttemptData(),
                !rows.isEmpty());
        SubmissionSnapshots.Snapshot snap = snapshots.compute(SubmissionSnapshots.Facts.of(assessment, kind),
                state.released(), paper, rows, run, snapshots.groups(assessment.getId()));
        return new Loaded(attempt, assessment, state, paper, rows, run, kind, snap);
    }

    // ------------------------------------------------------------------ A1

    public Map<String, Object> outline(CustomUserDetails user, StudentAttempt attempt) {
        access.requireRead(user, attempt);
        Loaded l = load(attempt);
        Map<String, Object> out = new LinkedHashMap<>();
        AssessmentUserRegistration reg = attempt.getRegistration();
        out.put("attempt_id", attempt.getId());
        out.put("assessment_id", l.assessment().getId());
        out.put("assessment_name", l.assessment().getName());
        out.put("institute_id", reg.getInstituteId());
        out.put("kind", l.kind().name());
        out.put("evaluation_type", l.assessment().getEvaluationType());
        out.put("result_type", l.assessment().getResultType());
        Map<String, Object> learner = new LinkedHashMap<>();
        learner.put("user_id", reg.getUserId());
        learner.put("name", reg.getParticipantName());
        learner.put("username", reg.getUsername());
        learner.put("email", reg.getUserEmail());
        out.put("learner", learner);
        out.put("attempt_number", attempt.getAttemptNumber());
        int attemptsTotal = 1;
        try {
            attemptsTotal = Math.max(1, reg.getStudentAttempts() == null ? 1 : reg.getStudentAttempts().size());
        } catch (Exception ignored) {
            // lazy collection outside a session: one is the honest minimum
        }
        out.put("attempts_total", attemptsTotal);
        out.put("submitted_at", iso(attempt.getSubmitTime()));
        out.put("status", l.state().status());
        out.put("result_status", l.state().resultStatus());
        boolean totalOnly = l.rows().isEmpty() && l.state().totalMarks() != null;
        out.put("marking", SubmissionSnapshots.marking(l.state().status(), !l.rows().isEmpty(), l.state().totalMarks(),
                l.snapshot().counts()).name());
        out.put("total", totalOnly ? l.state().totalMarks() : l.snapshot().total());
        out.put("max_total", l.snapshot().maxTotal());
        out.put("stored_total", l.state().totalMarks());
        out.put("total_only", totalOnly);
        out.put("response_file_id", fileIdOf(attempt.getAttemptData()));
        out.put("evaluated_file_id", attempt.getEvaluatedFileId());
        out.put("release", release(l.state(), l.snapshot()));
        out.put("counts", counts(l.snapshot().counts()));
        out.put("ai_run", aiRun(l.run()));
        SubmissionReviewAccess.Permissions p = access.permissions(user, attempt, l.state().released());
        Map<String, Object> perms = new LinkedHashMap<>();
        perms.put("can_edit", p.canEdit());
        perms.put("can_edit_after_release", p.canEditAfterRelease());
        perms.put("can_release", p.canRelease());
        perms.put("can_force_answer_key", p.canForceAnswerKey());
        out.put("permissions", perms);
        RowContext rc = rowContext(l);
        List<Map<String, Object>> sections = new ArrayList<>();
        Map<String, List<SubmissionSnapshots.KeyState>> bySection = new LinkedHashMap<>();
        for (SubmissionSnapshots.KeyState k : l.snapshot().keys()) {
            bySection.computeIfAbsent(k.key().sectionId(), s -> new ArrayList<>()).add(k);
        }
        for (var e : bySection.entrySet()) {
            Map<String, Object> s = new LinkedHashMap<>();
            Review.PaperKey first = e.getValue().get(0).key();
            s.put("section_id", e.getKey());
            s.put("name", first.sectionName());
            s.put("order", first.sectionOrder());
            double total = 0;
            double max = 0;
            boolean anyMax = false;
            List<Map<String, Object>> questions = new ArrayList<>();
            for (SubmissionSnapshots.KeyState k : e.getValue()) {
                if (k.counted()) total += k.marks();
                if (k.max() != null) {
                    max += k.max();
                    anyMax = true;
                }
                questions.add(questionRow(k, rc));
            }
            s.put("total", QuestionMaxResolver.round2(total));
            s.put("max", anyMax ? QuestionMaxResolver.round2(max) : null);
            s.put("questions", questions);
            sections.add(s);
        }
        out.put("sections", sections);
        return out;
    }

    /** Names, history counts and section positions for building QuestionRows. */
    record RowContext(Map<String, String> names, Map<String, long[]> history, Map<String, Integer> positions,
                      boolean released) {
    }

    RowContext rowContext(Loaded l) {
        Set<String> ids = new HashSet<>();
        for (SubmissionSnapshots.KeyState k : l.snapshot().keys()) {
            if (k.row() != null && k.row().markedBy() != null) ids.add(k.row().markedBy());
        }
        Map<String, String> names = userNames.names(ids);
        Map<String, long[]> history = new HashMap<>();
        Date since = l.state().released() && l.state().reportLastReleaseDate() != null
                ? l.state().reportLastReleaseDate() : new Date(0);
        try {
            for (MarkEventRepository.KeyEventCount c : eventRepository.countPerKey(l.attempt().getId(), since)) {
                history.put(Review.key(c.getSectionId(), c.getQuestionId()),
                        new long[]{c.getEventCount() == null ? 0 : c.getEventCount(),
                                Boolean.TRUE.equals(c.getChangedAfterRelease()) ? 1 : 0});
            }
        } catch (Exception e) {
            log.warn("[submission-review] history counts unavailable for {}: {}", l.attempt().getId(), e.getMessage());
        }
        Map<String, Integer> positions = new HashMap<>();
        Map<String, Integer> perSection = new HashMap<>();
        for (Review.PaperKey k : l.paper().keys()) {
            int n = perSection.merge(k.sectionId(), 1, Integer::sum);
            positions.put(k.key(), n);
        }
        return new RowContext(names, history, positions, l.state().released());
    }

    Map<String, Object> questionRow(SubmissionSnapshots.KeyState k, RowContext rc) {
        Map<String, Object> q = new LinkedHashMap<>();
        Review.PaperKey key = k.key();
        Review.MarkRow row = k.row();
        q.put("key", key.key());
        q.put("section_id", key.sectionId());
        q.put("question_id", key.questionId());
        q.put("question_order", rc.positions().getOrDefault(key.key(), key.questionOrder()));
        q.put("question_number", key.questionNumber());
        q.put("question_type", key.questionType());
        q.put("marks", QuestionMaxResolver.round2(k.marks()));
        q.put("max_marks", k.max());
        q.put("min_marks", k.min());
        q.put("state", k.state().name());
        q.put("state_stored", k.derived().stored());
        q.put("marks_source", row == null ? null : MarksSource.canonical(row.marksSource()));
        q.put("marked_by_kind", k.derived().markedBy().name());
        if (row != null && row.markedBy() != null) {
            Map<String, Object> by = new LinkedHashMap<>();
            by.put("user_id", row.markedBy());
            by.put("name", rc.names().get(row.markedBy()));
            q.put("marked_by", by);
        } else {
            q.put("marked_by", null);
        }
        q.put("marked_at", row == null ? null : iso(row.markedAt()));
        q.put("revision", row == null ? 0 : row.revision());
        q.put("has_feedback", row != null && row.hasFeedback());
        q.put("ai_checking", k.aiChecking());
        q.put("ai_failed_reason", k.aiFailedReason());
        q.put("counted", k.counted());
        q.put("answer_pages", row == null ? null : row.answerPages());
        long[] h = rc.history().get(key.key());
        q.put("changed_after_release", rc.released() && h != null && h[1] > 0);
        q.put("history_count", h == null ? 0 : h[0]);
        return q;
    }

    Map<String, Object> release(SubmissionReviewStore.AttemptState st, SubmissionSnapshots.Snapshot snap) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("status", st.released() ? "RELEASED" : "NOT_RELEASED");
        r.put("released_at", st.released() ? iso(st.reportLastReleaseDate()) : null);
        r.put("token", st.token());
        r.put("changed_since_release", st.changedSinceRelease());
        r.put("unmarked_at_release", st.released() && snap != null ? snap.needsIncludingChecking() : 0);
        r.put("result_revised_at", iso(st.resultRevisedAt()));
        r.put("marks_revision", st.marksRevision());
        r.put("notified_revision", st.notifiedRevision());
        r.put("release_when_marked", st.releaseWhenMarked());
        return r;
    }

    static Map<String, Object> counts(SubmissionSnapshots.Counts c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("not_answered", c.notAnswered());
        m.put("needs_marking", c.needsMarking());
        m.put("ai_draft", c.aiDraft());
        m.put("marked", c.marked());
        m.put("ai_checking", c.aiChecking());
        m.put("ai_failed", c.aiFailed());
        m.put("not_counted", c.notCounted());
        return m;
    }

    static Map<String, Object> aiRun(Review.RunInfo run) {
        if (run == null || run.newest() == null) return null;
        Review.ProcessInfo p = run.newest();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("process_id", p.id());
        m.put("status", p.status());
        m.put("lane", p.lane());
        m.put("questions_completed", p.questionsCompleted());
        m.put("questions_total", p.questionsTotal());
        m.put("started_at", iso(p.startedAt()));
        m.put("error_message", p.errorMessage());
        return m;
    }

    // ------------------------------------------------------------------ A1d

    public Map<String, Object> question(CustomUserDetails user, StudentAttempt attempt, String sectionId,
                                        String questionId) {
        access.requireRead(user, attempt);
        Loaded l = load(attempt);
        SubmissionSnapshots.KeyState k = l.snapshot().find(sectionId, questionId);
        if (k == null) {
            throw SubmissionReviewException.unprocessable("NOT_IN_PAPER", "This question is not on the paper",
                    Map.of("key", Review.key(sectionId, questionId)));
        }
        QuestionWiseMarks entity = k.row() == null || k.row().id() == null ? null
                : marksRepository.findById(k.row().id()).orElse(null);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("row", questionRow(k, rowContext(l)));
        String response = entity != null ? entity.getResponseJson() : null;
        if (response == null && studentAttemptService != null && attempt.getAttemptData() != null) {
            String fromAttempt = studentAttemptService.getQuestionDetails(questionId, attempt.getAttemptData());
            response = "{}".equals(fromAttempt) ? null : fromAttempt;
        }
        out.put("response_json", response);
        out.put("auto_evaluation_json", k.key().autoEvaluationJson());
        out.put("answer", answer(k.key(), response, l.kind()));
        out.put("evaluator_feedback", entity == null ? null : entity.getEvaluatorFeedback());
        out.put("part_marks", partMarks(entity == null ? null : entity.getPartMarksJson()));
        Map<String, Object> ai = ai(attempt.getId(), questionId, entity, k);
        out.put("scheme_points", schemePoints(k.key(), ai));
        out.put("ai", ai);
        out.put("suggestion", null);
        out.put("released_value", null);
        return out;
    }

    static Map<String, Object> answer(Review.PaperKey key, String responseJson, SubmissionKind kind) {
        Map<String, Object> a = new LinkedHashMap<>();
        String type = key.questionType() == null ? "" : key.questionType().toUpperCase();
        JsonNode resp = readTree(responseJson).path("responseData");
        JsonNode correct = readTree(key.autoEvaluationJson()).path("data");
        List<String> chosen = new ArrayList<>();
        List<String> right = new ArrayList<>();
        String text = null;
        String correctText = null;
        Map<String, Object> code = new LinkedHashMap<>();
        code.put("language", null);
        code.put("source", null);
        code.put("verdict", null);
        String answerKind;
        if (kind == SubmissionKind.HANDWRITTEN || kind == SubmissionKind.SCANNED) {
            answerKind = "HANDWRITTEN";
        } else if (QuestionKinds.isCbe(type)) {
            answerKind = "CBE";
        } else if (type.equals("MCQS") || type.equals("MCQM") || type.equals("TRUE_FALSE")) {
            answerKind = "OPTIONS";
            resp.path("optionIds").forEach(n -> chosen.add(n.asText()));
            correct.path("correctOptionIds").forEach(n -> right.add(n.asText()));
        } else if (type.equals("NUMERIC")) {
            answerKind = "NUMERIC";
            JsonNode v = resp.path("validAnswer");
            text = v.isMissingNode() || v.isNull() ? null : v.asText();
            List<String> valid = new ArrayList<>();
            correct.path("validAnswers").forEach(n -> valid.add(n.asText()));
            correctText = valid.isEmpty() ? null : String.join(", ", valid);
        } else if (type.equals("CODING")) {
            answerKind = "CODE";
            code.put("language", textOf(resp.path("language")));
            code.put("source", textOf(resp.path("sourceCode")));
            code.put("verdict", textOf(resp.path("verdict")));
        } else if (type.equals("ONE_WORD") || QuestionKinds.isLongAnswer(type)) {
            answerKind = "TEXT";
            text = textOf(resp.path("answer"));
            correctText = keyText(correct);
        } else {
            answerKind = responseJson == null ? "NONE" : "TEXT";
            text = textOf(resp.path("answer"));
        }
        if (responseJson == null && !"HANDWRITTEN".equals(answerKind)) answerKind = "NONE";
        a.put("kind", answerKind);
        a.put("chosen_option_ids", chosen);
        a.put("correct_option_ids", right);
        a.put("text", text);
        a.put("correct_text", correctText);
        a.put("code", code);
        return a;
    }

    private Map<String, Object> ai(String attemptId, String questionId, QuestionWiseMarks entity,
                                   SubmissionSnapshots.KeyState k) {
        AiQuestionEvaluation verdict = null;
        String processId = null;
        try {
            if (entity != null && entity.getAiQuestionEvaluationId() != null) {
                verdict = mirror.verdictById(entity.getAiQuestionEvaluationId()).orElse(null);
            }
            if (verdict == null) {
                processId = mirror.newestTerminalProcess(attemptId).map(p -> p.getId()).orElse(null);
                verdict = mirror.verdict(processId, questionId).orElse(null);
            }
        } catch (Exception e) {
            log.warn("[submission-review] AI verdict unavailable for {}/{}: {}", attemptId, questionId, e.getMessage());
        }
        Map<String, Object> m = new LinkedHashMap<>();
        if (verdict != null) {
            JsonNode result = readTree(verdict.getEvaluationResultJson());
            m.put("process_id", verdict.getEvaluationProcess() != null ? verdict.getEvaluationProcess().getId()
                    : processId);
            m.put("ai_question_evaluation_id", verdict.getId());
            m.put("status", verdict.getStatus());
            m.put("marks_awarded", verdict.getMarksAwarded() == null ? null : verdict.getMarksAwarded().doubleValue());
            m.put("max_marks", verdict.getMaxMarks() == null ? null : verdict.getMaxMarks().doubleValue());
            m.put("feedback", verdict.getFeedback());
            m.put("extracted_answer", verdict.getExtractedAnswer());
            m.put("criteria_breakdown", criteria(result.path("criteria_breakdown")));
            m.put("rubric_version", verdict.getRubricVersion());
            m.put("is_edited", Boolean.TRUE.equals(verdict.getIsEdited()));
            m.put("edited_by", verdict.getEditedBy());
            m.put("edited_at", iso(verdict.getEditedAt()));
            m.put("page_ids", pageIds(result));
            m.put("review_reasons", reviewReasons(result));
            Double aiMarks = aiOriginalMarks(result, verdict);
            m.put("teacher_changed_total", k.row() != null && aiMarks != null
                    && Math.abs(aiMarks - k.row().marks()) > 0.005);
            return m;
        }
        String legacy = entity == null ? null : entity.getAiEvaluationDetailsJson();
        if (legacy == null || legacy.isBlank()) return null;
        JsonNode result = readTree(legacy);
        m.put("process_id", null);
        m.put("ai_question_evaluation_id", null);
        m.put("status", textOf(result.path("status")));
        m.put("marks_awarded", numberOf(result.path("marks_awarded")));
        m.put("max_marks", numberOf(result.path("max_marks")));
        m.put("feedback", textOf(result.path("feedback")));
        m.put("extracted_answer", textOf(result.path("extracted_answer")));
        m.put("criteria_breakdown", criteria(result.path("criteria_breakdown")));
        m.put("rubric_version", result.path("rubric_version").isNumber() ? result.path("rubric_version").asInt() : null);
        m.put("is_edited", false);
        m.put("edited_by", null);
        m.put("edited_at", null);
        m.put("page_ids", pageIds(result));
        m.put("review_reasons", reviewReasons(result));
        Double aiMarks = numberOf(result.path("marks_awarded"));
        m.put("teacher_changed_total", k.row() != null && aiMarks != null && Math.abs(aiMarks - k.row().marks()) > 0.005);
        return m;
    }

    /** The AI's own mark: the callback payload kept on the verdict, before any teacher edit. */
    private static Double aiOriginalMarks(JsonNode result, AiQuestionEvaluation verdict) {
        Double fromPayload = numberOf(result.path("marks_awarded"));
        if (fromPayload != null) return fromPayload;
        return verdict.getMarksAwarded() == null ? null : verdict.getMarksAwarded().doubleValue();
    }

    private static List<Map<String, Object>> criteria(JsonNode list) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (list == null || !list.isArray()) return out;
        for (JsonNode c : list) {
            Map<String, Object> m = new LinkedHashMap<>();
            String name = textOf(c.path("criteria_name"));
            if (name == null) name = textOf(c.path("name"));
            if (name == null) name = textOf(c.path("criterion"));
            m.put("criteria_name", name);
            Double marks = numberOf(c.path("marks"));
            if (marks == null) marks = numberOf(c.path("marks_awarded"));
            m.put("marks", marks);
            // The copy check stores a line's ceiling as "max" (ai_service attach_criteria_max).
            Double max = numberOf(c.path("max_marks"));
            if (max == null) max = numberOf(c.path("max"));
            m.put("max_marks", max);
            m.put("reason", textOf(c.path("reason")));
            out.add(m);
        }
        return out;
    }

    /**
     * Why the AI check wants a teacher to look at this answer (ai_service copy_check/review.py):
     * handwriting it was unsure of, marks cut on a page that was hard to read. Stored with the
     * question's callback payload; empty for older results.
     */
    static List<String> reviewReasons(JsonNode result) {
        List<String> out = new ArrayList<>();
        if (result == null) return out;
        for (JsonNode r : result.path("review_reasons")) {
            String text = textOf(r);
            if (text != null && !text.isBlank()) out.add(text);
        }
        return out;
    }

    private static List<String> pageIds(JsonNode result) {
        Set<String> out = new java.util.LinkedHashSet<>();
        for (JsonNode a : result.path("annotations")) {
            String p = textOf(a.path("page_id"));
            if (p == null) p = textOf(a.path("page"));
            if (p != null) out.add(p);
        }
        return new ArrayList<>(out);
    }

    private static List<Map<String, Object>> schemePoints(Review.PaperKey key, Map<String, Object> ai) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (QuestionKinds.isCbe(key.questionType())) {
            JsonNode data = CbeAnswers.configData(key.autoEvaluationJson());
            int n = 0;
            if (data != null) {
                for (JsonNode p : data.path("parts")) {
                    n++;
                    Map<String, Object> m = new LinkedHashMap<>();
                    String label = textOf(p.path("label"));
                    m.put("name", label == null || label.isBlank() ? "Part " + n : label);
                    m.put("max", numberOf(p.path("marks")));
                    m.put("source", "CBE");
                    out.add(m);
                }
            }
            if (!out.isEmpty()) return out;
        }
        if (ai != null && ai.get("criteria_breakdown") instanceof List<?> list) {
            for (Object o : list) {
                if (o instanceof Map<?, ?> c) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", c.get("criteria_name"));
                    m.put("max", c.get("max_marks"));
                    m.put("source", "AI_BREAKDOWN");
                    out.add(m);
                }
            }
        }
        return out;
    }

    private static List<Map<String, Object>> partMarks(String json) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonNode p : readTree(json)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("criterion", textOf(p.path("criterion")));
            m.put("marks", numberOf(p.path("marks")));
            m.put("max", numberOf(p.path("max")));
            out.add(m);
        }
        return out;
    }

    // ------------------------------------------------------------------ A2

    public Map<String, Object> history(CustomUserDetails user, StudentAttempt attempt, String sectionId,
                                       String questionId, int limit) {
        access.requireRead(user, attempt);
        int lim = Math.max(1, Math.min(limit <= 0 ? 100 : limit, 500));
        List<MarkEvent> events = sectionId != null && questionId != null
                ? eventRepository.findQuestionHistory(attempt.getId(), sectionId, questionId, lim)
                : eventRepository.findByAttemptIdOrderByCreatedAtDesc(attempt.getId(), PageRequest.of(0, lim));
        List<EvaluationLogs> logs = sectionId == null && evaluationLogsRepository != null
                ? evaluationLogsRepository.findAllBySourceIdOrderByDateAndTimeDesc(attempt.getId()) : List.of();
        Set<String> ids = new HashSet<>();
        events.forEach(e -> {
            if (e.getActorUserId() != null) ids.add(e.getActorUserId());
        });
        logs.forEach(g -> {
            if (g.getAuthorId() != null) ids.add(g.getAuthorId());
        });
        Map<String, String> names = userNames.names(ids);
        List<Map<String, Object>> outEvents = new ArrayList<>();
        for (MarkEvent e : events) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.getId());
            m.put("created_at", iso(e.getCreatedAt()));
            m.put("event_type", e.getEventType());
            m.put("section_id", e.getSectionId());
            m.put("question_id", e.getQuestionId());
            m.put("old_marks", e.getOldMarks());
            m.put("new_marks", e.getNewMarks());
            m.put("max_marks", e.getMaxMarks());
            m.put("old_source", MarksSource.canonical(e.getOldSource()));
            m.put("new_source", MarksSource.canonical(e.getNewSource()));
            m.put("old_state", e.getOldState());
            m.put("new_state", e.getNewState());
            m.put("old_feedback", e.getOldFeedback());
            m.put("new_feedback", e.getNewFeedback());
            m.put("reason", e.getReason());
            m.put("actor_type", e.getActorType());
            m.put("actor", person(e.getActorUserId(), names));
            m.put("after_release", e.isAfterRelease());
            m.put("payload", e.getPayloadJson() == null ? null : JSON.convertValue(readTree(e.getPayloadJson()), Map.class));
            outEvents.add(m);
        }
        List<Map<String, Object>> legacy = new ArrayList<>();
        for (EvaluationLogs g : logs) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("author", person(g.getAuthorId(), names));
            m.put("created_at", iso(g.getDateAndTime() != null ? g.getDateAndTime() : g.getCreatedAt()));
            m.put("type", g.getType());
            legacy.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("events", outEvents);
        out.put("legacy_logs", legacy);
        return out;
    }

    private static Map<String, Object> person(String id, Map<String, String> names) {
        if (id == null) return null;
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("user_id", id);
        p.put("name", names.get(id));
        return p;
    }

    // ------------------------------------------------------------------ A3 / A3b / A4 / A6

    /** A3: one answer. Preview computes the same result without writing. */
    public Map<String, Object> editOne(CustomUserDetails user, StudentAttempt attempt, MarkWriter.MarkChange change,
                                       boolean preview) {
        SubmissionReviewStore.AttemptState st = store.attempt(attempt.getId());
        access.requireEdit(user, attempt, st != null && st.released());
        MarkWriter.MarkResult r;
        try {
            r = preview ? markWriter.preview(change) : markWriter.apply(change);
        } catch (SubmissionReviewException e) {
            if ("STALE_REVISION".equals(e.getCode())) {
                Loaded l = load(attempt);
                SubmissionSnapshots.KeyState k = l.snapshot().find(change.sectionId(), change.questionId());
                Map<String, Object> details = new LinkedHashMap<>();
                details.put("current", k == null ? null : questionRow(k, rowContext(l)));
                throw SubmissionReviewException.conflict("STALE_REVISION", e.getMessage(), details);
            }
            throw withFullRelease(e, attempt);
        }
        return editResponse(attempt, r, preview, change.sectionId(), change.questionId());
    }

    private Map<String, Object> editResponse(StudentAttempt attempt, MarkWriter.MarkResult r, boolean preview,
                                             String sectionId, String questionId) {
        if (!preview) evictSummary(attempt);
        Loaded l = preview ? null : load(attempt);
        SubmissionSnapshots.Snapshot snap = preview ? r.after() : l.snapshot();
        SubmissionReviewStore.AttemptState st = preview ? r.attemptBefore() : l.state();
        RowContext rc = preview ? new RowContext(userNames.names(List.of()), Map.of(), positions(r.after()),
                st.released()) : rowContext(l);
        Map<String, Object> out = new LinkedHashMap<>();
        if (sectionId != null) {
            SubmissionSnapshots.KeyState k = snap.find(sectionId, questionId);
            out.put("row", k == null ? null : questionRow(k, rc));
        } else {
            List<Map<String, Object>> rows = new ArrayList<>();
            for (MarkWriter.RowResult rr : r.rows()) {
                SubmissionSnapshots.KeyState k = snap.find(rr.sectionId(), rr.questionId());
                if (k != null) rows.add(questionRow(k, rc));
            }
            out.put("rows", rows);
            out.put("changed", r.changed());
        }
        out.put("total_before", r.totalBefore());
        out.put("total_after", r.totalAfter());
        out.put("max_total", r.maxTotal());
        out.put("total_recomputed", r.totalRecomputed() == null ? null : Map.of(
                "stored_total", r.totalRecomputed().storedTotal(), "r6_before", r.totalRecomputed().r6Before()));
        out.put("release", release(st, snap));
        out.put("update_queued", r.updateQueued());
        if (sectionId != null) out.put("preview", preview);
        return out;
    }

    private static Map<String, Integer> positions(SubmissionSnapshots.Snapshot snap) {
        Map<String, Integer> positions = new HashMap<>();
        Map<String, Integer> perSection = new HashMap<>();
        for (SubmissionSnapshots.KeyState k : snap.keys()) {
            positions.put(k.key().key(), perSection.merge(k.key().sectionId(), 1, Integer::sum));
        }
        return positions;
    }

    /** A3b: Quick marks - many answers, one transaction. */
    public Map<String, Object> editMany(CustomUserDetails user, StudentAttempt attempt, List<MarkWriter.MarkChange> items,
                                        MarkWriter.BatchContext ctx) {
        if (items.size() > 500) {
            throw SubmissionReviewException.unprocessable("TOO_MANY", "At most 500 answers at once", null);
        }
        SubmissionReviewStore.AttemptState st = store.attempt(attempt.getId());
        access.requireEdit(user, attempt, st != null && st.released());
        MarkWriter.MarkResult r;
        try {
            r = markWriter.applyAll(attempt.getId(), items, ctx);
        } catch (SubmissionReviewException e) {
            throw withFullRelease(e, attempt);
        }
        return editResponse(attempt, r, false, null, null);
    }

    /** A4: accept the AI's draft marks (all drafts, or the given keys). */
    public Map<String, Object> acceptAi(CustomUserDetails user, StudentAttempt attempt, List<String> keys,
                                        String expectedRelease) {
        return acceptAi(user, attempt, keys, expectedRelease, null);
    }

    /**
     * {@code expectedRevisions} ("sid:qid" to the revision the teacher saw): an AI mark that
     * changed since (a re-check stored a new value) is not accepted unseen - 409 STALE_REVISION.
     */
    public Map<String, Object> acceptAi(CustomUserDetails user, StudentAttempt attempt, List<String> keys,
                                        String expectedRelease, Map<String, Integer> expectedRevisions) {
        SubmissionReviewStore.AttemptState st = store.attempt(attempt.getId());
        access.requireEdit(user, attempt, st != null && st.released());
        Loaded l = load(attempt);
        List<MarkWriter.MarkChange> changes = new ArrayList<>();
        Set<String> wanted = keys == null || keys.isEmpty() ? null : new HashSet<>(keys);
        for (SubmissionSnapshots.KeyState k : l.snapshot().keys()) {
            if (k.state() != MarkState.AI_DRAFT) continue;
            if (wanted != null && !wanted.contains(k.key().key())) continue;
            Integer expectedRevision = expectedRevisions == null ? null : expectedRevisions.get(k.key().key());
            changes.add(new MarkWriter.MarkChange(attempt.getId(), k.key().sectionId(), k.key().questionId(),
                    MarkWriter.Writer.ACCEPT_AI, null, null, null, false, null, user.getUserId(), expectedRevision,
                    expectedRelease, false, null, null, null));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        if (changes.isEmpty()) {
            out.put("accepted", 0);
            out.put("rows", List.of());
            out.put("release", release(l.state(), l.snapshot()));
            return out;
        }
        MarkWriter.MarkResult r;
        try {
            r = markWriter.applyAll(attempt.getId(), changes, new MarkWriter.BatchContext(
                    null, expectedRelease, false, user.getUserId(), MarkWriter.Writer.ACCEPT_AI));
        } catch (SubmissionReviewException e) {
            throw withFullRelease(e, attempt);
        }
        Map<String, Object> edit = editResponse(attempt, r, false, null, null);
        out.put("accepted", r.changed());
        out.put("rows", edit.get("rows"));
        out.put("release", edit.get("release"));
        return out;
    }

    /** A6: score an objective answer again with the answer key. */
    public Map<String, Object> reapplyKey(CustomUserDetails user, StudentAttempt attempt, String sectionId,
                                          String questionId, boolean force, String reason, String expectedRelease) {
        SubmissionReviewStore.AttemptState st = store.attempt(attempt.getId());
        access.requireEdit(user, attempt, st != null && st.released());
        if (force) access.requireForce(user);
        Review.Paper paper = paperOutline.get(attempt.getRegistration().getAssessment().getId());
        Review.PaperKey key = paper.find(sectionId, questionId);
        if (key == null) {
            throw SubmissionReviewException.unprocessable("NOT_IN_PAPER", "This question is not on the paper",
                    Map.of("key", Review.key(sectionId, questionId)));
        }
        if (!QuestionKinds.isObjective(key.questionType())) {
            throw SubmissionReviewException.unprocessable("NOT_OBJECTIVE",
                    "Only answer-key questions can be re-marked with the answer key", null);
        }
        Question question = questionRepository == null ? null : questionRepository.findById(questionId).orElse(null);
        String type = question != null && question.getQuestionType() != null ? question.getQuestionType()
                : key.questionType();
        String autoEval = question != null ? question.getAutoEvaluationJson() : key.autoEvaluationJson();
        String response = marksRepository.findByAssessmentIdAndStudentAttemptIdAndQuestionIdAndSectionId(
                        attempt.getRegistration().getAssessment().getId(), attempt.getId(), questionId, sectionId)
                .map(QuestionWiseMarks::getResponseJson).orElse(null);
        if ((response == null || response.isBlank()) && studentAttemptService != null) {
            response = studentAttemptService.getQuestionDetails(questionId, attempt.getAttemptData());
        }
        var scored = QuestionBasedStrategyFactory.calculateMarks(key.markingJson(), autoEval,
                response == null ? "{}" : response, type);
        MarkWriter.MarkChange change = new MarkWriter.MarkChange(attempt.getId(), sectionId, questionId,
                force ? MarkWriter.Writer.ANSWER_KEY_FORCE : MarkWriter.Writer.ANSWER_KEY, scored.getMarks(), null,
                null, false, reason, user.getUserId(), null, expectedRelease, false, null, scored.getAnswerStatus(),
                null);
        MarkWriter.MarkResult r;
        try {
            r = markWriter.apply(change);
        } catch (SubmissionReviewException e) {
            throw withFullRelease(e, attempt);
        }
        Map<String, Object> edit = editResponse(attempt, r, false, sectionId, questionId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("row", edit.get("row"));
        out.put("total_before", edit.get("total_before"));
        out.put("total_after", edit.get("total_after"));
        out.put("max_total", edit.get("max_total"));
        out.put("release", edit.get("release"));
        return out;
    }

    /** A3p: which pages of the sheet hold the answer. No revision, no event, no recompute. */
    @Transactional
    public Map<String, Object> setPages(CustomUserDetails user, StudentAttempt attempt, String sectionId,
                                        String questionId, String pages) {
        SubmissionReviewStore.AttemptState st = store.attempt(attempt.getId());
        access.requireEdit(user, attempt, st != null && st.released());
        String clean = pages == null ? null : pages.replaceAll("\\s+", "");
        if (clean != null && (clean.length() > 64 || !clean.matches("[0-9,]*"))) {
            throw SubmissionReviewException.unprocessable("INVALID_PAGES", "Pages are numbers separated by commas",
                    null);
        }
        attemptRepository.lockById(attempt.getId());
        QuestionWiseMarks row = marksRepository.findByAssessmentIdAndStudentAttemptIdAndQuestionIdAndSectionId(
                attempt.getRegistration().getAssessment().getId(), attempt.getId(), questionId, sectionId).orElse(null);
        if (row == null) {
            throw SubmissionReviewException.unprocessable("NOT_IN_PAPER", "There is no answer row for this question",
                    Map.of("key", Review.key(sectionId, questionId)));
        }
        row.setAnswerPages(clean == null || clean.isEmpty() ? null : clean);
        marksRepository.saveAndFlush(row); // the response below reads through JDBC
        Loaded l = load(attempt);
        SubmissionSnapshots.KeyState k = l.snapshot().find(sectionId, questionId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("row", k == null ? null : questionRow(k, rowContext(l)));
        return out;
    }

    // ------------------------------------------------------------------ A8 / A9 / A9b

    public Map<String, Object> release(CustomUserDetails user, StudentAttempt attempt, boolean notify,
                                       boolean allowUnmarked, boolean releaseWhenMarked, String expectedRelease) {
        access.requireRelease(user);
        SubmissionReleaseService.RowRelease r;
        try {
            r = releaseService.releaseOne(attempt.getId(), notify, allowUnmarked, releaseWhenMarked, expectedRelease,
                    user.getUserId());
        } catch (SubmissionReviewException e) {
            throw withFullRelease(e, attempt);
        }
        evictSummary(attempt);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("released", r.released());
        if (!r.released()) out.put("release_when_marked", r.releaseWhenMarked());
        Map<String, Object> rel = release(r.state(), null);
        // The answers left unmarked by this release (the history's RELEASED_WITH_UNMARKED count).
        if (r.released()) rel.put("unmarked_at_release", r.unmarkedAtRelease());
        out.put("release", rel);
        if (r.released()) {
            out.put("accepted_ai_drafts", r.acceptedAiDrafts());
            out.put("notified", r.notified());
        }
        return out;
    }

    public Map<String, Object> withdraw(CustomUserDetails user, StudentAttempt attempt, String reason) {
        access.requireRelease(user);
        SubmissionReviewStore.AttemptState st = releaseService.withdraw(attempt.getId(), reason, user.getUserId());
        evictSummary(attempt);
        return Map.of("release", release(st, null));
    }

    public Map<String, Object> sendUpdate(CustomUserDetails user, StudentAttempt attempt) {
        access.requireRelease(user);
        releaseService.sendUpdate(attempt.getId(), user.getUserId());
        evictSummary(attempt);
        Loaded l = load(attempt); // unmarked_at_release = answers still unmarked (contract 5.1)
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("release", release(l.state(), l.snapshot()));
        out.put("queued", true);
        return out;
    }

    /**
     * RELEASE_CHANGED carries the full Release (contract 5.0 {@code details: {release: Release}}): the
     * writers only know status + token, and the Edit marks dialog moves its whole release state
     * forward from this body. Other errors pass through unchanged.
     */
    SubmissionReviewException withFullRelease(SubmissionReviewException e, StudentAttempt attempt) {
        if (!"RELEASE_CHANGED".equals(e.getCode())) return e;
        try {
            Loaded l = load(attempt);
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("release", release(l.state(), l.snapshot()));
            return SubmissionReviewException.conflict("RELEASE_CHANGED", e.getMessage(), details);
        } catch (RuntimeException ignored) {
            return e; // the writer's status + token are still enough to retry
        }
    }

    // ------------------------------------------------------------------ A10

    public Map<String, Object> markingSummary(CustomUserDetails user, Assessment assessment, List<String> attemptIds) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", summary(assessment));
        if (attemptIds != null && !attemptIds.isEmpty()) {
            if (attemptIds.size() > 100) {
                throw SubmissionReviewException.unprocessable("TOO_MANY", "At most 100 attempts at once", null);
            }
            Map<String, Object> per = new LinkedHashMap<>();
            List<SubmissionReviewStore.AttemptState> states = store.attempts(assessment.getId(), attemptIds);
            Map<String, SubmissionSnapshots.Snapshot> snaps = snapshotsFor(assessment, states);
            Map<String, Boolean> hasRows = new HashMap<>();
            snaps.forEach((id, s) -> hasRows.put(id, s.keys().stream().anyMatch(k -> k.row() != null)));
            for (SubmissionReviewStore.AttemptState st : states) {
                SubmissionSnapshots.Snapshot s = snaps.get(st.id());
                Map<String, Object> m = new LinkedHashMap<>();
                MarkingStatus marking = SubmissionSnapshots.marking(st.status(), hasRows.getOrDefault(st.id(), false),
                        st.totalMarks(), s.counts());
                m.put("marking", marking.name());
                m.put("counts", counts(s.counts()));
                m.put("result", resultView(st).name());
                m.put("released_with_unmarked", st.released() ? s.needsIncludingChecking() : 0);
                m.put("release_when_marked", st.releaseWhenMarked());
                m.put("marks_revision", st.marksRevision());
                m.put("notified_revision", st.notifiedRevision());
                m.put("release_token", st.token());
                per.put(st.id(), m);
            }
            out.put("attempts", per);
        }
        return out;
    }

    static ResultStatusView resultView(SubmissionReviewStore.AttemptState st) {
        if (!st.released()) return ResultStatusView.NOT_RELEASED;
        return st.changedSinceRelease() ? ResultStatusView.RELEASED_CHANGED : ResultStatusView.RELEASED;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> summary(Assessment assessment) {
        Cache cache = cacheManager == null ? null : cacheManager.getCache(SUMMARY_CACHE);
        if (cache != null) {
            Map<String, Object> cached = cache.get(assessment.getId(), Map.class);
            if (cached != null) return cached;
        }
        List<SubmissionReviewStore.AttemptState> states = store.submittedAttempts(assessment.getId());
        Map<String, SubmissionSnapshots.Snapshot> snaps = snapshotsFor(assessment, states);
        int done = 0, needs = 0, checkAi = 0, checking = 0, totalOnly = 0, waiting = 0, changed = 0, withUnmarked = 0;
        List<String> needsIds = new ArrayList<>();
        List<String> waitingIds = new ArrayList<>();
        for (SubmissionReviewStore.AttemptState st : states) {
            SubmissionSnapshots.Snapshot s = snaps.get(st.id());
            boolean rows = s.keys().stream().anyMatch(k -> k.row() != null);
            MarkingStatus m = SubmissionSnapshots.marking(st.status(), rows, st.totalMarks(), s.counts());
            switch (m) {
                case DONE -> done++;
                case NEEDS_MARKING -> {
                    needs++;
                    if (needsIds.size() < 200) needsIds.add(st.id());
                }
                case CHECK_AI -> checkAi++;
                case AI_CHECKING -> checking++;
                case TOTAL_ONLY -> totalOnly++;
                default -> {
                }
            }
            if (st.releaseWhenMarked() && !st.released()) {
                waiting++;
                if (waitingIds.size() < 200) waitingIds.add(st.id());
            }
            if (resultView(st) == ResultStatusView.RELEASED_CHANGED) changed++;
            if (st.released() && s.needsIncludingChecking() > 0) withUnmarked++;
        }
        Map<String, Object> sum = new LinkedHashMap<>();
        sum.put("submitted", states.size());
        sum.put("done", done);
        sum.put("needs_marking", needs);
        sum.put("check_ai", checkAi);
        sum.put("ai_checking", checking);
        sum.put("total_only", totalOnly);
        sum.put("waiting_release_when_marked", waiting);
        sum.put("released_changed", changed);
        sum.put("released_with_unmarked", withUnmarked);
        sum.put("needs_marking_attempt_ids", needsIds);
        sum.put("waiting_attempt_ids", waitingIds);
        if (cache != null) cache.put(assessment.getId(), sum);
        return sum;
    }

    private Map<String, SubmissionSnapshots.Snapshot> snapshotsFor(Assessment assessment,
                                                                    List<SubmissionReviewStore.AttemptState> states) {
        Map<String, SubmissionSnapshots.Snapshot> out = new HashMap<>();
        if (states.isEmpty()) return out;
        List<String> ids = states.stream().map(SubmissionReviewStore.AttemptState::id).toList();
        Map<String, List<Review.MarkRow>> rowsByAttempt = new HashMap<>();
        boolean wide = ids.size() > SubmissionReviewStore.MAX_IN;
        for (Review.MarkRow r : wide ? store.rowsOfAssessment(assessment.getId()) : store.rows(ids)) {
            rowsByAttempt.computeIfAbsent(r.attemptId(), k -> new ArrayList<>()).add(r);
        }
        Map<String, Review.RunInfo> runs = wide ? store.runsOfAssessment(assessment.getId()) : store.runs(ids);
        Review.Paper paper = paperOutline.get(assessment.getId());
        var groups = snapshots.groups(assessment.getId());
        for (SubmissionReviewStore.AttemptState st : states) {
            List<Review.MarkRow> rows = rowsByAttempt.getOrDefault(st.id(), List.of());
            out.put(st.id(), snapshots.compute(SubmissionSnapshots.Facts.of(assessment,
                            SubmissionSnapshots.kind(st.status(), assessment, null, !rows.isEmpty())), st.released(),
                    paper, rows, runs.getOrDefault(st.id(), Review.RunInfo.NONE), groups));
        }
        return out;
    }

    private void evictSummary(StudentAttempt attempt) {
        try {
            Cache cache = cacheManager == null ? null : cacheManager.getCache(SUMMARY_CACHE);
            if (cache != null) cache.evict(attempt.getRegistration().getAssessment().getId());
        } catch (Exception ignored) {
            // a 15-second cache: stale at worst for 15 seconds
        }
    }

    public void evictSummaryFor(StudentAttempt attempt) {
        evictSummary(attempt);
    }

    // ------------------------------------------------------------------ A11

    public Map<String, Object> releaseCheck(CustomUserDetails user, Assessment assessment, String instituteId,
                                            List<String> attemptIds, boolean all) {
        List<SubmissionReviewStore.AttemptState> states;
        if (all || attemptIds == null || attemptIds.isEmpty()) {
            states = store.allAttempts(assessment.getId());
        } else {
            if (attemptIds.size() > SubmissionReviewStore.MAX_IN) {
                throw SubmissionReviewException.unprocessable("TOO_MANY", "Too many attempts: use all=true", null);
            }
            states = store.attempts(assessment.getId(), attemptIds);
        }
        Map<SubmissionReleaseService.ReleaseClass, List<SubmissionReleaseService.Classified>> by = new HashMap<>();
        for (SubmissionReleaseService.Classified c : releaseService.classify(assessment, states)) {
            by.computeIfAbsent(c.cls(), k -> new ArrayList<>()).add(c);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("selected", states.size());
        out.put("ready", group(by.get(SubmissionReleaseService.ReleaseClass.READY), null));
        out.put("ai_drafts", group(by.get(SubmissionReleaseService.ReleaseClass.AI_DRAFTS), "drafts"));
        out.put("unmarked", group(by.get(SubmissionReleaseService.ReleaseClass.UNMARKED), "unmarked"));
        Map<String, Object> checking = group(by.get(SubmissionReleaseService.ReleaseClass.AI_CHECKING), null);
        Integer eta = null;
        for (SubmissionReleaseService.Classified c : by.getOrDefault(SubmissionReleaseService.ReleaseClass.AI_CHECKING,
                List.of())) {
            if (c.etaMinutes() != null) eta = eta == null ? c.etaMinutes() : Math.max(eta, c.etaMinutes());
        }
        checking.put("eta_minutes", eta);
        out.put("ai_checking", checking);
        out.put("already_released", group(by.get(SubmissionReleaseService.ReleaseClass.ALREADY_RELEASED), null));
        out.put("not_submitted", Map.of("count",
                by.getOrDefault(SubmissionReleaseService.ReleaseClass.NOT_SUBMITTED, List.of()).size()));
        boolean notifications = true;
        try {
            if (adminCoreServiceClient != null) {
                notifications = adminCoreServiceClient.isLearnerResultNotificationEnabled(instituteId);
            }
        } catch (Exception e) {
            log.warn("[submission-review] notification setting unavailable: {}", e.getMessage());
        }
        out.put("notifications", Map.of("learner_result_notifications", notifications));
        return out;
    }

    private static Map<String, Object> group(List<SubmissionReleaseService.Classified> list, String answers) {
        Map<String, Object> m = new LinkedHashMap<>();
        List<SubmissionReleaseService.Classified> l = list == null ? List.of() : list;
        m.put("count", l.size());
        if ("drafts".equals(answers)) {
            m.put("answers", l.stream().mapToInt(SubmissionReleaseService.Classified::draftAnswers).sum());
        } else if ("unmarked".equals(answers)) {
            m.put("answers", l.stream().mapToInt(SubmissionReleaseService.Classified::unmarkedAnswers).sum());
        }
        m.put("attempt_ids", l.stream().map(SubmissionReleaseService.Classified::attemptId).toList());
        return m;
    }

    // ------------------------------------------------------------------ helpers

    public Assessment requireAssessment(String assessmentId) {
        if (assessmentRepository == null) throw notFound();
        return assessmentRepository.findById(assessmentId).orElseThrow(this::notFound);
    }

    private SubmissionReviewException notFound() {
        return new SubmissionReviewException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found");
    }

    static String iso(Date d) {
        return d == null ? null : Instant.ofEpochMilli(d.getTime()).toString();
    }

    private static JsonNode readTree(String json) {
        if (json == null || json.isBlank()) return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
        }
    }

    /**
     * The key of a one-word / long answer: data.answer as text, or the model answer's
     * {@code content} (a long answer stores {id, type, content}); a one-word key may also
     * list data.validAnswers. Null when there is none (was "" for an object answer, which
     * hid the model answer on the card).
     */
    public static String keyText(JsonNode data) {
        JsonNode answer = data.path("answer");
        String text = answer.isObject() ? textOf(answer.path("content")) : textOf(answer);
        if (text != null && !text.isBlank()) return text;
        List<String> valid = new ArrayList<>();
        data.path("validAnswers").forEach(n -> {
            if (n.isValueNode() && !n.asText().isBlank()) valid.add(n.asText());
        });
        return valid.isEmpty() ? null : String.join(" / ", valid);
    }

    private static String textOf(JsonNode n) {
        return n == null || n.isMissingNode() || n.isNull() ? null : n.asText();
    }

    private static Double numberOf(JsonNode n) {
        if (n == null || n.isMissingNode() || n.isNull()) return null;
        if (n.isNumber()) return n.asDouble();
        try {
            return Double.parseDouble(n.asText().trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static String fileIdOf(String attemptData) {
        String id = textOf(readTree(attemptData).path("fileId"));
        return id == null || id.isBlank() ? null : id;
    }
}
