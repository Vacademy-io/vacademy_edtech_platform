package vacademy.io.auth_service.feature.notification.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ProductWelcomeEmailBodyTest {

    private static String mail(String fullName, String workspace, String password, String theme, String logo) {
        return ProductWelcomeEmailBody.build("Gradewise", theme, logo, fullName, workspace, "asha42", password,
                "https://app.gradewise.example/login", "hello@gradewise.example", "https://gradewise.example");
    }

    @Test
    void welcomesThePersonToTheProductAndNamesTheirWorkspace() {
        String html = mail("Asha Verma", "Sunrise Academy", "s3cret", "#D61C28", "https://cdn.example/logo.png");
        assertTrue(html.contains("Welcome to Gradewise"));
        assertTrue(html.contains("Hi Asha Verma,"));
        assertTrue(html.contains("Sunrise Academy"));
        assertTrue(html.contains("asha42") && html.contains("s3cret"));
        assertTrue(html.contains("href=\"https://app.gradewise.example/login\""));
        assertTrue(html.contains("Open Gradewise"));
        assertTrue(html.contains("src=\"https://cdn.example/logo.png\""));
        assertTrue(html.contains("mailto:hello@gradewise.example") && html.contains(">gradewise.example<"));
        assertTrue(html.contains("#D61C28"));
        assertFalse(html.contains("{{"), "every placeholder is filled");
    }

    @Test
    void aWorkspaceNamedAfterThePersonIsNotRepeated() {
        String html = mail("Asha Verma", "asha verma", "s3cret", "#D61C28", null);
        assertFalse(html.contains("has been created"));
        assertTrue(html.contains("account is ready."));
    }

    @Test
    void noPasswordMeansNoPasswordRow() {
        String html = mail("Asha", "Sunrise Academy", null, "#D61C28", null);
        assertTrue(html.contains("Username"));
        assertFalse(html.contains("Password"));
    }

    @Test
    void withoutALogoTheProductInitialIsShown() {
        String html = mail("Asha", "Sunrise Academy", "p", "#D61C28", " ");
        assertFalse(html.contains("<img"));
        assertTrue(html.contains(">G</div>"));
    }

    @Test
    void anInvalidThemeFallsBackToANeutralColourNotAPlatformOne() {
        String html = mail("Asha", "Sunrise Academy", "p", "orange", null);
        assertTrue(html.contains("#111827"));
        assertFalse(html.contains("#E67E22"));
        assertFalse(html.toLowerCase().contains("vacademy"));
    }

    @Test
    void everythingTheUserTypedIsEscaped() {
        String html = mail("<script>x</script>", "A & B <i>", "p<w>", "#D61C28", null);
        assertFalse(html.contains("<script>"));
        assertTrue(html.contains("&lt;script&gt;"));
        assertTrue(html.contains("A &amp; B &lt;i&gt;"));
        assertTrue(html.contains("p&lt;w&gt;"));
    }

    @Test
    void noLoginUrlMeansNoButton() {
        String html = ProductWelcomeEmailBody.build("Gradewise", "#D61C28", null, "Asha", "Sunrise Academy",
                "asha42", "p", null, null, null);
        assertFalse(html.contains("Open Gradewise"));
        assertFalse(html.contains("mailto:"));
    }

    @Test
    void aLightThemeIsDarkenedSoTextStaysReadable() {
        String ink = ProductWelcomeEmailBody.readable("#FFE600", 4.5);
        assertTrue(ProductWelcomeEmailBody.contrastOnWhite(ink) >= 4.5);
    }
}
