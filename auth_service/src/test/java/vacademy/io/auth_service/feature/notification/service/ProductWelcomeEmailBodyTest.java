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

    @Test
    void listsTheVideoTutorialsUnderTheButton() {
        java.util.List<ProductWelcomeEmailBody.Link> videos = java.util.List.of(
                new ProductWelcomeEmailBody.Link("Start to finish", "https://gradewise.example/tutorials/", "2:04"),
                new ProductWelcomeEmailBody.Link("Create a test <fast>", "https://gradewise.example/tutorials/#create", null),
                new ProductWelcomeEmailBody.Link("Not a safe link", "javascript:alert(1)", "0:10"),
                new ProductWelcomeEmailBody.Link(" ", "https://gradewise.example/x", null));
        String html = ProductWelcomeEmailBody.build("Gradewise", "#D61C28", null, "Asha", "Sunrise Academy",
                "asha42", "p", "https://app.gradewise.example/login", null, null, videos);
        assertTrue(html.contains("Watch the video tutorials"));
        assertTrue(html.contains("Short videos that show each step in Gradewise."));
        assertTrue(html.contains("href=\"https://gradewise.example/tutorials/\"") && html.contains(">2:04<"));
        assertTrue(html.contains("Create a test &lt;fast&gt;"));
        assertFalse(html.contains("javascript:") || html.contains("Not a safe link"));
        assertFalse(html.contains("https://gradewise.example/x"));
        assertTrue(html.indexOf("Open Gradewise") < html.indexOf("Watch the video tutorials"), "videos come after the button");
    }

    @Test
    void noVideosMeansNoVideoSection() {
        assertFalse(mail("Asha", "Sunrise Academy", "p", "#D61C28", null).contains("Watch the video tutorials"));
        String onlyBad = ProductWelcomeEmailBody.build("Gradewise", "#D61C28", null, "Asha", "W", "u", "p", null, null,
                null, java.util.List.of(new ProductWelcomeEmailBody.Link("X", "http://plain.example", null)));
        assertFalse(onlyBad.contains("Watch the video tutorials"));
    }
}
