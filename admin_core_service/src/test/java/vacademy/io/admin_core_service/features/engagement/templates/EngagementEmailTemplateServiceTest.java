package vacademy.io.admin_core_service.features.engagement.templates;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EngagementEmailTemplateServiceTest {

    private static final String BRIEF = "Evening classes at 6 PM. Join: https://ee.test/class";

    private EngagementEmailTemplateRepository repo;
    private EngagementEngineRepository engines;
    private EngagementEmailTemplateAdvisor advisor;
    private EngagementEmailTemplateService service;
    private EngagementEngine engine;

    @BeforeEach
    void setUp() {
        repo = mock(EngagementEmailTemplateRepository.class);
        engines = mock(EngagementEngineRepository.class);
        EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
        advisor = mock(EngagementEmailTemplateAdvisor.class);
        service = new EngagementEmailTemplateService(repo, engines, prompts, advisor);

        engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setName("Re-engage");
        engine.setLanguage("en");
        engine.setCreatedBy("admin-1");
        engine.setChannels("{\"EMAIL\":{\"enabled\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        EngagementPromptVersion pv = new EngagementPromptVersion();
        pv.setCompiledText(BRIEF);
        when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(pv));
        when(repo.save(any())).thenAnswer(inv -> {
            EngagementEmailTemplate t = inv.getArgument(0);
            if (t.getId() == null) t.setId("t-" + t.getName() + "-" + t.getVersion());
            return t;
        });
        when(repo.namesUsed("e1")).thenReturn(List.of("class_reminder"));
    }

    private static EngagementEmailTemplateAdvisor.Draft draft(String name, String subject, String body) {
        return new EngagementEmailTemplateAdvisor.Draft(name, "Title", "first touch", subject, null, body,
                List.of("first_name", "class_link"), List.of("Asha", "https://ee.test/class"),
                Map.of("first_name", "profile.firstName", "class_link", "brief.link.1"), "why");
    }

    private static final String BODY = "<p>Hi {{first_name}},</p><p>Class at 6 PM. <a href=\"{{class_link}}\">Join</a></p>";

    private EngagementEmailTemplate template(String id, String name, int version, String status) {
        EngagementEmailTemplate t = new EngagementEmailTemplate();
        t.setId(id);
        t.setEngineId("e1");
        t.setInstituteId("i1");
        t.setName(name);
        t.setVersion(version);
        t.setStatus(status);
        t.setSubject("Your class today");
        t.setBodyHtml(BODY);
        t.setVariableNames("[\"first_name\",\"class_link\"]");
        t.setSampleValues("[\"Asha\",\"https://ee.test/class\"]");
        t.setVariableSources("{\"first_name\":\"profile.firstName\",\"class_link\":\"brief.link.1\"}");
        when(repo.findByIdAndInstituteId(id, "i1")).thenReturn(Optional.of(t));
        return t;
    }

    @Test
    @DisplayName("generate keeps valid drafts, drops ones with a link not in the brief, and makes names unique")
    void generateValidatesAndNames() {
        when(advisor.propose(any(), anyString(), any(), anyString(), anyInt(), anyBoolean(), any(), any(), any()))
                .thenReturn(List.of(
                        draft("class_reminder", "Your class at 6 PM", BODY),
                        draft("bad_one", "Your class at 6 PM", BODY + "<p>https://evil.example.com</p>")));

        List<EngagementEmailTemplateService.View> out = service.generate("e1", "i1",
                new EngagementEmailTemplateService.GenerateRequest("first touch", 2, "en", null, null, "NEW"), "admin-1");

        assertEquals(1, out.size());
        assertEquals("class_reminder_2", out.get(0).name());
        assertEquals("AI_PROPOSED", out.get(0).status());
        assertFalse(EmailTemplateRules.hasBlocking(out.get(0).issues()));
    }

    @Test
    @DisplayName("generate fails clearly when every draft is invalid")
    void generateAllInvalid() {
        when(advisor.propose(any(), anyString(), any(), anyString(), anyInt(), anyBoolean(), any(), any(), any()))
                .thenReturn(List.of(draft("x", "", BODY)));
        VacademyException ex = assertThrows(VacademyException.class, () -> service.generate("e1", "i1",
                new EngagementEmailTemplateService.GenerateRequest(null, 1, null, null, null, null), "admin-1"));
        assertTrue(ex.getMessage().contains("subject is empty"), ex.getMessage());
    }

    @Test
    @DisplayName("regenerate replaces a draft: one new draft, the old one archived")
    void regenerateArchivesOld() {
        EngagementEmailTemplate old = template("t-old", "first_touch", 1, "AI_PROPOSED");
        when(advisor.propose(any(), anyString(), any(), anyString(), eq(1), anyBoolean(), anyString(), anyString(), any()))
                .thenReturn(List.of(draft("first_touch_v2", "Your class at 6 PM", BODY)));

        service.generate("e1", "i1", new EngagementEmailTemplateService.GenerateRequest(null, 3, "en", null, "t-old", "REGENERATE"), "a");
        assertEquals("ARCHIVED", old.getStatus());
    }

    @Test
    @DisplayName("an approved template can't be regenerated (it must be edited into a new version)")
    void regenerateApprovedRefused() {
        template("t-ok", "first_touch", 1, "APPROVED");
        assertThrows(VacademyException.class, () -> service.generate("e1", "i1",
                new EngagementEmailTemplateService.GenerateRequest(null, 1, "en", null, "t-ok", "REGENERATE"), "a"));
    }

    @Test
    @DisplayName("E9: editing an approved template creates the next version; the approved one stays as is")
    void E9_editApprovedCreatesNextVersion() {
        EngagementEmailTemplate approved = template("t-v1", "first_touch", 1, "APPROVED");
        when(repo.maxVersion("e1", "first_touch")).thenReturn(1);

        EngagementEmailTemplateService.View v = service.edit("t-v1", "i1",
                new EngagementEmailTemplateService.EditRequest(null, null, "Class moved to 7 PM", null, null, null, null, null), "a");

        assertEquals(2, v.version());
        assertEquals("USER_REVIEW", v.status());
        assertEquals("Class moved to 7 PM", v.subject());
        assertEquals("APPROVED", approved.getStatus());
        assertEquals("Your class today", approved.getSubject());
    }

    @Test
    @DisplayName("edit refuses a body that breaks the rules (E2 unknown placeholder)")
    void editRejectsBlocking() {
        template("t-d", "first_touch", 1, "USER_REVIEW");
        assertThrows(VacademyException.class, () -> service.edit("t-d", "i1",
                new EngagementEmailTemplateService.EditRequest(null, null, "Hi {{city}}", null, null, null, null, null), "a"));
    }

    @Test
    @DisplayName("approve retires the previously approved version of the same template")
    void approveSupersedesOld() {
        template("t-v2", "first_touch", 2, "USER_REVIEW");
        when(repo.approve(eq("t-v2"), eq("i1"), anyString(), any())).thenReturn(1);

        service.approve("t-v2", "i1", "admin-1");

        verify(repo).supersedeApproved(eq("e1"), eq("first_touch"), eq("t-v2"), any());
        verify(repo).approve(eq("t-v2"), eq("i1"), eq("admin-1"), any());
    }

    @Test
    @DisplayName("approve re-checks against the CURRENT brief (a removed link blocks approval)")
    void approveRechecksBrief() {
        EngagementEmailTemplate t = template("t-v3", "first_touch", 1, "USER_REVIEW");
        t.setBodyHtml(BODY + "<p>https://other.test/page</p>");
        assertThrows(VacademyException.class, () -> service.approve("t-v3", "i1", "admin-1"));
        verify(repo, never()).approve(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("catalog: render by name lists missing variables (E2 — never send 'Hi ,')")
    void catalogRenderMissing() {
        EngagementEmailTemplate t = template("t-a", "first_touch", 1, "APPROVED");
        when(repo.findFirstByEngineIdAndInstituteIdAndNameAndStatus("e1", "i1", "first_touch", "APPROVED"))
                .thenReturn(Optional.of(t));

        EngagementEmailTemplateCatalog.RenderedEmail r = service.render("e1", "i1", "first_touch",
                Map.of("first_name", "Asha")).orElseThrow();
        assertFalse(r.sendable());
        assertEquals(List.of("class_link"), r.missingVariables());

        EngagementEmailTemplateCatalog.RenderedEmail ok = service.render("e1", "i1", "first_touch",
                Map.of("first_name", "Asha", "class_link", "https://ee.test/class")).orElseThrow();
        assertTrue(ok.sendable());
        assertTrue(ok.html().contains("href=\"https://ee.test/class\""), ok.html());
        assertEquals("Your class today", ok.subject());
    }

    @Test
    @DisplayName("catalog: the brain sees approved templates with their placeholders intact")
    void catalogListsApproved() {
        EngagementEmailTemplate t = template("t-a", "first_touch", 1, "APPROVED");
        when(repo.findByEngineIdAndInstituteIdAndStatusOrderByNameAsc("e1", "i1", "APPROVED")).thenReturn(List.of(t));
        var opts = service.findApprovedEmailTemplates("e1", "i1");
        assertEquals(1, opts.size());
        assertEquals("first_touch", opts.get(0).name());
        assertTrue(opts.get(0).body().startsWith("SUBJECT: Your class today"));
        assertTrue(opts.get(0).body().contains("{{first_name}}"), opts.get(0).body());
    }

    @Test
    @DisplayName("the system AI-call engine has no engine templates")
    void systemEngineRefused() {
        engine.setCreatedBy(EngagementEngine.CREATED_BY_SYSTEM_AI_CALL);
        assertThrows(VacademyException.class, () -> service.generate("e1", "i1", null, "a"));
    }

    @Test
    @DisplayName("another institute's engine is refused")
    void otherInstitute() {
        assertThrows(VacademyException.class, () -> service.list("e1", "i2"));
    }

    @Test
    @DisplayName("E9: a second edit of the approved template updates the pending next version, not a new one")
    void E9_secondEditReusesPendingVersion() {
        template("t-v1", "first_touch", 1, "APPROVED");
        EngagementEmailTemplate pending = template("t-v2", "first_touch", 2, "USER_REVIEW");
        when(repo.findFirstByEngineIdAndInstituteIdAndNameAndStatusInOrderByVersionDesc(eq("e1"), eq("i1"), eq("first_touch"), any()))
                .thenReturn(Optional.of(pending));

        EngagementEmailTemplateService.View v = service.edit("t-v1", "i1",
                new EngagementEmailTemplateService.EditRequest(null, null, "Second edit", null, null, null, null, null), "a");

        assertEquals("t-v2", v.id());
        assertEquals(2, v.version());
        assertEquals("Second edit", pending.getSubject());
        verify(repo, never()).maxVersion(anyString(), anyString());
    }

    @Test
    @DisplayName("E9: an older version can't be approved over a newer approved one")
    void E9_olderVersionCantReplaceNewer() {
        template("t-v2", "first_touch", 2, "USER_REVIEW");
        EngagementEmailTemplate live = template("t-v3", "first_touch", 3, "APPROVED");
        when(repo.findFirstByEngineIdAndInstituteIdAndNameAndStatus("e1", "i1", "first_touch", "APPROVED"))
                .thenReturn(Optional.of(live));
        VacademyException ex = assertThrows(VacademyException.class, () -> service.approve("t-v2", "i1", "admin"));
        assertTrue(ex.getMessage().contains("v3"), ex.getMessage());
        verify(repo, never()).supersedeApproved(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("E7: once its link leaves the brief, an approved template is not offered to the brain and won't send")
    void E7_briefDriftAfterApproval() {
        EngagementEmailTemplate t = template("t-a", "first_touch", 1, "APPROVED");
        t.setBodyHtml("<p>Hi {{first_name}}, see https://ee.test/old-offer and {{class_link}}</p>");
        when(repo.findByEngineIdAndInstituteIdAndStatusOrderByNameAsc("e1", "i1", "APPROVED")).thenReturn(List.of(t));
        when(repo.findFirstByEngineIdAndInstituteIdAndNameAndStatus("e1", "i1", "first_touch", "APPROVED"))
                .thenReturn(Optional.of(t));

        assertTrue(service.findApprovedEmailTemplates("e1", "i1").isEmpty());
        EngagementEmailTemplateCatalog.RenderedEmail r = service.render("e1", "i1", "first_touch",
                Map.of("first_name", "Asha", "class_link", "https://ee.test/class")).orElseThrow();
        assertFalse(r.sendable());
        assertTrue(r.problems().get(0).contains("not in the engine brief"), r.problems().toString());
        assertTrue(r.missingVariables().isEmpty());
    }

    @Test
    void uniqueNames() {
        Set<String> taken = new HashSet<>(List.of("a", "a_2"));
        assertEquals("a_3", EngagementEmailTemplateService.uniqueName("A", taken));
        assertEquals("email_template", EngagementEmailTemplateService.uniqueName("!!!", new HashSet<>()));
        assertEquals("missed_class_reminder", EngagementEmailTemplateService.uniqueName("Missed Class-Reminder", new HashSet<>()));
    }
}
