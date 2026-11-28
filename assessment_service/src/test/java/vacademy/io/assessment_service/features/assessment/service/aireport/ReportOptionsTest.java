package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Report options (V69): what a student's report shows per question. */
class ReportOptionsTest {

    private static final ObjectMapper OM = new ObjectMapper();

    @Test
    void missingKeysMeanShown() throws Exception {
        assertThat(ReportOptions.fromJson(null)).isEqualTo(ReportOptions.ALL);
        assertThat(ReportOptions.fromJson(OM.readTree("{}"))).isEqualTo(ReportOptions.ALL);
        assertThat(ReportOptions.fromJson(OM.readTree("{\"show_correct_answer\":false}")))
                .isEqualTo(new ReportOptions(true, true, false, true));
    }

    @Test
    void theProfilesOlderQuestionWiseSwitchStillHidesTheSection() throws Exception {
        assertThat(ReportOptions.fromJson(OM.readTree("{\"question_wise\":\"HIDE\"}")).showQuestionWise()).isFalse();
        assertThat(ReportOptions.fromJson(OM.readTree("{\"question_wise\":\"SHOW\"}")).showQuestionWise()).isTrue();
    }

    @Test
    void refusesAnythingButBooleans() throws Exception {
        assertThatThrownBy(() -> ReportOptions.validate(OM.readTree("{\"show_correct_answer\":\"no\"}")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ReportOptions.validate(OM.readTree("[]")))
                .isInstanceOf(IllegalArgumentException.class);
        ReportOptions.validate(OM.readTree("{\"show_correct_answer\":false,\"unknown\":1}"));
        ReportOptions.validate(null);
    }

    @Test
    void roundTripsThroughJson() {
        ReportOptions o = new ReportOptions(true, false, false, true);
        assertThat(ReportOptions.fromJson(o.toJson())).isEqualTo(o);
    }

    @Test
    void stripsHiddenFieldsFromTheLearnerPayloadButKeepsTheRowsForStats() {
        StudentReportOverallDetailDto detail = detail();
        new ReportOptions(true, true, false, false).stripFrom(detail);
        StudentReportAnswerReviewDto row = detail.getAllSections().get("s1").get(0);
        assertThat(row.getCorrectOptions()).isNull();
        assertThat(row.getExplanation()).isNull();
        assertThat(row.getStudentResponseOptions()).isEqualTo("[\"a\"]");
        assertThat(row.getQuestionName()).isEqualTo("Q text");
        assertThat(detail.getReportOptions().path("show_correct_answer").asBoolean()).isFalse();

        StudentReportOverallDetailDto noQw = detail();
        new ReportOptions(false, true, true, true).stripFrom(noQw);
        StudentReportAnswerReviewDto r = noQw.getAllSections().get("s1").get(0);
        assertThat(r.getQuestionName()).isNull();
        assertThat(r.getStudentResponseOptions()).isNull();
        assertThat(r.getCorrectOptions()).isNull();
        assertThat(r.getAnswerStatus()).isEqualTo("INCORRECT");
        assertThat(r.getMark()).isEqualTo(-1.0);
    }

    private static StudentReportOverallDetailDto detail() {
        StudentReportAnswerReviewDto row = StudentReportAnswerReviewDto.builder()
                .questionId("q1").questionName("Q text").studentResponseOptions("[\"a\"]").correctOptions("[\"b\"]")
                .explanation("because").explanationId("e1").answerStatus("INCORRECT").mark(-1.0).build();
        StudentReportOverallDetailDto d = new StudentReportOverallDetailDto();
        d.setAllSections(Map.of("s1", new ArrayList<>(List.of(row))));
        return d;
    }
}
