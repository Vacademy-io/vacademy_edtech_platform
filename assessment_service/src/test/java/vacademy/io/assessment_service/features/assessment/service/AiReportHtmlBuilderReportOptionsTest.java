package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.assessment_service.features.assessment.service.aireport.ReportOptions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The older AI report layout (learner /ai-pdf fallback) follows the report options too. */
class AiReportHtmlBuilderReportOptionsTest {

    private static final String JSON = """
            {"misconception_analysis":[{"question_summary":"Lens formula sign","student_answer":"+10 cm",
              "correct_answer":"-10 cm","misconception":"Sign convention mixed up.","remediation":"Draw the ray diagram."}]}
            """;

    private AiReportHtmlBuilder builder() {
        ReportBrandingHelper branding = mock(ReportBrandingHelper.class);
        when(branding.buildHeaderHtml(any(), anyString(), anyString(), anyString(), any())).thenReturn("");
        when(branding.buildFooterHtml(any(), anyString())).thenReturn("");
        return new AiReportHtmlBuilder(new ObjectMapper(), mock(AiReportChartGenerator.class), branding, mock(HtmlBuilderService.class));
    }

    @Test
    void defaultOutputIsUnchanged() {
        AiReportHtmlBuilder b = builder();
        String old = b.generateAiReportHtml("Test", JSON, null, null);
        assertThat(old).contains("Your Answer:</b> +10 cm", "Correct:</b> -10 cm", "Sign convention mixed up.");
        assertThat(b.generateAiReportHtml("Test", JSON, null, null, ReportOptions.ALL)).isEqualTo(old);
    }

    @Test
    void hiddenAnswersAreLeftOut() {
        String html = builder().generateAiReportHtml("Test", JSON, null, null, new ReportOptions(true, true, false, true));
        assertThat(html).contains("Your Answer:</b> +10 cm", "Sign convention mixed up.").doesNotContain("-10 cm", "Correct:</b>");

        String none = builder().generateAiReportHtml("Test", JSON, null, null, new ReportOptions(true, false, false, true));
        assertThat(none).doesNotContain("+10 cm", "-10 cm", "Your Answer:", "Correct:</b>").contains("Sign convention mixed up.");
    }
}
