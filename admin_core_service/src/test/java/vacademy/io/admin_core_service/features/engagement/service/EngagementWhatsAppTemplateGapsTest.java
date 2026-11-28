package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.dto.TemplateEditRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementBriefAdvisor;
import vacademy.io.admin_core_service.features.engagement.templates.WhatsAppTemplateRules;
import vacademy.io.admin_core_service.features.engagement.templates.WhatsAppTemplateRules.Button;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** W1, W6, W10, W13, W15. */
class EngagementWhatsAppTemplateGapsTest {

    private static final String BRIEF = "Evening classes at 6 PM. Join: https://ee.test/class. Sign as Team EE.";
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
        p.setLanguage("en");
        p.setRound(1);
        p.setProposedBody("Hi {{1}}, your class starts at {{2}} today.");
        p.setProposedCategory("UTILITY");
        p.setVariableNames("[\"name\",\"time\"]");
        p.setSampleValues("[\"Asha\",\"6 PM\"]");
        p.setStatus(status);
        p.setNotificationTemplateId("tpl-" + id);
        when(proposals.findByIdAndInstituteId(id, "i1")).thenReturn(Optional.of(p));
        return p;
    }

    // ---------------- W6
    @Test
    void W6_promotionalUtilityWarns() {
        assertNotNull(WhatsAppTemplateRules.categoryWarning("Hi {{1}}, 20% off on the new batch, join now!", "UTILITY"));
        assertNotNull(WhatsAppTemplateRules.categoryWarning("Admissions open! Limited seats.", "utility"));
        assertNull(WhatsAppTemplateRules.categoryWarning("Hi {{1}}, 20% off on the new batch, join now!", "MARKETING"));
        assertNull(WhatsAppTemplateRules.categoryWarning("Hi {{1}}, your class starts at 6 PM today.", "UTILITY"));
        EngagementTemplateProposal p = proposal("p-w6", "AI_PROPOSED");
        p.setProposedBody("Big discount this week for you, enroll now and save.");
        assertNotNull(p.getCategoryWarning());
    }

    @Test
    @DisplayName("W6: the AI's promotional UTILITY draft is proposed as MARKETING, with the reason")
    void W6_aiPromoBecomesMarketing() {
        when(advisor.propose(any(), anyString(), any(), anyList(), anyInt(), any(), any(), any())).thenReturn(List.of(
                new EngagementTemplateAdvisor.Proposal("promo", "Hi {{1}}, get a discount on the new batch this week, see you.",
                        List.of("name"), List.of("Asha"), null, "UTILITY", "nudge")));
        EngagementTemplateProposal out = service.recommend("e1", "i1", "a", 1, null, null).get(0);
        assertEquals("MARKETING", out.getProposedCategory());
        assertTrue(out.getRationale().contains("Proposed as MARKETING"), out.getRationale());
    }

    // ---------------- W13 / W14
    @Test
    void W13_headerRules() {
        assertNull(WhatsAppTemplateRules.headerProblem("NONE", null, null, BRIEF));
        assertNull(WhatsAppTemplateRules.headerProblem("TEXT", "Class reminder", null, BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("TEXT", "x".repeat(61), null, BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("TEXT", "Hi {{1}}", null, BRIEF));
        assertNull(WhatsAppTemplateRules.headerProblem("IMAGE", null, "https://cdn.ee.test/banner.png?v=2", BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("IMAGE", null, "http://cdn.ee.test/banner.png", BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("IMAGE", null, "https://cdn.ee.test/banner.pdf", BRIEF));
        assertNull(WhatsAppTemplateRules.headerProblem("DOCUMENT", null, "https://cdn.ee.test/fees.pdf", BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("VIDEO", null, null, BRIEF));
        assertNotNull(WhatsAppTemplateRules.headerProblem("GIF", null, null, BRIEF));
    }

    @Test
    void W14_buttonRules() {
        assertNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("URL", "Join class", "https://ee.test/class", null),
                new Button("QUICK_REPLY", "Remind me later", null, null), new Button("PHONE_NUMBER", "Call us", null, "+919876543210")), BRIEF));
        assertNotNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("URL", "Join", "https://evil.example.com", null)), BRIEF));
        assertNotNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("URL", "x".repeat(26), "https://ee.test/class", null)), BRIEF));
        assertNotNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("PHONE_NUMBER", "Call", null, "abc")), BRIEF));
        assertNotNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("URL", "a", "https://ee.test/class", null),
                new Button("URL", "b", "https://ee.test/class", null), new Button("URL", "c", "https://ee.test/class", null)), BRIEF));
        assertNotNull(WhatsAppTemplateRules.buttonsProblem(List.of(new Button("COPY_CODE", "x", null, null)), BRIEF));
    }

    @Test
    @DisplayName("W13: header + buttons are saved on edit and sent with the Meta draft")
    void W13_headerAndButtonsReachTheDraft() throws Exception {
        proposal("p-h", "AI_PROPOSED");
        EngagementTemplateProposal saved = service.edit("p-h", "i1", TemplateEditRequest.builder()
                .headerType("image").headerMediaUrl("https://cdn.ee.test/banner.png")
                .buttons(List.of(new Button("URL", "Join class", "https://ee.test/class", null))).build(), "a");
        assertEquals("IMAGE", saved.getHeaderType());
        assertTrue(saved.getButtons().contains("ee.test/class"));

        assertThrows(VacademyException.class, () -> service.edit("p-h", "i1", TemplateEditRequest.builder()
                .buttons(List.of(new Button("URL", "Join", "https://evil.example.com", null))).build(), "a"));

        // The refused edit above runs in a transaction that rolls back in production; undo it here.
        saved.setButtons("[{\"type\":\"URL\",\"text\":\"Join class\",\"url\":\"https://ee.test/class\"}]");
        saved.setStatus("USER_APPROVED");
        when(proposals.claimForSubmit(eq("p-h"), eq("i1"), any())).thenAnswer(inv -> { saved.setStatus("SUBMITTED"); return 1; });
        when(clients.getWhatsAppTemplateByName(anyString(), anyString(), anyString())).thenReturn(om.createObjectNode());
        when(clients.createWhatsAppTemplateDraft(any())).thenReturn(om.createObjectNode().put("id", "tpl-new"));
        when(clients.getWhatsAppTemplate("tpl-new")).thenReturn(om.createObjectNode().put("status", "DRAFT"));
        when(clients.submitWhatsAppTemplate("tpl-new")).thenReturn(om.createObjectNode().put("status", "PENDING"));
        saved.setNotificationTemplateId(null);
        service.submit("p-h", "i1", "a");
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> dto = ArgumentCaptor.forClass(Map.class);
        verify(clients).createWhatsAppTemplateDraft(dto.capture());
        assertEquals("IMAGE", dto.getValue().get("headerType"));
        assertEquals("https://cdn.ee.test/banner.png", dto.getValue().get("headerSampleUrl"));
        assertTrue(dto.getValue().get("buttons").toString().contains("https://ee.test/class"));
    }

    // ---------------- W15
    @Test
    @DisplayName("W15: editing an approved template makes a new version that replaces it; the approved one keeps sending")
    void W15_editApprovedMakesNewVersion() {
        EngagementTemplateProposal approved = proposal("p-ok", "META_APPROVED");
        approved.setMetaCategory("UTILITY");
        when(proposals.findFirstByReplacesIdOrderByCreatedAtDesc("p-ok")).thenReturn(Optional.empty());
        when(proposals.maxRound("e1")).thenReturn(3);

        EngagementTemplateProposal v2 = service.edit("p-ok", "i1",
                TemplateEditRequest.builder().body("Hi {{1}}, your class now starts at {{2}} this evening.").build(), "a");

        assertEquals("p-ok", v2.getReplacesId());
        assertEquals("USER_REVIEW", v2.getStatus());
        assertEquals(4, v2.getRound());
        assertTrue(v2.getName().startsWith("class_reminder_") && !v2.getName().equals("class_reminder_ab12cd"), v2.getName());
        assertEquals("META_APPROVED", approved.getStatus());
        assertEquals("Hi {{1}}, your class starts at {{2}} today.", approved.getProposedBody());
    }

    @Test
    @DisplayName("W15: a second edit goes to the open new version; one already with Meta blocks another")
    void W15_oneOpenVersionAtATime() {
        proposal("p-ok", "META_APPROVED");
        EngagementTemplateProposal open = proposal("p-v2", "USER_REVIEW");
        open.setReplacesId("p-ok");
        when(proposals.findFirstByReplacesIdOrderByCreatedAtDesc("p-ok")).thenReturn(Optional.of(open));
        EngagementTemplateProposal out = service.edit("p-ok", "i1", TemplateEditRequest.builder().purpose("evening").build(), "a");
        assertEquals("p-v2", out.getId());

        open.setStatus("META_PENDING");
        assertThrows(VacademyException.class, () -> service.edit("p-ok", "i1",
                TemplateEditRequest.builder().purpose("again").build(), "a"));
    }

    @Test
    @DisplayName("W15: when Meta approves the new version, the old one is superseded")
    void W15_supersedeOnApproval() {
        EngagementTemplateProposal v2 = proposal("p-v2", "META_PENDING");
        v2.setReplacesId("p-ok");
        when(proposals.findByInstituteIdAndStatusIn(eq("i1"), anyList())).thenReturn(List.of(v2));
        when(clients.getWhatsAppTemplate("tpl-p-v2")).thenReturn(om.createObjectNode().put("status", "APPROVED"));
        when(proposals.reconcileFromMeta(eq("p-v2"), eq("META_APPROVED"), any(), any(), any())).thenReturn(1);
        service.sync("i1");
        verify(proposals).supersedeReplaced(eq("p-ok"), any());
    }

    // ---------------- W10
    @Test
    @DisplayName("W10: over Meta's hourly limit a submit waits in the queue instead of calling Meta")
    void W10_queueOverLimit() {
        proposal("p-q", "USER_APPROVED");
        when(proposals.countSubmittedSince(eq("i1"), any())).thenReturn(90L);
        when(proposals.queueForMeta(eq("p-q"), eq("i1"), any())).thenReturn(1);
        service.submit("p-q", "i1", "a");
        verify(proposals).queueForMeta(eq("p-q"), eq("i1"), any());
        verify(proposals, never()).claimForSubmit(anyString(), anyString(), any());
        verify(clients, never()).createWhatsAppTemplateDraft(any());
    }

    @Test
    @DisplayName("W10: a Meta 'too many' error queues the template instead of failing")
    void W10_rateLimitErrorQueues() {
        EngagementTemplateProposal p = proposal("p-r", "USER_APPROVED");
        when(proposals.claimForSubmit(eq("p-r"), eq("i1"), any())).thenAnswer(inv -> { p.setStatus("SUBMITTED"); return 1; });
        when(clients.getWhatsAppTemplate("tpl-p-r")).thenReturn(om.createObjectNode().put("status", "DRAFT"));
        when(clients.submitWhatsAppTemplate("tpl-p-r")).thenThrow(new IllegalStateException("(#4) Application request limit reached"));
        when(proposals.queueForMeta(eq("p-r"), eq("i1"), any())).thenReturn(1);
        service.submit("p-r", "i1", "a");
        verify(proposals).rollbackSubmit(eq("p-r"), any(), anyString(), any());
        verify(proposals).queueForMeta(eq("p-r"), eq("i1"), any());
    }

    @Test
    @DisplayName("W10: the sync job submits queued templates only while there is room this hour")
    void W10_drainRespectsRoom() {
        EngagementTemplateProposal q1 = proposal("p-1", "QUEUED");
        EngagementTemplateProposal q2 = proposal("p-2", "QUEUED");
        when(proposals.findQueued("i1")).thenReturn(List.of(q1, q2));
        when(proposals.countSubmittedSince(eq("i1"), any())).thenReturn(89L, 89L, 90L);
        when(proposals.unqueue(anyString(), any())).thenAnswer(inv -> {
            ("p-1".equals(inv.getArgument(0)) ? q1 : q2).setStatus("USER_APPROVED");
            return 1;
        });
        when(proposals.claimForSubmit(eq("p-1"), eq("i1"), any())).thenAnswer(inv -> { q1.setStatus("SUBMITTED"); return 1; });
        when(clients.getWhatsAppTemplate("tpl-p-1")).thenReturn(om.createObjectNode().put("status", "DRAFT"));
        when(clients.submitWhatsAppTemplate("tpl-p-1")).thenReturn(om.createObjectNode().put("status", "PENDING"));
        assertEquals(1, service.drainQueued("i1"));
        verify(proposals, times(1)).unqueue(anyString(), any());
    }

    // ---------------- W1
    @Test
    @DisplayName("W1: a thin brief is flagged with questions (fallback when the AI is unavailable); a full one is not")
    void W1_briefCheck() {
        LLMService llm = mock(LLMService.class);
        when(llm.generateChatCompletion(any())).thenThrow(new IllegalStateException("down"));
        EngagementBriefAdvisor advisorW1 = new EngagementBriefAdvisor(llm);
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId("i1");
        e.setLanguage("en");

        EngagementBriefAdvisor.BriefCheck thin = advisorW1.check(e, "Classes.");
        assertTrue(thin.weak());
        assertTrue(thin.gaps().containsAll(List.of("SHORT", "NO_LINK", "NO_FACTS")), thin.gaps().toString());
        assertFalse(thin.questions().isEmpty());
        assertTrue(thin.questions().size() <= 4);

        String full = "We run evening NEET classes at 6 PM for class 11 and 12 learners in Pune. Remind learners who missed "
                + "two classes, share the class link https://ee.test/class and the fee PDF https://ee.test/fees.pdf, keep it "
                + "friendly and short, and sign as Team EE Academy.";
        EngagementBriefAdvisor.BriefCheck shortButComplete = advisorW1.check(e,
                "Evening NEET classes at 6 PM for class 11 and 12 learners. Join: https://ee.test/class . Sign as Team EE.");
        assertFalse(shortButComplete.weak(), shortButComplete.gaps().toString());
        EngagementBriefAdvisor.BriefCheck ok = advisorW1.check(e, full);
        assertFalse(ok.weak(), ok.gaps().toString());
        assertTrue(ok.questions().isEmpty());
    }
}
