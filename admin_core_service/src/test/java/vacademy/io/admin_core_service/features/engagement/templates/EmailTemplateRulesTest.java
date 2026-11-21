package vacademy.io.admin_core_service.features.engagement.templates;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EmailTemplateRulesTest {

    private static final String BRIEF = "Evening classes at 6 PM. Join here: https://ee.test/class. Fees in the PDF.";
    private static final Map<String, String> SRC = Map.of("first_name", "profile.firstName", "class_link", "brief.link.1");

    private static boolean has(List<EmailTemplateRules.Issue> issues, String code) {
        return issues.stream().anyMatch(i -> i.code().equals(code));
    }

    private static List<EmailTemplateRules.Issue> check(String subject, String body, boolean cold) {
        return EmailTemplateRules.check(subject, body, List.of("first_name", "class_link"), List.of("Asha", "https://ee.test/class"),
                SRC, BRIEF, cold);
    }

    private static final String GOOD_BODY = "<p>Hi {{first_name}},</p><p>Your class is at 6 PM. <a href=\"{{class_link}}\">Join</a></p>";

    @Test
    @DisplayName("a good template has no blocking issue")
    void goodTemplate() {
        assertFalse(EmailTemplateRules.hasBlocking(check("Your evening class today", GOOD_BODY, false)));
    }

    @Test
    void E1_subjectRules() {
        assertTrue(has(check("", GOOD_BODY, false), "E1_SUBJECT_EMPTY"));
        assertTrue(EmailTemplateRules.hasBlocking(check("", GOOD_BODY, false)));
        assertTrue(has(check("JOIN OUR FREE CLASS TODAY", GOOD_BODY, false), "E1_SUBJECT_CAPS"));
        assertTrue(has(check("Class today!!", GOOD_BODY, false), "E1_SUBJECT_PUNCT"));
        assertTrue(has(check("Hi", GOOD_BODY, false), "E1_SUBJECT_WORDS"));
        assertTrue(has(check("x".repeat(151), GOOD_BODY, false), "E1_SUBJECT_LONG"));
    }

    @Test
    void E2_placeholders() {
        assertTrue(has(check("Hello {{city}}", GOOD_BODY, false), "E2_UNKNOWN_PLACEHOLDER"));
        assertTrue(has(check("Your class today", GOOD_BODY + "<p>{{ 1 }}</p>", false), "E2_BAD_PLACEHOLDER"));
        List<EmailTemplateRules.Issue> unused = EmailTemplateRules.check("Your class today", "<p>Hello there friend</p>",
                List.of("first_name"), List.of("Asha"), Map.of("first_name", "profile.firstName"), BRIEF, false);
        assertTrue(has(unused, "VAR_UNUSED"));
        assertFalse(EmailTemplateRules.hasBlocking(unused));
        List<EmailTemplateRules.Issue> samples = EmailTemplateRules.check("Your class today", GOOD_BODY,
                List.of("first_name", "class_link"), List.of("Asha"), SRC, BRIEF, false);
        assertTrue(has(samples, "VAR_SAMPLES"));
    }

    @Test
    void E3_sanitiseRemovesScriptsButKeepsPlaceholderLinks() {
        String dirty = "<p onclick=\"steal()\">Hi {{first_name}}</p><script>alert(1)</script>"
                + "<a href=\"{{class_link}}\">Join</a><a href=\"javascript:alert(1)\">x</a><img src=\"http://x.test/a.png\">";
        String clean = EmailTemplateRules.sanitise(dirty);
        assertFalse(clean.contains("script"), clean);
        assertFalse(clean.contains("onclick"), clean);
        assertFalse(clean.contains("javascript"), clean);
        assertFalse(clean.contains("http://x.test"), clean);
        assertTrue(clean.contains("href=\"{{class_link}}\""), clean);
        assertTrue(clean.contains("Hi {{first_name}}"), clean);
    }

    @Test
    void E4_coldOutreachNeedsUnsubscribe() {
        assertTrue(has(check("Your class today", GOOD_BODY, true), "E4_NO_UNSUBSCRIBE"));
        assertFalse(has(check("Your class today", GOOD_BODY + "<p>Reply STOP to unsubscribe.</p>", true), "E4_NO_UNSUBSCRIBE"));
        assertFalse(has(check("Your class today", GOOD_BODY, false), "E4_NO_UNSUBSCRIBE"));
    }

    @Test
    void E7_linksMustBeInTheBrief() {
        assertTrue(has(check("Your class today", GOOD_BODY + "<p>See https://evil.example.com/x</p>", false), "E7_LINK_NOT_IN_BRIEF"));
        assertTrue(has(check("Your class today", GOOD_BODY + "<p>Visit freecourses.com now</p>", false), "E7_LINK_NOT_IN_BRIEF"));
        assertFalse(has(check("Your class today", GOOD_BODY + "<p>Or open https://ee.test/class</p>", false), "E7_LINK_NOT_IN_BRIEF"));
        assertFalse(has(check("Your class today", GOOD_BODY + "<p>Write to office@school.in</p>", false), "E7_LINK_NOT_IN_BRIEF"));
    }

    @Test
    void W14_linkVariableMustComeFromTheBrief() {
        List<EmailTemplateRules.Issue> issues = EmailTemplateRules.check("Your class today", GOOD_BODY,
                List.of("first_name", "class_link"), List.of("Asha", "x"),
                Map.of("first_name", "profile.firstName", "class_link", "ai"), BRIEF, false);
        assertTrue(has(issues, "VAR_SOURCE"));
    }

    @Test
    void E2_renderEscapesAndListsMissing() {
        EmailTemplateRules.Rendered r = EmailTemplateRules.render("Hi {{first_name}}", GOOD_BODY,
                List.of("first_name", "class_link"), Map.of("first_name", "<b>Asha</b> {{class_link}}"));
        assertEquals(List.of("class_link"), r.missing());
        assertTrue(r.html().contains("&lt;b&gt;Asha&lt;/b&gt; {{class_link}}"), r.html());
        assertEquals("Hi <b>Asha</b> {{class_link}}", r.subject());
        assertFalse(r.text().contains("<p>"));
    }

    @Test
    void sourcesResolvePerPerson() {
        ObjectNode profile = new ObjectMapper().createObjectNode().put("name", "Asha Verma");
        profile.putObject("formAnswers").put("course", "NEET");
        TemplateVariableSources.Resolved r = TemplateVariableSources.resolve(
                List.of("first_name", "course", "class_link", "line", "bad_line"),
                Map.of("first_name", "profile.firstName", "course", "form.course", "class_link", "brief.link.1",
                        "line", "ai", "bad_line", "ai"),
                Map.of("profile", profile), TemplateVariableSources.briefLinks(BRIEF),
                Map.of("line", "Hope the mock test went well.", "bad_line", "Visit https://evil.example.com"));
        assertEquals("Asha", r.values().get("first_name"));
        assertEquals("NEET", r.values().get("course"));
        assertEquals("https://ee.test/class", r.values().get("class_link"));
        assertEquals("Hope the mock test went well.", r.values().get("line"));
        assertEquals(List.of("bad_line"), r.missing());
    }

    @Test
    void sourceProblems() {
        List<String> links = TemplateVariableSources.briefLinks(BRIEF);
        assertEquals(1, links.size());
        assertTrue(TemplateVariableSources.problems(List.of("a"), Map.of(), links).get(0).contains("no source"));
        assertTrue(TemplateVariableSources.problems(List.of("a"), Map.of("a", "db.password"), links).get(0).contains("unknown source"));
        assertTrue(TemplateVariableSources.problems(List.of("a"), Map.of("a", "brief.link.3"), links).get(0).contains("brief link 3"));
        assertTrue(TemplateVariableSources.problems(List.of("a"), Map.of("a", "static:see https://x.test"), links).get(0).contains("fixed value with a link"));
        assertTrue(TemplateVariableSources.problems(List.of("a"), Map.of("a", "static:Team EE"), links).isEmpty());
    }
}
