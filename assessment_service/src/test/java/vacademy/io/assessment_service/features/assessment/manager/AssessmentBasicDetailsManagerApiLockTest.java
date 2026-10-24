package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Exams created through the partner API keep result_type MANUAL and their evaluation type
 * (spec 3.2, 12); dashboard exams keep today's edit behaviour.
 */
class AssessmentBasicDetailsManagerApiLockTest {

    private AssessmentBasicDetailsManager manager;
    private AssessmentRepository assessments;
    private AssessmentWorkflowEventPublisher events;

    @BeforeEach
    void setUp() {
        manager = new AssessmentBasicDetailsManager();
        assessments = mock(AssessmentRepository.class);
        events = mock(AssessmentWorkflowEventPublisher.class);
        manager.assessmentRepository = assessments;
        manager.assessmentInstituteMappingRepository = mock(AssessmentInstituteMappingRepository.class);
        manager.assessmentWorkflowEventPublisher = events;
        when(assessments.save(any(Assessment.class))).thenAnswer(inv -> {
            Assessment a = inv.getArgument(0);
            if (a.getId() == null) {
                a.setId("new-id");
            }
            return a;
        });
        when(manager.assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(anyString(), anyString()))
                .thenReturn(Optional.empty());
    }

    private Assessment existing(String source, String evaluationType, String resultType) {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setPlayMode("EXAM");
        a.setSource(source);
        a.setEvaluationType(evaluationType);
        a.setResultType(resultType);
        when(assessments.findByAssessmentIdAndInstituteId("a1", "inst-1")).thenReturn(Optional.of(a));
        return a;
    }

    @Test
    void api_exam_refuses_a_result_type_change() {
        existing("API", "MANUAL", "MANUAL");
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setResultType("AUTO_AFTER_ASSESSMENT_END");

        assertThatThrownBy(() -> manager.saveBasicAssessmentDetails(null, dto, "a1", "inst-1", "EXAM"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("Result type");
        verify(assessments, never()).save(any());
    }

    @Test
    void api_exam_refuses_an_evaluation_type_change() {
        existing("API", "MANUAL", "MANUAL");
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setEvaluationType("AUTO");

        assertThatThrownBy(() -> manager.saveBasicAssessmentDetails(null, dto, "a1", "inst-1", "EXAM"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("Evaluation type");
    }

    @Test
    void api_exam_save_without_those_fields_keeps_them() {
        Assessment a = existing("API", "MANUAL", "MANUAL");

        manager.saveBasicAssessmentDetails(null, new BasicAssessmentDetailsDTO(), "a1", "inst-1", "EXAM");

        assertThat(a.getEvaluationType()).isEqualTo("MANUAL"); // not reset to AUTO
        assertThat(a.getResultType()).isEqualTo("MANUAL");
    }

    @Test
    void dashboard_exam_keeps_todays_behaviour() {
        Assessment a = existing(null, "MANUAL", "MANUAL");
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setResultType("AUTO_AFTER_ASSESSMENT_END");

        manager.saveBasicAssessmentDetails(null, dto, "a1", "inst-1", "EXAM");

        assertThat(a.getResultType()).isEqualTo("AUTO_AFTER_ASSESSMENT_END");
        assertThat(a.getEvaluationType()).isEqualTo("AUTO"); // the existing reset-on-omit rule
    }

    @Test
    void create_api_assessment_marks_the_source_before_the_create_event() {
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setResultType("AUTO_AFTER_ASSESSMENT_END");
        dto.setEvaluationType("MANUAL");

        manager.createApiAssessment(null, dto, "inst-1", "EXAM", "key-1");

        ArgumentCaptor<Assessment> created = ArgumentCaptor.forClass(Assessment.class);
        verify(events).publishAssessmentCreated(created.capture(), eq("inst-1"), any());
        assertThat(created.getValue().getSource()).isEqualTo("API");
        assertThat(created.getValue().getSourceId()).isEqualTo("key-1");
        assertThat(created.getValue().getResultType()).isEqualTo("MANUAL");
        assertThat(created.getValue().getEvaluationType()).isEqualTo("MANUAL");
    }

    @Test
    void create_api_assessment_needs_a_key_id() {
        assertThatThrownBy(() -> manager.createApiAssessment(null, new BasicAssessmentDetailsDTO(), "inst-1", "EXAM", " "))
                .isInstanceOf(VacademyException.class);
    }
}
