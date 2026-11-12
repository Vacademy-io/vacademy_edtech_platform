package vacademy.io.notification_service.features.email_otp.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OtpEmailBodyTest {

    @Test
    void presetThemeIsPaintedAsHexAndCodeIsShown() {
        String html = OtpEmailBody.build("Example Academy", "primary", "482913", null, "hi@example.com", null);
        assertTrue(html.contains(">482913</div>"));
        assertTrue(html.contains("background:#ED7424"));
        assertFalse(html.contains("primary;"), "raw preset code must never reach CSS");
        assertFalse(html.contains("{{"), "no placeholder left behind");
    }

    @Test
    void blankThemeFallsBackToTheAppDefault() {
        String html = OtpEmailBody.build("Example Academy", "", "111111", null, null, null);
        assertTrue(html.contains("background:#ED7424"));
    }

    @Test
    void noWebsiteMeansNoWebsiteLineAndNoPlatformUrl() {
        String html = OtpEmailBody.build("Example Academy", "blue", "111111", null, "hi@example.com", null);
        assertFalse(html.contains("vacademy"));
        assertTrue(html.contains("mailto:hi@example.com"));
    }

    @Test
    void websiteWithoutSchemeGetsHttpsHref() {
        String html = OtpEmailBody.build("Example Academy", "blue", "111111", null, null, "example.com/");
        assertTrue(html.contains("href=\"https://example.com/\""));
        assertTrue(html.contains(">example.com</a>"));
    }

    @Test
    void logoUrlGivesImageOtherwiseInitialTile() {
        String withLogo = OtpEmailBody.build("Example Academy", "blue", "1", "https://cdn.example.com/l.png", null, null);
        assertTrue(withLogo.contains("<img src=\"https://cdn.example.com/l.png\""));
        String noLogo = OtpEmailBody.build("example Academy", "blue", "1", null, null, null);
        assertFalse(noLogo.contains("<img"));
        assertTrue(noLogo.contains(">E</div>"));
    }

    @Test
    void institutionTextIsEscaped() {
        String html = OtpEmailBody.build("A <b>&</b> B's", "blue", "1", null, null, null);
        assertTrue(html.contains("A &lt;b&gt;&amp;&lt;/b&gt; B&#39;s"));
        assertFalse(html.contains("<b>&</b>"));
    }

    @Test
    void lightThemesAreDarkenedUntilReadable() {
        // amber on white is ~1.9:1; small text must reach 4.5:1 and the large code 3:1
        assertTrue(OtpEmailBody.contrastOnWhite("#FFB300") < 3.0);
        assertTrue(OtpEmailBody.contrastOnWhite(OtpEmailBody.readable("#FFB300", 4.5)) >= 4.5);
        assertTrue(OtpEmailBody.contrastOnWhite(OtpEmailBody.readable("#FFB300", 3.0)) >= 3.0);
        // a dark theme is left exactly as the institute chose it
        String navy = "#1A237E";
        assertTrue(OtpEmailBody.readable(navy, 4.5).equals(navy));
    }

    @Test
    void codeCanBeSelectedInOneTap() {
        String html = OtpEmailBody.build("Example Academy", "blue", "482913", null, null, null);
        assertTrue(html.contains("user-select:all"));
    }
}
