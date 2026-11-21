package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.exam_interface.service.ExamInterfaceService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Step-1 save semantics of exam_interface (V68): absent keeps, null / "default" clears. */
class AssessmentBasicDetailsManagerExamInterfaceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String STORED = "{\"v\":1,\"preset\":\"gate\",\"strict\":true}";

    private AssessmentBasicDetailsManager manager;
    private AssessmentRepository assessments;

    @BeforeEach
    void setUp() {
        manager = new AssessmentBasicDetailsManager();
        assessments = mock(AssessmentRepository.class);
        manager.assessmentRepository = assessments;
        manager.assessmentInstituteMappingRepository = mock(AssessmentInstituteMappingRepository.class);
        manager.assessmentWorkflowEventPublisher = mock(AssessmentWorkflowEventPublisher.class);
        manager.examInterfaceService = new ExamInterfaceService(assessments);
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

    private Assessment existingWithInterface() {
        Assessment a = new Assessment();
        a.setId("a1");
        a.setPlayMode("EXAM");
        a.setExamInterface(STORED);
        when(assessments.findByAssessmentIdAndInstituteId("a1", "inst-1")).thenReturn(Optional.of(a));
        return a;
    }

    private static BasicAssessmentDetailsDTO dto(String json) throws Exception {
        return MAPPER.readValue(json, BasicAssessmentDetailsDTO.class);
    }

    @Test
    void a_save_that_omits_the_field_keeps_the_stored_value() throws Exception {
        Assessment a = existingWithInterface();
        manager.saveBasicAssessmentDetails(null, dto("{\"switch_sections\":true}"), "a1", "inst-1", "EXAM");
        assertThat(a.getExamInterface()).isEqualTo(STORED);
    }

    @Test
    void explicit_null_clears_it() throws Exception {
        Assessment a = existingWithInterface();
        manager.saveBasicAssessmentDetails(null, dto("{\"exam_interface\":null}"), "a1", "inst-1", "EXAM");
        assertThat(a.getExamInterface()).isNull();
    }

    @Test
    void default_preset_clears_it() throws Exception {
        Assessment a = existingWithInterface();
        manager.saveBasicAssessmentDetails(null,
                dto("{\"exam_interface\":{\"v\":1,\"preset\":\"default\",\"strict\":true}}"), "a1", "inst-1", "EXAM");
        assertThat(a.getExamInterface()).isNull();
    }

    @Test
    void a_new_value_replaces_it() throws Exception {
        Assessment a = existingWithInterface();
        manager.saveBasicAssessmentDetails(null,
                dto("{\"exam_interface\":{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":false}}"),
                "a1", "inst-1", "EXAM");
        assertThat(MAPPER.readTree(a.getExamInterface()))
                .isEqualTo(MAPPER.readTree("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":false}"));
    }

    @Test
    void an_invalid_value_is_refused_and_nothing_is_saved() throws Exception {
        Assessment a = existingWithInterface();
        a.setCanSwitchSection(true);
        BasicAssessmentDetailsDTO bad = dto("{\"switch_sections\":false,\"exam_interface\":{\"preset\":\"JEE MAIN\"}}");
        assertThatThrownBy(() -> manager.saveBasicAssessmentDetails(null, bad, "a1", "inst-1", "EXAM"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("exam_interface.preset");
        verify(assessments, never()).save(any());
        assertThat(a.getExamInterface()).isEqualTo(STORED);
        assertThat(a.getCanSwitchSection()).isTrue();
    }

    @Test
    void a_new_assessment_stores_it() throws Exception {
        when(assessments.findByAssessmentIdAndInstituteId(anyString(), anyString())).thenReturn(Optional.empty());
        manager.saveBasicAssessmentDetails(null,
                dto("{\"assessment_type\":\"PUBLIC\",\"exam_interface\":{\"v\":1,\"preset\":\"rrb-je\",\"strict\":true}}"),
                null, "inst-1", "EXAM");
        ArgumentCaptor<Assessment> saved = ArgumentCaptor.forClass(Assessment.class);
        verify(assessments).save(saved.capture());
        assertThat(MAPPER.readTree(saved.getValue().getExamInterface()).path("preset").asText()).isEqualTo("rrb-je");
    }

    @Test
    void a_new_assessment_without_the_field_gets_the_default_screen() throws Exception {
        manager.saveBasicAssessmentDetails(null, dto("{\"assessment_type\":\"PUBLIC\"}"), null, "inst-1", "EXAM");
        ArgumentCaptor<Assessment> saved = ArgumentCaptor.forClass(Assessment.class);
        verify(assessments).save(saved.capture());
        assertThat(saved.getValue().getExamInterface()).isNull();
    }
}
