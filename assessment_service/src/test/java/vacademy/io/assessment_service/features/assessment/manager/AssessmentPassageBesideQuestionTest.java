package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.exam_interface.service.ExamInterfaceService;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartPreviewResponse;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * "Show passage beside the question" (per assessment, default off) lives in
 * {@code assessment.exam_interface} as {@code passage_beside_question}. No migration:
 * it rides the existing JSONB column, the Step 1 save and the learner start preview.
 */
class AssessmentPassageBesideQuestionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AssessmentBasicDetailsManager manager;
    private AssessmentRepository assessments;
    private ExamInterfaceService service;
    private Assessment assessment;

    @BeforeEach
    void setUp() {
        manager = new AssessmentBasicDetailsManager();
        assessments = mock(AssessmentRepository.class);
        manager.assessmentRepository = assessments;
        manager.assessmentInstituteMappingRepository = mock(AssessmentInstituteMappingRepository.class);
        manager.assessmentWorkflowEventPublisher = mock(AssessmentWorkflowEventPublisher.class);
        service = new ExamInterfaceService(assessments);
        manager.examInterfaceService = service;
        when(assessments.save(any(Assessment.class))).thenAnswer(inv -> inv.getArgument(0));
        when(manager.assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(anyString(), anyString()))
                .thenReturn(Optional.empty());

        assessment = new Assessment();
        assessment.setId("a1");
        assessment.setPlayMode("EXAM");
        when(assessments.findByAssessmentIdAndInstituteId("a1", "inst-1")).thenReturn(Optional.of(assessment));
        when(assessments.findById("a1")).thenReturn(Optional.of(assessment));
    }

    private void save(String json) throws Exception {
        BasicAssessmentDetailsDTO dto = MAPPER.readValue(json, BasicAssessmentDetailsDTO.class);
        manager.saveBasicAssessmentDetails(null, dto, "a1", "inst-1", "EXAM");
    }

    /** What the exam player receives (start preview JSON). */
    private JsonNode learnerExamInterface() throws Exception {
        LearnerAssessmentStartPreviewResponse preview = new LearnerAssessmentStartPreviewResponse();
        preview.setExamInterface(service.read(assessment));
        return MAPPER.readTree(MAPPER.writeValueAsString(preview)).get("exam_interface");
    }

    @Test
    void flag_on_with_the_standard_screen_round_trips_to_the_learner() throws Exception {
        save("{\"exam_interface\":{\"v\":1,\"preset\":\"default\",\"passage_beside_question\":true}}");

        assertThat(assessment.getExamInterface()).isNotNull();
        JsonNode learner = learnerExamInterface();
        assertThat(learner.path("passage_beside_question").asBoolean(false)).isTrue();
        // Still the standard screen: no theme preset is introduced.
        assertThat(learner.path("preset").asText()).isEqualTo("default");
        assertThat(ExamInterfaceService.passageBesideQuestion(learner)).isTrue();
        // The instruction page reads the same column.
        assertThat(ExamInterfaceService.passageBesideQuestion(service.forLearner("a1"))).isTrue();
    }

    @Test
    void flag_without_a_preset_is_kept_too() throws Exception {
        save("{\"exam_interface\":{\"passage_beside_question\":true}}");
        assertThat(ExamInterfaceService.passageBesideQuestion(learnerExamInterface())).isTrue();
    }

    @Test
    void flag_rides_along_with_a_themed_screen() throws Exception {
        save("{\"exam_interface\":{\"v\":1,\"preset\":\"gate\",\"strict\":true,\"passage_beside_question\":true}}");
        JsonNode learner = learnerExamInterface();
        assertThat(learner.path("preset").asText()).isEqualTo("gate");
        assertThat(learner.path("passage_beside_question").asBoolean(false)).isTrue();
    }

    @Test
    void flag_off_with_the_standard_screen_still_stores_null_like_today() throws Exception {
        save("{\"exam_interface\":{\"v\":1,\"preset\":\"default\",\"passage_beside_question\":false}}");
        assertThat(assessment.getExamInterface()).isNull();
        assertThat(learnerExamInterface().isNull()).isTrue();

        save("{\"exam_interface\":{\"v\":1,\"preset\":\"default\",\"passage_beside_question\":null}}");
        assertThat(assessment.getExamInterface()).isNull();
    }

    @Test
    void turning_it_off_clears_the_stored_value() throws Exception {
        save("{\"exam_interface\":{\"v\":1,\"preset\":\"default\",\"passage_beside_question\":true}}");
        assertThat(assessment.getExamInterface()).isNotNull();
        save("{\"exam_interface\":null}");
        assertThat(assessment.getExamInterface()).isNull();
        assertThat(ExamInterfaceService.passageBesideQuestion(learnerExamInterface())).isFalse();
    }

    @Test
    void old_rows_without_the_key_read_as_off() {
        assessment.setExamInterface("{\"v\":1,\"preset\":\"jee-main\",\"layout\":\"nta-mock\",\"strict\":true}");
        assertThat(ExamInterfaceService.passageBesideQuestion(service.read(assessment))).isFalse();
        assessment.setExamInterface(null);
        assertThat(ExamInterfaceService.passageBesideQuestion(service.read(assessment))).isFalse();
    }

    @Test
    void a_non_boolean_flag_is_a_400() {
        assertThatThrownBy(() -> save("{\"exam_interface\":{\"preset\":\"default\",\"passage_beside_question\":\"yes\"}}"))
                .isInstanceOf(VacademyException.class)
                .satisfies(e -> assertThat(((VacademyException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> save("{\"exam_interface\":{\"preset\":\"gate\",\"passage_beside_question\":1}}"))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void the_default_screen_with_the_flag_still_validates_its_other_keys() {
        assertThatThrownBy(() -> save(
                "{\"exam_interface\":{\"preset\":\"default\",\"passage_beside_question\":true,\"strict\":\"yes\"}}"))
                .isInstanceOf(VacademyException.class);
        assertThatThrownBy(() -> save(
                "{\"exam_interface\":{\"preset\":\"Default\",\"passage_beside_question\":true}}"))
                .isInstanceOf(VacademyException.class);
    }
}
