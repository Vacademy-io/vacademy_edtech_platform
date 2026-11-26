package vacademy.io.auth_service.feature.notification.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class LearnerEnrollmentEmailBodyTest {

    private static String mail(String theme, String logo, String name, String password, String support,
            boolean returning) {
        return LearnerEnrollmentEmailBody.build("Sunrise Academy", theme, logo, name, "asha@example.com", password,
                "https://learn.sunrise.example", support, returning);
    }

    @Test
    void aNewLearnerIsWelcomedWithTheirSignInDetails() {
        String html = mail("primary", "https://cdn.example/logo.png", "Asha", "s3cret", "help@sunrise.example", false);
        assertTrue(html.contains("You're enrolled!"));
        assertTrue(html.contains("Hi Asha,"));
        assertTrue(html.contains("Welcome to <b"));
        assertTrue(html.contains("learner account is ready"));
        assertTrue(html.contains("asha@example.com") && html.contains("s3cret"));
        assertTrue(html.contains(">Start learning</a>"));
        assertTrue(html.contains("href=\"https://learn.sunrise.example\""));
        assertTrue(html.contains(">learn.sunrise.example</a>"));
        assertTrue(html.contains("src=\"https://cdn.example/logo.png\""));
        assertTrue(html.contains("mailto:help@sunrise.example"));
        assertFalse(html.contains("existing account"));
        assertFalse(html.contains("previously created"));
        assertFalse(html.contains("{{"), "every placeholder is filled");
    }

    @Test
    void aReturningLearnerIsToldTheCourseWasAddedToTheirAccount() {
        String html = mail("primary", null, "Asha", "s3cret", null, true);
        assertTrue(html.contains("enrolled in a new course at"));
        assertTrue(html.contains("existing account"));
        assertTrue(html.contains(">Continue learning</a>"));
        assertFalse(html.contains("Start learning"));
        assertFalse(html.contains("{{"));
    }

    @Test
    void themePresetIsPaintedAsItsHex() {
        assertTrue(mail("primary", null, "Asha", "x", null, false).contains("#ED7424"));
        assertTrue(mail("#1E88E5", null, "Asha", "x", null, false).contains("#1E88E5"));
    }

    @Test
    void noThemeIsNeutralNotABrandColour() {
        String html = mail(null, null, "Asha", "x", null, false);
        assertTrue(html.contains(ThemeColorResolver.NEUTRAL));
        assertFalse(html.contains("#ED7424"));
    }

    @Test
    void noLogoShowsTheInstituteInitialAndName() {
        String html = mail("primary", null, "Asha", "x", null, false);
        assertFalse(html.contains("<img"));
        assertTrue(html.contains(">S</div>"));
    }

    @Test
    void aLogoThatIsNotAWebUrlIsLeftOut() {
        String html = mail("primary", "javascript:alert(1)", "Asha", "x", null, false);
        assertFalse(html.contains("<img"));
        assertFalse(html.contains("javascript:"));
    }

    @Test
    void missingPasswordNameAndSupportAreLeftOut() {
        String html = mail("primary", null, null, null, null, true);
        assertTrue(html.contains("Hi,"));
        assertTrue(html.contains("asha@example.com"));
        assertFalse(html.contains(">Password<"));
        assertFalse(html.contains("N/A"));
        assertFalse(html.contains("mailto:"));
    }

    @Test
    void noLoginUrlMeansNoButton() {
        String html = LearnerEnrollmentEmailBody.build("Sunrise Academy", "primary", null, "Asha", "asha", "x", null, null, false);
        assertFalse(html.contains("Start learning"));
        assertFalse(html.contains("or open"));
    }

    @Test
    void everyValueIsEscapedAndFilledOnce() {
        String html = LearnerEnrollmentEmailBody.build("A&B <Academy> {{ink}}", "primary", null,
                "<script>x</script>", "user<1>", "p\"w", "https://a.example/?q=1&r=2", "a@b.example", false);
        assertFalse(html.contains("<script>"));
        assertTrue(html.contains("&lt;script&gt;"));
        assertTrue(html.contains("A&amp;B &lt;Academy&gt; {{ink}}"), "a value is never filled in a second time");
        assertTrue(html.contains("user&lt;1&gt;"));
        assertTrue(html.contains("p&quot;w"));
        assertTrue(html.contains("href=\"https://a.example/?q=1&amp;r=2\""));
    }
}
