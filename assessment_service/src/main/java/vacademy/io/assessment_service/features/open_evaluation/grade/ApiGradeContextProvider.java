package vacademy.io.assessment_service.features.open_evaluation.grade;

import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckGradeContextProvider;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupService;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.ApiExamStore;
import vacademy.io.assessment_service.features.open_evaluation.exam.OpenQuestionService;
import vacademy.io.common.core.utils.PlainText;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * What an API exam tells the grader beyond the dashboard's tables (contract C4), added to the
 * grade request at dispatch:
 * <ul>
 *   <li>{@code exam_context}: level, subject, instructions (plain text), answer language;</li>
 *   <li>{@code choice_groups} + {@code paper_max} for internal choice — only while
 *       {@code assessment.open-api.choice-groups-enabled} is on (ai_service applies them from
 *       T1.36);</li>
 *   <li>the subject on every question.</li>
 * </ul>
 * Any run on an API exam gets them (a teacher's dashboard re-check of an API exam included);
 * a dashboard exam has no {@code api_exam} row, so its request is unchanged.
 */
@Component
public class ApiGradeContextProvider implements CopyCheckGradeContextProvider {

    private final ApiExamStore examStore;
    private final ChoiceGroupService choiceGroups;
    private final OpenQuestionService questions;

    public ApiGradeContextProvider(ApiExamStore examStore, ChoiceGroupService choiceGroups, OpenQuestionService questions) {
        this.examStore = examStore;
        this.choiceGroups = choiceGroups;
        this.questions = questions;
    }

    @Override
    public String subject(AiEvaluationProcess process) {
        return exam(process).map(ApiExamStore.ApiExamRow::subject).orElse(null);
    }

    @Override
    public void contribute(AiEvaluationProcess process, CopyCheckGradeRequestDto request) {
        Optional<ApiExamStore.ApiExamRow> found = exam(process);
        if (found.isEmpty()) {
            return;
        }
        ApiExamStore.ApiExamRow exam = found.get();
        request.setExamContext(examContext(exam));
        if (!choiceGroups.enabled()) {
            return;
        }
        List<ChoiceGroupStore.ChoiceGroupRow> groups = choiceGroups.list(exam.assessmentId());
        if (groups.isEmpty()) {
            return;
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (ChoiceGroupStore.ChoiceGroupRow g : groups) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("question_ids", g.questionIds());
            m.put("attempt", g.attempt());
            m.put("policy", g.policy());
            out.add(m);
        }
        request.setChoiceGroups(out);
        request.setPaperMax(ChoiceGroupService.totals(questions.load(exam.assessmentId()), groups).paperMax());
    }

    static Map<String, Object> examContext(ApiExamStore.ApiExamRow exam) {
        Map<String, Object> ctx = new LinkedHashMap<>();
        ctx.put("level", exam.level());
        if (exam.subject() != null) {
            ctx.put("subject", exam.subject());
        }
        if (exam.instructions() != null && !exam.instructions().isBlank()) {
            ctx.put("instructions", PlainText.unescape(exam.instructions()));
        }
        ctx.put("answer_language", exam.answerLanguage());
        return ctx;
    }

    private Optional<ApiExamStore.ApiExamRow> exam(AiEvaluationProcess process) {
        if (process == null || process.getAssessment() == null || process.getInstituteId() == null) {
            return Optional.empty();
        }
        return examStore.find(process.getInstituteId(), process.getAssessment().getId());
    }
}
