package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateAlternativesRequest;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.templates.WhatsAppTemplateRules;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A6: WhatsApp "Generate with AI" upgrade — W3/W4 rules, regenerate / more like this, sources, W12. */
class EngagementWhatsAppTemplateUpgradeTest {

    private static final String BRIEF = "Class reminders for evening batches. Join: https://ee.test/class";
    private final ObjectMapper om = new ObjectMapper();
    private EngagementTemplateProposalRepository proposals;
    private EngagementInternalClients clients;
    private EngagementTemplateAdvisor advisor;
    private EngagementTemplateProposalService service;

    @BeforeEach
    void setUp() {
        proposals = mock(EngagementTemplateProposalRepository.class);
        clients = mock(EngagementInternalClients.class);
        advisor = mock(EngagementTemplateAdvisor.class);
        EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
        service = new EngagementTemplateProposalService(proposals, engines, prompts, advisor, clients);

        EngagementEngine engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setName("Reminders");
        engine.setLanguage("en");
        engine.setStatus("ACTIVE");
        engine.setCreatedBy("admin-1");
        engine.setChannels("{\"WHATSAPP\":{\"enabled\":true}}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        EngagementPromptVersion pv = new EngagementPromptVersion();
        pv.setCompiledText(BRIEF);
        when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(pv));
        when(proposals.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(proposals.findByEngineIdAndInstituteIdOrderByRoundDescCreatedAtDesc("e1", "i1")).thenReturn(List.of());
    }

    private EngagementTemplateProposal proposal(String id, String status) {
        EngagementTemplateProposal p = new EngagementTemplateProposal();
        p.setId(id);
        p.setEngineId("e1");
        p.setInstituteId("i1");
        p.setName("class_reminder_ab12cd");
        p.setLanguage("hi");
        p.setPurpose("class reminder");
        p.setProposedBody("Hi {{1}}, your class starts at {{2}} today.");
        p.setProposedCategory("UTILITY");
        p.setVariableNames("[\"name\",\"time\"]");
        p.setSampleValues("[\"Asha\",\"6 PM\"]");
        p.setStatus(status);
        p.setNotificationTemplateId("tpl-" + id);
        when(proposals.findByIdAndInstituteId(id, "i1")).thenReturn(Optional.of(p));
        return p;
    }

    @Test
    void W3_W4_metaBodyRules() {
        assertNull(WhatsAppTemplateRules.problem("Hi {{1}}, your class starts at {{2}} today.", null));
        assertTrue(WhatsAppTemplateRules.problem("{{1}}, your class starts today.", null).contains("start with a variable"));
        assertTrue(WhatsAppTemplateRules.problem("Your class starts at {{1}}", null).contains("end with a variable"));
        assertTrue(WhatsAppTemplateRules.problem("Hi {{1}} {{2}} see you at class", null).contains("next to each other"));
        assertTrue(WhatsAppTemplateRules.problem("Hi {{1}}, at {{2}} ok.", null).contains("too many variables"));
        assertTrue(WhatsAppTemplateRules.problem("x".repeat(1025), null).contains("1024"));
        assertTrue(WhatsAppTemplateRules.problem("Hi there friend.", "y".repeat(61)).contains("footer"));
        assertTrue(WhatsAppTemplateRules.problem("Hi there\n\n\nfriend.", null).contains("line breaks"));
    }

    @Test
    @DisplayName("AI drafts that break Meta's body rules are dropped before a human sees them")
    void generateDropsRuleBreakers() {
        when(advisor.propose(any(), anyString(), any(), anyList(), anyInt(), any(), any(), any())).thenReturn(List.of(
                new EngagementTemplateAdvisor.Proposal("good", "Hi {{1}}, your class starts at {{2}} today.",
                        List.of("name", "time"), List.of("Asha", "6 PM"), null, "UTILITY", "r",
                        Map.of("name", "profile.firstName", "time", "ai"), "class reminder"),
                new EngagementTemplateAdvisor.Proposal("bad", "{{1}} class at {{2}}",
                        List.of("name", "time"), List.of("Asha", "6 PM"), null, "UTILITY", "r")));

        List<EngagementTemplateProposal> out = service.recommend("e1", "i1", "admin", 2, "class reminder", "hinglish");

        assertEquals(1, out.size());
        assertEquals("hinglish", out.get(0).getLanguage());
        assertEquals("class reminder", out.get(0).getPurpose());
        assertTrue(out.get(0).getVariableSources().contains("profile.firstName"), out.get(0).getVariableSources());
        verify(advisor).propose(any(), eq(BRIEF), isNull(), anyList(), eq(2), eq("class reminder"), eq("hinglish"), isNull());
    }

    @Test
    @DisplayName("W14: an AI source that would let the model write a link is not kept")
    void W14_invalidAiSourcesDropped() {
        when(advisor.propose(any(), anyString(), any(), anyList(), anyInt(), any(), any(), any())).thenReturn(List.of(
                new EngagementTemplateAdvisor.Proposal("good", "Hi {{1}}, join the class here {{2}} and say hello.",
                        List.of("name", "class_link"), List.of("Asha", "https://ee.test/class"), null, "UTILITY", "r",
                        Map.of("name", "profile.firstName", "class_link", "ai"), null)));
        EngagementTemplateProposal p = service.recommend("e1", "i1", "admin", 1, null, null).get(0);
        assertEquals("{\"name\":\"profile.firstName\"}", p.getVariableSources());
    }

    @Test
    @DisplayName("regenerate one: a single new draft from the old one, and the old draft withdrawn")
    void regenerateWithdrawsOld() {
        proposal("p-old", "AI_PROPOSED");
        when(advisor.propose(any(), anyString(), anyString(), anyList(), eq(1), anyString(), eq("hi"), anyString()))
                .thenReturn(List.of(new EngagementTemplateAdvisor.Proposal("v2", "Namaste {{1}}, aaj class {{2}} baje hai, zaroor aana.",
                        List.of("name", "time"), List.of("Asha", "6"), null, "UTILITY", "r")));

        TemplateAlternativesRequest req = TemplateAlternativesRequest.builder()
                .basedOnId("p-old").mode("REGENERATE").count(3).build();
        List<EngagementTemplateProposal> out = service.requestAlternatives("e1", "i1", req, "admin");

        assertEquals(1, out.size());
        assertEquals("hi", out.get(0).getLanguage());
        verify(proposals).withdraw(eq("p-old"), eq("i1"), any());
    }

    @Test
    @DisplayName("more like this keeps the original and seeds the AI with it")
    void moreLikeThisKeepsOriginal() {
        proposal("p-ok", "META_APPROVED");
        when(advisor.propose(any(), anyString(), any(), anyList(), anyInt(), any(), any(),
                eq("Hi {{1}}, your class starts at {{2}} today.")))
                .thenReturn(List.of(new EngagementTemplateAdvisor.Proposal("v3", "Hello {{1}}, see you at class at {{2}} this evening.",
                        List.of("name", "time"), List.of("Asha", "6 PM"), null, "UTILITY", "r")));
        service.requestAlternatives("e1", "i1", TemplateAlternativesRequest.builder()
                .basedOnId("p-ok").mode("MORE_LIKE_THIS").build(), "admin");
        verify(proposals, never()).withdraw(anyString(), anyString(), any());
    }

    @Test
    @DisplayName("an approved template can't be regenerated")
    void regenerateApprovedRefused() {
        proposal("p-ok", "META_APPROVED");
        assertThrows(VacademyException.class, () -> service.requestAlternatives("e1", "i1",
                TemplateAlternativesRequest.builder().basedOnId("p-ok").mode("REGENERATE").build(), "admin"));
    }

    @Test
    @DisplayName("edit validates the variable sources against the brief")
    void editValidatesSources() {
        proposal("p-e", "AI_PROPOSED");
        TemplateEditRequest bad = TemplateEditRequest.builder()
                .variableSources(Map.of("name", "profile.firstName", "time", "brief.link.4")).build();
        assertThrows(VacademyException.class, () -> service.edit("p-e", "i1", bad, "admin"));

        TemplateEditRequest good = TemplateEditRequest.builder()
                .variableSources(Map.of("name", "profile.firstName", "time", "static:6 PM")).purpose("reminder").build();
        EngagementTemplateProposal saved = service.edit("p-e", "i1", good, "admin");
        assertTrue(saved.getVariableSources().contains("static:6 PM"));
        assertEquals("reminder", saved.getPurpose());
    }

    @Test
    @DisplayName("W12: an approved template Meta later disables is taken out of use, and comes back when re-approved")
    void W12_disabledByMeta() {
        EngagementTemplateProposal approved = proposal("p-a", "META_APPROVED");
        EngagementTemplateProposal disabled = proposal("p-d", "META_DISABLED");
        EngagementTemplateProposal still = proposal("p-s", "META_APPROVED");
        when(proposals.findByInstituteIdAndStatusIn(eq("i1"), anyList())).thenReturn(List.of(approved, disabled, still));
        when(clients.getWhatsAppTemplate("tpl-p-a")).thenReturn(om.createObjectNode().put("status", "PAUSED"));
        when(clients.getWhatsAppTemplate("tpl-p-d")).thenReturn(om.createObjectNode().put("status", "APPROVED").put("category", "UTILITY"));
        when(clients.getWhatsAppTemplate("tpl-p-s")).thenReturn(om.createObjectNode().put("status", "APPROVED"));
        when(proposals.reconcileApprovedFromMeta(anyString(), anyString(), any(), any())).thenReturn(1);

        assertEquals(2, service.syncApproved("i1"));

        verify(proposals).reconcileApprovedFromMeta(eq("p-a"), eq("META_DISABLED"),
                argThat(r -> r != null && r.contains("paused")), any());
        verify(proposals).reconcileApprovedFromMeta(eq("p-d"), eq("META_APPROVED"), isNull(), any());
        verify(proposals, never()).reconcileApprovedFromMeta(eq("p-s"), anyString(), any(), any());
    }

    @Test
    @DisplayName("W12: when the Meta refresh fails nothing is changed (stale data must not disable templates)")
    void W12_refreshFailureChangesNothing() {
        when(clients.syncWhatsAppTemplates("i1")).thenThrow(new IllegalStateException("token expired"));
        assertEquals(0, service.syncApproved("i1"));
        verify(proposals, never()).reconcileApprovedFromMeta(anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("W2: a hard-coded link that is not in the brief is dropped on generate and refused on edit")
    void W2_linksMustBeInTheBrief() {
        when(advisor.propose(any(), anyString(), any(), anyList(), anyInt(), any(), any(), any())).thenReturn(List.of(
                new EngagementTemplateAdvisor.Proposal("bad", "Hi {{1}}, join at https://evil.example.com/x today, see you.",
                        List.of("name"), List.of("Asha"), null, "UTILITY", "r"),
                new EngagementTemplateAdvisor.Proposal("ok", "Hi {{1}}, join at https://ee.test/class today, see you.",
                        List.of("name"), List.of("Asha"), null, "UTILITY", "r")));
        List<EngagementTemplateProposal> out = service.recommend("e1", "i1", "a", 2, null, null);
        assertEquals(1, out.size());
        assertTrue(out.get(0).getProposedBody().contains("ee.test/class"));

        proposal("p-l", "AI_PROPOSED");
        assertThrows(VacademyException.class, () -> service.edit("p-l", "i1",
                TemplateEditRequest.builder().body("Hi {{1}}, see evil.example.com at {{2}} today, friends.").build(), "a"));
    }

    @Test
    @DisplayName("W3: a footer over 60 chars typed by a human is refused, not silently cut")
    void W3_longFooterRefused() {
        proposal("p-f", "AI_PROPOSED");
        VacademyException ex = assertThrows(VacademyException.class, () -> service.edit("p-f", "i1",
                TemplateEditRequest.builder().footerText("x".repeat(61)).build(), "a"));
        assertTrue(ex.getMessage().contains("footer"), ex.getMessage());
    }

    @Test
    void unknownLanguageOrModeRefused() {
        assertThrows(VacademyException.class, () -> service.recommend("e1", "i1", "a", 1, null, "fr"));
        assertThrows(VacademyException.class, () -> service.requestAlternatives("e1", "i1",
                TemplateAlternativesRequest.builder().mode("SHUFFLE").build(), "a"));
    }
}
