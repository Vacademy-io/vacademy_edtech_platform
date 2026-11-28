package vacademy.io.assessment_service.features.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import vacademy.io.assessment_service.features.assessment.service.ThemeColorResolver;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.endsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Downloaded reports (AI report, student report, admin and learner side) take their colour from
 * report branding, else from the institute's app theme. The theme is stored as a preset name, so
 * it must reach the report builders as "#RRGGBB" or they all fall back to their default colour.
 */
class ReportBrandingThemeTest {

    private static AdminCoreServiceClient client(String settingJson, String instituteJson) {
        InternalClientUtils http = mock(InternalClientUtils.class);
        when(http.makeHmacRequest(any(), any(), any(), contains("settingKey=ASSESSMENT_SETTING"), any()))
                .thenReturn(ResponseEntity.ok(settingJson));
        when(http.makeHmacRequest(any(), any(), any(), endsWith("/institute/v1/inst-1"), any()))
                .thenReturn(ResponseEntity.ok(instituteJson));
        return new AdminCoreServiceClient(http, new ObjectMapper());
    }

    @Test
    void presetThemeNameBecomesTheReportColour() {
        var b = client("{\"reportBranding\":{\"primary_color\":\"#FF6B35\"}}", "{\"institute_theme_code\":\"blue\"}")
                .getReportBranding("inst-1");
        assertThat(b.getPrimaryColor()).isEqualTo("#1E88E5");
    }

    @Test
    void defaultOrangeThemeAndCamelCaseResponse() {
        var b = client("{}", "{\"instituteThemeCode\":\"primary\"}").getReportBranding("inst-1");
        assertThat(b.getPrimaryColor()).isEqualTo("#ED7424");
    }

    @Test
    void hexThemeCodeIsNormalised() {
        var b = client("{}", "{\"institute_theme_code\":\"1d3b8f\"}").getReportBranding("inst-1");
        assertThat(b.getPrimaryColor()).isEqualTo("#1D3B8F");
    }

    @Test
    void colourChosenInReportBrandingWins() {
        var b = client("{\"reportBranding\":{\"primary_color\":\"#123456\"}}", "{\"institute_theme_code\":\"blue\"}")
                .getReportBranding("inst-1");
        assertThat(b.getPrimaryColor()).isEqualTo("#123456");
    }

    @Test
    void unknownThemeCodeIsNotPassedOnAsAColour() {
        var b = client("{\"reportBranding\":{\"primary_color\":\"#FF6B35\"}}", "{\"institute_theme_code\":\"sunset-glow\"}")
                .getReportBranding("inst-1");
        assertThat(b.getPrimaryColor()).isEqualTo("#FF6B35");
    }

    @Test
    void resolverCoversEveryAppPreset() {
        assertThat(ThemeColorResolver.resolve("Indigo")).isEqualTo("#3949AB");
        assertThat(ThemeColorResolver.resolve("#abc")).isEqualTo("#AABBCC");
        assertThat(ThemeColorResolver.resolve("#1e88e5ff")).isEqualTo("#1E88E5");
        assertThat(ThemeColorResolver.resolve("  ")).isNull();
        assertThat(ThemeColorResolver.resolve(null)).isNull();
        assertThat(ThemeColorResolver.resolve("not-a-colour")).isNull();
    }
}
