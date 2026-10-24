package vacademy.io.assessment_service.features.open_evaluation.choice;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.open_evaluation.config.OpenApiProperties;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamGuards;
import vacademy.io.assessment_service.features.open_evaluation.exam.ExamValidator;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamInputs;
import vacademy.io.assessment_service.features.open_evaluation.exam.dto.ExamViews;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Internal choice (spec 7.2 "Choice groups", T1.30 storage): {@code PUT /exams/{id}/choice-groups}
 * replaces every group, in draft or while no submission is graded or being graded (a
 * running copy was dispatched with the old groups). {@code paper_max} = sum of the
 * questions in no group + for each group the sum of its top {@code attempt} maxima.
 *
 * <p>Behind {@code assessment.open-api.choice-groups-enabled} (default off): until the grade
 * request sends {@code choice_groups} and {@code paper_max} to ai_service, every copy is
 * still totalled over all alternatives, so accepting groups would promise a paper max the
 * engine does not apply (spec 7.1: 422 {@code feature_not_available} before then).
 */
@Service
public class ChoiceGroupService {

    private final ChoiceGroupStore store;
    private final ApiExamStore examStore;
    private final OpenQuestionService questions;
    private final OpenApiProperties properties;

    public ChoiceGroupService(ChoiceGroupStore store, ApiExamStore examStore, OpenQuestionService questions,
            OpenApiProperties properties) {
        this.store = store;
        this.examStore = examStore;
        this.questions = questions;
        this.properties = properties;
    }

    /** Whether the engine applies choice groups (and the endpoints accept them). */
    public boolean enabled() {
        return properties.isChoiceGroupsEnabled();
    }

    /** 422 {@code feature_not_available} while the engine does not apply choice groups yet. */
    public void requireEnabled() {
        if (!enabled()) {
            throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.FEATURE_NOT_AVAILABLE,
                    "Choice groups (internal choice) are not available yet: marks would still be totalled over "
                            + "every alternative. Send papers without internal choice for now.",
                    Map.of("field", "choice_groups"));
        }
    }

    /** {@code PUT} result: the stored groups and the resulting paper max. */
    public record Replaced(List<ExamViews.ChoiceGroup> choiceGroups, double totalMarks, double paperMax) {
    }

    @Transactional
    public Replaced replace(ApiKeyPrincipal key, String examId, ExamInputs.ReplaceChoiceGroups body) {
        requireEnabled();
        ApiExamStore.ApiExamRow exam = ExamGuards.requireLive(examStore, key.getInstituteId(), examId, true);
        ExamGuards.requireNotFinalized(exam);
        if (!exam.isDraft() && examStore.hasGradedOrRunningEvaluation(examId)) {
            throw OpenApiException.conflict(ApiErrorCode.EXAM_HAS_SUBMISSIONS,
                    "Choice groups can only change while no submission of this exam is graded or being graded.",
                    Map.of("exam_id", examId));
        }
        List<ExamInputs.ChoiceGroupInput> groups = body == null || body.getChoiceGroups() == null ? List.of()
                : body.getChoiceGroups();
        Map<String, OpenQuestionService.ExamQuestion> byLabel = questions.byLabel(examId);
        ExamValidator.validateChoiceGroups(groups, byLabel.keySet(), "choice_groups");
        store.replace(examId, toRows(groups, byLabel));
        examStore.touch(examId);
        List<ChoiceGroupStore.ChoiceGroupRow> rows = store.list(examId);
        Totals totals = totals(new ArrayList<>(byLabel.values()), rows);
        return new Replaced(views(rows, byLabel), totals.totalMarks(), totals.paperMax());
    }

    /** Stores groups given with labels (create path, already validated). */
    public void storeForCreate(String examId, List<ExamInputs.ChoiceGroupInput> groups,
            Map<String, OpenQuestionService.ExamQuestion> byLabel) {
        if (groups != null && !groups.isEmpty()) {
            requireEnabled();
            store.replace(examId, toRows(groups, byLabel));
        }
    }

    static List<ChoiceGroupStore.ChoiceGroupRow> toRows(List<ExamInputs.ChoiceGroupInput> groups,
            Map<String, OpenQuestionService.ExamQuestion> byLabel) {
        // Labels are unique ignoring case (ExamValidator), so this map is unambiguous.
        Map<String, OpenQuestionService.ExamQuestion> byLowerLabel = new LinkedHashMap<>();
        byLabel.forEach((label, q) -> byLowerLabel.put(label.trim().toLowerCase(Locale.ROOT), q));
        List<ChoiceGroupStore.ChoiceGroupRow> rows = new ArrayList<>();
        for (int i = 0; i < groups.size(); i++) {
            ExamInputs.ChoiceGroupInput g = groups.get(i);
            List<String> ids = new ArrayList<>();
            for (String label : g.getQuestionLabels()) {
                ids.add(byLowerLabel.get(label.trim().toLowerCase(Locale.ROOT)).id());
            }
            rows.add(new ChoiceGroupStore.ChoiceGroupRow(null, g.getLabel() == null ? null : g.getLabel().trim(), ids,
                    g.getAttempt(), g.getPolicy().trim().toLowerCase(Locale.ROOT), i));
        }
        return rows;
    }

    public List<ChoiceGroupStore.ChoiceGroupRow> list(String examId) {
        return store.list(examId);
    }

    public static List<ExamViews.ChoiceGroup> views(List<ChoiceGroupStore.ChoiceGroupRow> rows,
            Map<String, OpenQuestionService.ExamQuestion> byLabel) {
        Map<String, String> labelById = new LinkedHashMap<>();
        byLabel.forEach((label, q) -> labelById.put(q.id(), label));
        List<ExamViews.ChoiceGroup> out = new ArrayList<>();
        for (ChoiceGroupStore.ChoiceGroupRow r : rows) {
            out.add(ExamViews.ChoiceGroup.builder()
                    .id(r.id())
                    .label(r.label())
                    .questionIds(r.questionIds())
                    .questionLabels(r.questionIds().stream().map(id -> labelById.getOrDefault(id, id)).toList())
                    .attempt(r.attempt())
                    .policy(r.policy())
                    .build());
        }
        return out;
    }

    /** Total of all max marks and the paper max under the groups. */
    public record Totals(double totalMarks, double paperMax) {
    }

    public static Totals totals(List<OpenQuestionService.ExamQuestion> examQuestions,
            List<ChoiceGroupStore.ChoiceGroupRow> rows) {
        Map<String, BigDecimal> maxById = new LinkedHashMap<>();
        BigDecimal total = BigDecimal.ZERO;
        for (OpenQuestionService.ExamQuestion q : examQuestions) {
            BigDecimal max = q.maxMarks() == null ? BigDecimal.ZERO : q.maxMarks();
            maxById.put(q.id(), max);
            total = total.add(max);
        }
        List<ExamInputs.ChoiceGroupInput> byId = new ArrayList<>();
        for (ChoiceGroupStore.ChoiceGroupRow r : rows) {
            byId.add(new ExamInputs.ChoiceGroupInput(r.label(), r.questionIds(), r.attempt(), r.policy()));
        }
        BigDecimal paperMax = ExamValidator.paperMax(maxById, byId);
        return new Totals(total.doubleValue(), paperMax.doubleValue());
    }
}
