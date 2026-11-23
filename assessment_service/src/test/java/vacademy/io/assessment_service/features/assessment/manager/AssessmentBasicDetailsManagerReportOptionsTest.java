package vacademy.io.assessment_service.features.assessment.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.create_assessment.BasicAssessmentDetailsDTO;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.common.exceptions.VacademyException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Step 1 save of report_options (V69). */
class AssessmentBasicDetailsManagerReportOptionsTest {

    private static final ObjectMapper OM = new ObjectMapper();

    @Test
    void storesTheOptionsNormalised() throws Exception {
        Assessment a = new Assessment();
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setReportOptions(OM.readTree("{\"show_correct_answer\":false}"));
        AssessmentBasicDetailsManager.applyReportOptions(a, dto);
        assertThat(OM.readTree(a.getReportOptions())).isEqualTo(OM.readTree(
                "{\"show_question_wise\":true,\"show_your_answer\":true,\"show_correct_answer\":false,\"show_explanation\":true}"));
    }

    @Test
    void absentLeavesTheStoredValueAndNullClearsIt() {
        Assessment a = new Assessment();
        a.setReportOptions("{\"show_correct_answer\":false}");
        AssessmentBasicDetailsManager.applyReportOptions(a, new BasicAssessmentDetailsDTO());
        assertThat(a.getReportOptions()).isEqualTo("{\"show_correct_answer\":false}");

        BasicAssessmentDetailsDTO clear = new BasicAssessmentDetailsDTO();
        clear.setReportOptions(NullNode.getInstance());
        AssessmentBasicDetailsManager.applyReportOptions(a, clear);
        assertThat(a.getReportOptions()).isNull();
    }

    @Test
    void studentFieldsAreStoredOnThisAssessmentOnly() throws Exception {
        Assessment a = new Assessment();
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        // Institute default for the switches, plus fields: only the fields are stored.
        dto.setReportOptions(OM.readTree("{\"student_fields\":[\"Student Roll Number\",\" College \"]}"));
        AssessmentBasicDetailsManager.applyReportOptions(a, dto);
        assertThat(OM.readTree(a.getReportOptions()))
                .isEqualTo(OM.readTree("{\"student_fields\":[\"Student Roll Number\",\"College\"]}"));

        Assessment other = new Assessment();
        assertThat(other.getReportOptions()).isNull();

        // Clearing the list with the switches on the institute default goes back to null.
        dto.setReportOptions(OM.readTree("{\"student_fields\":[]}"));
        AssessmentBasicDetailsManager.applyReportOptions(a, dto);
        assertThat(a.getReportOptions()).isNull();
    }

    @Test
    void aBadFieldListIsABadRequest() throws Exception {
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setReportOptions(OM.readTree("{\"student_fields\":\"College\"}"));
        assertThatThrownBy(() -> AssessmentBasicDetailsManager.applyReportOptions(new Assessment(), dto))
                .isInstanceOf(VacademyException.class);
    }

    @Test
    void anInvalidValueIsABadRequest() throws Exception {
        BasicAssessmentDetailsDTO dto = new BasicAssessmentDetailsDTO();
        dto.setReportOptions(OM.readTree("{\"show_correct_answer\":\"hide\"}"));
        assertThatThrownBy(() -> AssessmentBasicDetailsManager.applyReportOptions(new Assessment(), dto))
                .isInstanceOfSatisfying(VacademyException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(org.springframework.http.HttpStatus.BAD_REQUEST));
    }
}
