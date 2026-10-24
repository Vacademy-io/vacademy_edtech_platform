package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.SectionAddEditRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.AddQuestionsAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.service.assessment_get.AssessmentService;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Server-side structure lock for partner-API exams once open (spec 7.1): every caller of
 * saveQuestionsToAssessment, the dashboard included, is refused adding or removing
 * questions or changing max marks; dashboard exams and API drafts keep today's behaviour.
 */
class AssessmentLinkQuestionsManagerApiLockTest {

    private static final String MARKS_5 = "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":5.0,\"negativeMark\":0}}";
    private static final String MARKS_6 = "{\"type\":\"LONG_ANSWER\",\"data\":{\"totalMark\":6,\"negativeMark\":0}}";

    private AssessmentLinkQuestionsManager manager;
    private Assessment assessment;

    @BeforeEach
    void setUp() {
        manager = new AssessmentLinkQuestionsManager();
        manager.sectionRepository = mock(SectionRepository.class);
        manager.assessmentService = mock(AssessmentService.class);
        manager.questionAssessmentSectionMappingService = mock(QuestionAssessmentSectionMappingService.class);
        assessment = new Assessment();
        assessment.setId("a1");
        assessment.setSource("API");
        assessment.setStatus("PUBLISHED");
        when(manager.assessmentService.getAssessmentWithActiveSections("a1", "inst-1")).thenReturn(Optional.of(assessment));
        QuestionAssessmentSectionMapping existing = new QuestionAssessmentSectionMapping();
        existing.setMarkingJson(MARKS_5);
        when(manager.questionAssessmentSectionMappingService.getMappingById("q1", "s1")).thenReturn(existing);
    }

    private static AddQuestionsAssessmentDetailsDTO update(String marking, boolean added, boolean deleted, boolean updated) {
        SectionAddEditRequestDto.QuestionAndMarking qm = new SectionAddEditRequestDto.QuestionAndMarking(
                "q1", marking, 0, 1, added, deleted, updated);
        SectionAddEditRequestDto section = new SectionAddEditRequestDto();
        section.setSectionId("s1");
        section.setQuestionAndMarking(new ArrayList<>(List.of(qm)));
        AddQuestionsAssessmentDetailsDTO dto = new AddQuestionsAssessmentDetailsDTO();
        dto.getUpdatedSections().add(section);
        return dto;
    }

    @Test
    void open_api_exam_refuses_added_and_deleted_questions_and_new_sections() {
        assertThatThrownBy(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_5, true, false, false)))
                .isInstanceOf(VacademyException.class).hasMessageContaining("managed by the API");
        assertThatThrownBy(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_5, false, true, false)))
                .isInstanceOf(VacademyException.class);
        AddQuestionsAssessmentDetailsDTO added = new AddQuestionsAssessmentDetailsDTO();
        added.getAddedSections().add(new SectionAddEditRequestDto());
        assertThatThrownBy(() -> manager.requireApiStructureUnlocked(assessment, added)).isInstanceOf(VacademyException.class);
    }

    @Test
    void open_api_exam_refuses_a_max_marks_change_but_accepts_unchanged_marks() {
        assertThatThrownBy(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_6, false, false, true)))
                .isInstanceOf(VacademyException.class);
        assertThatCode(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_5, false, false, true)))
                .doesNotThrowAnyException();
    }

    @Test
    void the_lock_is_applied_by_save_questions_to_assessment() {
        assertThatThrownBy(() -> manager.saveQuestionsToAssessment(null, update(MARKS_5, true, false, false), "a1",
                "inst-1", "EXAM")).isInstanceOf(VacademyException.class);
    }

    @Test
    void dashboard_exams_and_api_drafts_are_untouched() {
        assessment.setSource(null);
        assertThatCode(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_6, true, true, true)))
                .doesNotThrowAnyException();
        assessment.setSource("API");
        assessment.setStatus("DRAFT");
        assertThatCode(() -> manager.requireApiStructureUnlocked(assessment, update(MARKS_6, true, true, true)))
                .doesNotThrowAnyException();
    }
}
