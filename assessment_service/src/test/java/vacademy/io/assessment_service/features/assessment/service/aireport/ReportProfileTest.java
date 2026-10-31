package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Report profiles: banded values (scholarships) and the template language. */
class ReportProfileTest {

    private static final ObjectMapper OM = new ObjectMapper();

    // 0 below 40%, otherwise the percentage itself, rounded down, never above 100.
    private static final String SCHOLARSHIP = """
            {"basis":"percentage","round":"DOWN","max":100,
             "bands":[{"from":-1000,"to":40,"value":0},{"from":40,"to":100,"value":"percentage"}]}""";

    private static Double scholarship(double percentage) throws Exception {
        JsonNode spec = OM.readTree(SCHOLARSHIP);
        return ReportComposer.evaluate(spec, Map.of("percentage", percentage, "score", 0.0));
    }

    @Test
    void scholarshipIsZeroBelowFortyAndThePercentageFromFortyUp() throws Exception {
        assertThat(scholarship(-5)).isEqualTo(0.0);
        assertThat(scholarship(39.99)).isEqualTo(0.0);
        assertThat(scholarship(40)).isEqualTo(40.0);
        assertThat(scholarship(80.6)).isEqualTo(80.0);
        assertThat(scholarship(100)).isEqualTo(100.0);
        assertThat(scholarship(102.04)).isNull(); // above every band: shown blank, never invented
    }

    @Test
    void templatesFillValuesLoopsAndConditionsAndEscapeText() {
        String tpl = "{{#has_x}}Won {{x}}%{{/has_x}}{{^has_x}}Not eligible{{/has_x}} | "
                + "{{#sections}}[{{name}} {{marks}}/{{max}}]{{/sections}} | {{student_name}} | {{{raw}}} | {{asset.logo}}";
        Map<String, Object> ctx = Map.of(
                "has_x", true, "x", "70",
                "sections", List.of(Map.of("name", "Physics", "marks", "12.5", "max", "12.5"),
                        Map.of("name", "Maths", "marks", "31.5", "max", "37.5")),
                "student_name", "A <b>",
                "raw", "<svg/>",
                "asset", Map.of("logo", "data:image/png;base64,AA"));
        assertThat(ReportTemplateEngine.render(tpl, ctx)).isEqualTo(
                "Won 70% | [Physics 12.5/12.5][Maths 31.5/37.5] | A &lt;b&gt; | <svg/> | data:image/png;base64,AA");
        assertThat(ReportTemplateEngine.render("{{#has_x}}Won{{/has_x}}{{^has_x}}Not eligible{{/has_x}}", Map.of("has_x", false)))
                .isEqualTo("Not eligible");
    }

    @Test
    void qrCodeIsDrawnAsSquares() {
        String svg = ReportComposer.qrSvg("https://example.com/register", 128);
        assertThat(svg).startsWith("<svg").contains("fill=\"#000000\"").endsWith("</svg>");
    }
}
