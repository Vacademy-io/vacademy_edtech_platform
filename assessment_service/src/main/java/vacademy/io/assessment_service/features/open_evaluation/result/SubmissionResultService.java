package vacademy.io.assessment_service.features.open_evaluation.result;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationStatusEnum;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.ApiSubmissionStore;
import vacademy.io.assessment_service.features.open_evaluation.submission.OpenSubmissionService;
import vacademy.io.assessment_service.features.open_evaluation.submission.SubmissionViews;
import vacademy.io.assessment_service.features.open_evaluation.support.PublicStatus;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code GET /submissions/{id}/result} (spec 7.8, T1.25): the submission's latest AI run read
 * question by question — newest row per question, the needs-review rule, {@code counted}
 * under internal choice, per-criterion max — plus totals over the paper max. Never includes
 * an email address (the dashboard's participant DTO does; this view is built from the
 * candidate table only).
 */
@Service
public class SubmissionResultService {

    private final OpenSubmissionService submissions;
    private final OpenQuestionService questions;
    private final ChoiceGroupService choiceGroups;
    private final ApiExamStore examStore;
    private final ResultStore resultStore;

    public SubmissionResultService(OpenSubmissionService submissions, OpenQuestionService questions,
            ChoiceGroupService choiceGroups, ApiExamStore examStore, ResultStore resultStore) {
        this.submissions = submissions;
        this.questions = questions;
        this.choiceGroups = choiceGroups;
        this.examStore = examStore;
        this.resultStore = resultStore;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> result(ApiKeyPrincipal key, String submissionId, String include) {
        ApiSubmissionStore.SubmissionView v = submissions.requireView(key, submissionId);
        if (ApiSubmissionStore.DELETED.equals(v.state())) {
            throw OpenSubmissionService.submissionNotFound();
        }
        return build(key, v, ResultRules.Include.parse(include));
    }

    /** The full result of one submission (also {@code include=result} on lists). */
    @Transactional(readOnly = true)
    public Map<String, Object> build(ApiKeyPrincipal key, ApiSubmissionStore.SubmissionView v, ResultRules.Include include) {
        List<OpenQuestionService.ExamQuestion> paper = questions.load(v.examId());
        Map<String, ResultStore.AiRow> rows = resultStore.aiRows(v.processId());
        Map<String, ResultStore.MarksRow> marks = resultStore.marks(v.attemptId());
        boolean runActive = v.processStatus() != null && AiEvaluationStatusEnum.ACTIVE.contains(v.processStatus());

        List<ResultRules.QuestionResult> results = new ArrayList<>();
        for (OpenQuestionService.ExamQuestion q : paper) {
            results.add(ResultRules.question(q, rows.get(q.id()), marks.get(q.id()), runActive, include));
        }
        List<ChoiceGroupStore.ChoiceGroupRow> groups = choiceGroups.list(v.examId());
        BigDecimal paperMax = groups.isEmpty() ? null
                : BigDecimal.valueOf(ChoiceGroupService.totals(paper, groups).paperMax());

        boolean blind = examStore.find(key.getInstituteId(), v.examId()).map(ApiExamStore.ApiExamRow::blind).orElse(false);
        List<String> submissionReasons = SubmissionViews.submissionReasons(v);
        boolean needsReview = !submissionReasons.isEmpty()
                || results.stream().anyMatch(ResultRules.QuestionResult::needsReview);
        String status = SubmissionViews.publicStatus(v);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("submission_id", v.attemptId());
        out.put("exam_id", v.examId());
        out.put("candidate", candidate(v, blind));
        out.put("status", status);
        out.put("needs_review", needsReview);
        out.put("review_reasons", submissionReasons);
        out.put("finalized", v.isFinalized());
        out.put("finalized_at", v.isFinalized() && v.reportLastReleaseDate() != null
                ? v.reportLastReleaseDate().toString() : null);
        out.put("rubric_version", v.rubricVersion());
        // Whether the rubric changed after grading needs the rubric store's current version
        // (ai_service); not read on this path yet.
        out.put("rubric_stale", null);
        out.put("totals", ResultRules.totals(results, paperMax));
        out.put("questions", results.stream().map(ResultRules.QuestionResult::view).toList());
        Map<String, Object> copy = new LinkedHashMap<>();
        boolean available = v.evaluatedFileId() != null && !v.evaluatedFileId().isBlank();
        copy.put("available", available);
        copy.put("download_path", available ? "/submissions/" + v.attemptId() + "/checked-copy" : null);
        out.put("checked_copy", copy);
        out.put("graded_at", AiEvaluationStatusEnum.COMPLETED.name().equals(v.processStatus())
                && v.processCompletedAt() != null ? v.processCompletedAt().toString() : null);
        Map<String, Object> status0 = SubmissionViews.status(v, null);
        out.put("credits_charged", status0.get("credits_charged"));
        out.put("error", PublicStatus.FAILED.equals(status) ? status0.get("error") : null);
        return out;
    }

    static Map<String, Object> candidate(ApiSubmissionStore.SubmissionView v, boolean blind) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("id", v.candidateId());
        c.put("external_id", v.candidateExternalId());
        c.put("name", blind ? null : v.candidateName());
        c.put("roll_number", v.candidateRoll());
        return c;
    }
}
