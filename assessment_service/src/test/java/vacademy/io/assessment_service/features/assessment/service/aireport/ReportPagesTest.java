package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.URL;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Step 1 "Report pages": the request check, the simple-editor values and the no-network rule. */
class ReportPagesTest {

    private static final ObjectMapper OM = new ObjectMapper();
    private static final String PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    private static JsonNode json(String s) throws Exception {
        return OM.readTree(s);
    }

    @Test
    void acceptsTheThreeModes() throws Exception {
        ReportProfileService.validatePagesRequest(json("{\"mode\":\"DEFAULT\"}"));
        ReportProfileService.validatePagesRequest(json("{\"mode\":\"NONE\"}"));
        ReportProfileService.validatePagesRequest(json("{\"mode\":\"CUSTOM\",\"config\":{\"before\":[{\"type\":\"TEMPLATE\",\"name\":\"Letter\",\"html\":\"<p>Hi {{student_name}}</p>\"}],"
                + "\"after\":[{\"type\":\"PDF\",\"file_id\":\"f1\"},{\"type\":\"IMAGE\",\"file_id\":\"f2\"}],"
                + "\"assets\":{\"signature\":\"" + PNG + "\"},\"qr_url\":\"https://example.com\",\"result_date\":\"17 October 2026\","
                + "\"variables\":{\"scholarship_percent\":{\"basis\":\"percentage\",\"bands\":[]}}}}"));
    }

    @Test
    void refusesBadRequests() {
        for (String bad : new String[]{
                "[]",
                "{\"mode\":\"OTHER\"}",
                "{\"mode\":\"CUSTOM\"}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"before\":[{\"type\":\"TEMPLATE\",\"html\":\"\"}]}}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"after\":[{\"type\":\"PDF\"}]}}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"assets\":{\"Bad Key\":\"" + PNG + "\"}}}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"assets\":{\"logo\":\"https://example.com/a.png\"}}}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"qr_url\":\"javascript:alert(1)\"}}",
                "{\"mode\":\"CUSTOM\",\"config\":{\"variables\":[]}}"}) {
            assertThatThrownBy(() -> ReportProfileService.validatePagesRequest(json(bad)))
                    .as(bad).isInstanceOf(IllegalArgumentException.class);
        }
        StringBuilder many = new StringBuilder("{\"mode\":\"CUSTOM\",\"config\":{\"after\":[");
        for (int i = 0; i <= ReportProfileService.MAX_PAGES; i++) many.append(i == 0 ? "" : ",").append("{\"type\":\"PDF\",\"file_id\":\"f\"}");
        assertThatThrownBy(() -> ReportProfileService.validatePagesRequest(json(many.append("]}}").toString())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void namesACopyAfterTheAssessment() {
        assertThat(ReportProfileService.pagesProfileName("Class 9 Mock")).isEqualTo("Class 9 Mock - report pages");
        assertThat(ReportProfileService.pagesProfileName(" ")).isEqualTo("Assessment - report pages");
    }

    @Test
    void theSimpleEditorGetsReadyMadeBlocks() throws Exception {
        AiReportModel m = AiReportHtmlBuilderV2Test.model("Riya Verma", null, AiReportHtmlBuilderV2Test.ai()).toBuilder()
                .studentDetails(List.of(new ReportStudentDetail("Student Roll Number", "1234"),
                        new ReportStudentDetail("School/College", "City <College>")))
                .build();
        ReportProfileService.Profile p = new ReportProfileService.Profile(null, "inst", "Preview",
                json("{\"assets\":{\"signature\":\"" + PNG + "\"}}"), false);
        Map<String, Object> ctx = new ReportComposer(null, null).context(m, p);

        assertThat((String) ctx.get("sections_table")).startsWith("<table").contains("Section").contains("Marks");
        assertThat(ctx.get("student_details")).isEqualTo("Student Roll Number: 1234 · School/College: City <College>");
        String rendered = ReportTemplateEngine.render(
                "{{detail.student_roll_number}}|{{detail.school_college}}|{{{asset_img.signature}}}|{{student_details}}", ctx);
        assertThat(rendered).startsWith("1234|City &lt;College&gt;|<img src=\"data:image/png;base64,")
                .endsWith("School/College: City &lt;College&gt;");
        assertThat(ReportComposer.detailKey("School / College")).isEqualTo("school_college");
    }

    @Test
    void writtenPagesNeverFetchFromTheNetwork() throws Exception {
        assertThat(ReportComposer.NO_NETWORK.getByteArrayByUrl(new URL("http://169.254.169.254/latest/meta-data"))).isNull();
        assertThat(ReportComposer.NO_NETWORK.getInputStreamByUrl(new URL("https://example.com/a.png"))).isNull();

        AiReportModel m = AiReportHtmlBuilderV2Test.model("Riya Verma", null, AiReportHtmlBuilderV2Test.ai());
        ReportComposer composer = new ReportComposer(null, new AiReportFonts());
        long start = System.currentTimeMillis();
        byte[] pdf = composer.renderTemplate("<p>{{student_name}}</p><img src=\"http://10.255.255.1/x.png\"/><img src=\"" + PNG + "\"/>",
                m, null);
        assertThat(new String(pdf, 0, 5)).isEqualTo("%PDF-");
        // An unroutable address would hang for the connect timeout if anything tried it.
        assertThat(System.currentTimeMillis() - start).isLessThan(5000);
    }

    @Test
    void theAuditLogGetsASummaryNotThePages() throws Exception {
        JsonNode summary = vacademy.io.assessment_service.features.assessment.manager.AssessmentBasicDetailsManagerTestAccess
                .summary(json("{\"mode\":\"CUSTOM\",\"config\":{\"before\":[{\"type\":\"TEMPLATE\",\"html\":\"x\"}],"
                        + "\"after\":[{\"type\":\"PDF\",\"data_uri\":\"data:application/pdf;base64,AAAA\"}]}}"), "p1");
        assertThat(summary).isEqualTo(json("{\"mode\":\"CUSTOM\",\"profile_id\":\"p1\",\"pages_before\":1,\"pages_after\":1}"));
    }

    @Test
    void simpleEditorPagesGetMarginsDesignedPagesKeepTheirLayout() throws Exception {
        Map<String, Object> ctx = Map.of("student_name", "Asha");
        assertThat(ReportComposer.templateBody(json("{\"type\":\"TEMPLATE\",\"editor\":\"simple\",\"html\":\"<p>{{student_name}}</p>\"}"), ctx))
                .startsWith("<div style=\"padding:48px 56px;").endsWith("<p>Asha</p></div>");
        assertThat(ReportComposer.templateBody(json("{\"type\":\"TEMPLATE\",\"html\":\"<p>{{student_name}}</p>\"}"), ctx))
                .isEqualTo("<p>Asha</p>");
    }
}
