package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.StudentReportHtmlV2Builder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** report_options.student_fields: registration answers printed under the student's name. */
class ReportStudentFieldsTest {

    private static final ObjectMapper OM = new ObjectMapper();

    private static JsonNode json(String s) throws Exception {
        return OM.readTree(s);
    }

    @Test
    void validatesTheFieldList() throws Exception {
        ReportOptions.validate(json("{\"student_fields\":[\"Student Roll Number\",\"College\"]}"));
        ReportOptions.validate(json("{\"student_fields\":null}"));
        assertThatThrownBy(() -> ReportOptions.validate(json("{\"student_fields\":\"College\"}")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ReportOptions.validate(json("{\"student_fields\":[1]}")))
                .isInstanceOf(IllegalArgumentException.class);
        StringBuilder many = new StringBuilder("{\"student_fields\":[");
        for (int i = 0; i <= ReportOptions.MAX_STUDENT_FIELDS; i++) many.append(i == 0 ? "" : ",").append("\"f").append(i).append("\"");
        assertThatThrownBy(() -> ReportOptions.validate(json(many.append("]}").toString())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void cleansTheFieldList() throws Exception {
        assertThat(ReportOptions.studentFields(json("{\"student_fields\":[\" College \",\"college\",\"\",\"Roll No\"]}")))
                .containsExactly("College", "Roll No");
        assertThat(ReportOptions.studentFields(json("{\"show_explanation\":false}"))).isEmpty();
        assertThat(ReportOptions.studentFields(null)).isEmpty();
    }

    @Test
    void fieldsOnlyKeepsTheSwitchesOnTheInstituteDefault() throws Exception {
        JsonNode fieldsOnly = json("{\"student_fields\":[\"College\"]}");
        assertThat(ReportOptions.followsInstituteDefault(fieldsOnly)).isTrue();
        assertThat(ReportOptions.normalise(fieldsOnly)).isEqualTo(fieldsOnly);

        JsonNode both = json("{\"show_correct_answer\":false,\"student_fields\":[\"College\"]}");
        assertThat(ReportOptions.followsInstituteDefault(both)).isFalse();
        assertThat(ReportOptions.normalise(both)).isEqualTo(json(
                "{\"show_question_wise\":true,\"show_your_answer\":true,\"show_correct_answer\":false,"
                        + "\"show_explanation\":true,\"student_fields\":[\"College\"]}"));
    }

    @Test
    void normaliseKeepsTheOldMeaningOfObjectsWithoutFields() throws Exception {
        // {} has always meant "everything shown" for this assessment, not the institute default.
        assertThat(ReportOptions.normalise(json("{}"))).isEqualTo(ReportOptions.ALL.toJson());
        assertThat(ReportOptions.followsInstituteDefault(json("{}"))).isFalse();
        // An emptied field list with no switches goes back to null (institute default, nothing printed).
        assertThat(ReportOptions.normalise(json("{\"student_fields\":[]}"))).isNull();
        assertThat(ReportOptions.normalise(null)).isNull();
    }

    @Test
    void matchesByNameOrKeyIgnoringCaseAndPunctuation() {
        List<ReportStudentDetail.Answer> answers = List.of(
                new ReportStudentDetail.Answer("Full Name", "full_name", "Asha"),
                new ReportStudentDetail.Answer("Student Roll Number", "student_roll_number", " 1234 "),
                new ReportStudentDetail.Answer("Branch of Engineering", "branch_of_engineering", ""),
                new ReportStudentDetail.Answer("School/College", "school/college", "City College"));

        List<ReportStudentDetail> out = ReportStudentDetail.match(
                List.of("school college", "STUDENT ROLL NUMBER", "Branch of Engineering", "Not on this form"), answers);

        // Chosen order kept; the blank Branch answer and the missing field are skipped.
        assertThat(out).containsExactly(
                new ReportStudentDetail("School/College", "City College"),
                new ReportStudentDetail("Student Roll Number", "1234"));
        assertThat(ReportStudentDetail.match(List.of("student_roll_number"), answers))
                .containsExactly(new ReportStudentDetail("Student Roll Number", "1234"));
        assertThat(ReportStudentDetail.match(List.of(), answers)).isEmpty();
    }

    @Test
    void capsVeryLongAnswers() {
        String longAnswer = "x".repeat(300);
        List<ReportStudentDetail> out = ReportStudentDetail.match(List.of("Address"),
                List.of(new ReportStudentDetail.Answer("Address", "address", longAnswer)));
        assertThat(out.get(0).value()).hasSize(ReportStudentDetail.MAX_VALUE_LENGTH).endsWith("…");
    }

    @Test
    void theStudentReportPrintsTheChosenDetailsUnderTheName() {
        StudentReportHtmlV2Builder builder = new StudentReportHtmlV2Builder();
        org.springframework.test.util.ReflectionTestUtils.setField(builder, "reportBrandingHelper",
                org.mockito.Mockito.mock(vacademy.io.assessment_service.features.assessment.service.ReportBrandingHelper.class));
        String html = builder.build(StudentReportHtmlV2Builder.Input.builder()
                .assessmentName("Unit Test 3")
                .studentName("Asha Rao")
                .studentDetails(List.of(new ReportStudentDetail("Student Roll Number", "1234"),
                        new ReportStudentDetail("School/College", "A <b>&</b> B")))
                .build());
        assertThat(html).contains("Student Roll Number: <b").contains(">1234</b>")
                .contains("School/College: <b").contains("A &lt;b&gt;&amp;&lt;/b&gt; B");

        String without = builder.build(StudentReportHtmlV2Builder.Input.builder()
                .assessmentName("Unit Test 3").studentName("Asha Rao").build());
        assertThat(without).doesNotContain("Student Roll Number");
    }

    @Test
    void theAiReportPrintsThemOnTheFirstPageAndSendsThemToTheApp() {
        AiReportModel m = AiReportHtmlBuilderV2Test.model("Riya Verma", null, AiReportHtmlBuilderV2Test.ai()).toBuilder()
                .studentDetails(List.of(new ReportStudentDetail("Student Roll Number", "1234")))
                .build();
        assertThat(new AiReportHtmlBuilderV2().build(m)).contains("Student Roll Number: 1234");

        AiReportWebData d = AiReportWebData.from(m, new AiReportHtmlBuilderV2());
        assertThat(d.studentDetails()).containsExactly(new ReportStudentDetail("Student Roll Number", "1234"));
        JsonNode web = OM.valueToTree(d);
        assertThat(web.path("student_details").get(0).path("label").asText()).isEqualTo("Student Roll Number");
        assertThat(web.path("student_details").get(0).path("value").asText()).isEqualTo("1234");

        AiReportWebData none = AiReportWebData.from(
                AiReportHtmlBuilderV2Test.model("Riya Verma", null, AiReportHtmlBuilderV2Test.ai()), new AiReportHtmlBuilderV2());
        assertThat(none.studentDetails()).isEmpty();
    }
}
