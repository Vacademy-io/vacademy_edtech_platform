package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.SectionAddEditRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.CopyCheckCriteriaService;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Criteria set per question on the Add Questions step are saved (the request DTO used to
 * drop them): on the question, and as what the AI copy check marks it by. Only questions on
 * this paper whose criteria changed are written.
 */
class AssessmentLinkQuestionsManagerCriteriaTest {

    private static final String RUBRIC = "{\"max_marks\":10,\"rubric\":[{\"criteria_name\":\"Rule\",\"max_marks\":10}]}";
    private static final String OLD = "{\"max_marks\":10,\"rubric\":[{\"criteria_name\":\"Old\",\"max_marks\":10}]}";

    private AssessmentLinkQuestionsManager manager;
    private CopyCheckCriteriaService criteria;
    private QuestionRepository questions;

    @BeforeEach
    void setUp() throws Exception {
        manager = new AssessmentLinkQuestionsManager();
        criteria = mock(CopyCheckCriteriaService.class);
        questions = mock(QuestionRepository.class);
        manager.copyCheckCriteriaService = criteria;
        manager.questionRepository = questions;
        ObjectMapper mapper = new ObjectMapper();
        when(criteria.paperQuestions("a1")).thenReturn(List.of(
                new CopyCheckCriteriaService.PaperQuestion("q1", 1, "", "LONG_ANSWER", 10, null),
                new CopyCheckCriteriaService.PaperQuestion("q2", 2, "", "LONG_ANSWER", 10, mapper.readTree(OLD)),
                new CopyCheckCriteriaService.PaperQuestion("q3", 3, "", "LONG_ANSWER", 10, mapper.readTree(RUBRIC))));
    }

    private static SectionAddEditRequestDto.QuestionAndMarking qm(String id, String criteriaJson, boolean deleted) {
        return new SectionAddEditRequestDto.QuestionAndMarking(id, "{}", 0, 1, false, deleted, !deleted, criteriaJson, null);
    }

    private static AddQuestionsAssessmentDetailsDTO request(SectionAddEditRequestDto.QuestionAndMarking... items) {
        SectionAddEditRequestDto section = new SectionAddEditRequestDto();
        section.setSectionId("s1");
        section.setQuestionAndMarking(new ArrayList<>(List.of(items)));
        AddQuestionsAssessmentDetailsDTO dto = new AddQuestionsAssessmentDetailsDTO();
        dto.getUpdatedSections().add(section);
        return dto;
    }

    @Test
    void new_and_changed_criteria_are_saved_on_the_question_and_for_the_ai_check() {
        manager.saveQuestionCriteria(request(qm("q1", RUBRIC, false), qm("q2", RUBRIC, false)), "a1", "inst");

        verify(questions).updateEvaluationCriteria("q1", RUBRIC, null);
        verify(questions).updateEvaluationCriteria("q2", RUBRIC, null);
        verify(criteria).saveQuestionCriteria("inst", "a1", Map.of("q1", RUBRIC, "q2", RUBRIC));
    }

    @Test
    void unchanged_off_paper_deleted_and_blank_criteria_are_left_alone() {
        manager.saveQuestionCriteria(request(qm("q3", RUBRIC, false), qm("zz", RUBRIC, false),
                qm("q1", RUBRIC, true), qm("q2", null, false), qm("q2", " ", false)), "a1", "inst");

        verify(questions, never()).updateEvaluationCriteria(anyString(), anyString(), any());
        verify(criteria, never()).saveQuestionCriteria(anyString(), anyString(), anyMap());
    }

    @Test
    void the_question_keeps_its_criteria_when_the_ai_check_store_is_down() {
        doThrow(new RuntimeException("down")).when(criteria).saveQuestionCriteria(eq("inst"), eq("a1"), anyMap());

        manager.saveQuestionCriteria(request(qm("q1", RUBRIC, false)), "a1", "inst");

        verify(questions).updateEvaluationCriteria("q1", RUBRIC, null);
    }
}
