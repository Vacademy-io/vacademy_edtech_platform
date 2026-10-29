package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplate;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateAdvisor;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateRepository;
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateService;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** An engine takes over what the institute already has approved before new templates are written. */
class EngagementTemplateReuseTest {

    private static final String BRIEF = "Sell Tutezy, an AI tutor, to teachers. Offer a free demo. Sign as Team Tutezy.";

    private static EngagementTemplateReuseMatcher matcherReturning(String json) {
        LLMService llm = mock(LLMService.class);
        LLMService.LLMResponse resp = mock(LLMService.LLMResponse.class);
        when(resp.getContent()).thenReturn(json);
        when(llm.generateChatCompletion(any())).thenReturn(resp);
        return new EngagementTemplateReuseMatcher(llm);
    }

    private static List<EngagementTemplateReuseMatcher.Candidate> two() {
        return List.of(new EngagementTemplateReuseMatcher.Candidate("t1", "tutezy_intro", "intro", "Hi {{1}}, Tutezy is an AI tutor."),
                new EngagementTemplateReuseMatcher.Candidate("t2", "fee_due", "fees", "Hi {{1}}, your fee is due."));
    }

    @Nested
    @DisplayName("matcher")
    class Matcher {
        @Test
        @DisplayName("takes the ids the model names, with its reason, never more than asked")
        void picks() {
            var m = matcherReturning("{\"reuse\":[{\"id\":\"t1\",\"reason\":\"same product\"},{\"id\":\"t2\",\"reason\":\"x\"}]}");
            Map<String, String> r = m.pick("i1", "WhatsApp", BRIEF, null, two(), 1);
            assertEquals(Map.of("t1", "same product"), r);
        }

        @Test
        @DisplayName("an id that was not offered is ignored")
        void ignoresInvented() {
            var m = matcherReturning("{\"reuse\":[{\"id\":\"zzz\",\"reason\":\"made up\"}]}");
            assertTrue(m.pick("i1", "email", BRIEF, null, two(), 3).isEmpty());
        }

        @Test
        @DisplayName("unreadable output means nothing is reused, so generation goes ahead")
        void badJson() {
            assertTrue(matcherReturning("sorry no").pick("i1", "email", BRIEF, null, two(), 3).isEmpty());
        }
    }

    @Nested
    @DisplayName("WhatsApp")
    class WhatsApp {
        private EngagementTemplateProposalRepository proposals;
        private EngagementTemplateAdvisor advisor;
        private EngagementTemplateProposalService service;

        private EngagementTemplateProposal approved(String id, String name, String body) {
            EngagementTemplateProposal p = new EngagementTemplateProposal();
            p.setId(id);
            p.setEngineId("other");
            p.setInstituteId("i1");
            p.setName(name);
            p.setLanguage("en");
            p.setProposedBody(body);
            p.setProposedCategory("UTILITY");
            p.setStatus("META_APPROVED");
            p.setNotificationTemplateId("nt-" + id);
            p.setVariableNames("[\"name\"]");
            p.setSampleValues("[\"Asha\"]");
            p.setVariableSources("{\"name\":\"profile.firstName\"}");
            return p;
        }

        @BeforeEach
        void setUp() {
            proposals = mock(EngagementTemplateProposalRepository.class);
            advisor = mock(EngagementTemplateAdvisor.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementTemplateProposalService(proposals, engines, prompts, advisor, mock(EngagementInternalClients.class));
            EngagementEngine e = new EngagementEngine();
            e.setId("e1");
            e.setInstituteId("i1");
            e.setLanguage("en");
            e.setStatus("DRAFT");
            e.setChannels("{\"WHATSAPP\":{\"enabled\":true}}");
            when(engines.findById("e1")).thenReturn(Optional.of(e));
            EngagementPromptVersion pv = new EngagementPromptVersion();
            pv.setCompiledText(BRIEF);
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(pv));
            when(proposals.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(proposals.maxRound("e1")).thenReturn(0);
            when(proposals.findReusableFromOtherEngines("i1", "e1", "en")).thenReturn(List.of(
                    approved("t1", "tutezy_intro_abc123", "Hi {{1}}, Tutezy is an AI tutor for your students."),
                    approved("t2", "fee_due_abc123", "Hi {{1}}, your fee is due.")));
        }

        @Test
        @DisplayName("a fitting approved template is copied for this engine, already approved, no generation")
        void reusesAndSkipsGeneration() {
            ReflectionTestUtils.setField(service, "reuseMatcher",
                    matcherReturning("{\"reuse\":[{\"id\":\"t1\",\"reason\":\"same product\"}]}"));
            List<EngagementTemplateProposal> out = service.recommend("e1", "i1", "u1", 1, null, null);
            assertEquals(1, out.size());
            EngagementTemplateProposal r = out.get(0);
            assertEquals("t1", r.getReusedFromId());
            assertEquals("META_APPROVED", r.getStatus());
            assertEquals("e1", r.getEngineId());
            assertEquals("nt-t1", r.getNotificationTemplateId());
            assertEquals("tutezy_intro_abc123", r.getName());
            verifyNoInteractions(advisor);
        }

        @Test
        @DisplayName("what is reused counts toward the number asked; only the rest is generated")
        void generatesTheRest() {
            ReflectionTestUtils.setField(service, "reuseMatcher",
                    matcherReturning("{\"reuse\":[{\"id\":\"t1\",\"reason\":\"same product\"}]}"));
            when(advisor.propose(any(), any(), any(), any(), eq(2), any(), any(), any())).thenReturn(List.of());
            // the generator produces nothing valid; the reused template must still come back
            List<EngagementTemplateProposal> out = service.recommend("e1", "i1", "u1", 3, null, null);
            assertEquals(1, out.size());
            verify(advisor).propose(any(), any(), any(), any(), eq(2), any(), any(), any());
        }

        @Test
        @DisplayName("nothing fits: templates are generated as before")
        void nothingFits() {
            ReflectionTestUtils.setField(service, "reuseMatcher", matcherReturning("{\"reuse\":[]}"));
            when(advisor.propose(any(), any(), any(), any(), eq(3), any(), any(), any())).thenReturn(List.of());
            assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                    () -> service.recommend("e1", "i1", "u1", 3, null, null));
            verify(advisor).propose(any(), any(), any(), any(), eq(3), any(), any(), any());
        }

        @Test
        @DisplayName("a template whose links come from another engine's brief is not offered")
        void linkTemplatesSkipped() {
            EngagementTemplateProposal linked = approved("t3", "join_link_abc123", "Hi {{1}}, join {{2}}");
            linked.setVariableSources("{\"name\":\"profile.firstName\",\"link\":\"brief.link.1\"}");
            when(proposals.findReusableFromOtherEngines("i1", "e1", "en")).thenReturn(List.of(linked));
            var matcher = mock(EngagementTemplateReuseMatcher.class);
            ReflectionTestUtils.setField(service, "reuseMatcher", matcher);
            when(advisor.propose(any(), any(), any(), any(), anyInt(), any(), any(), any())).thenReturn(List.of());
            assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                    () -> service.recommend("e1", "i1", "u1", 1, null, null));
            verifyNoInteractions(matcher);
        }
    }

    @Nested
    @DisplayName("email")
    class Email {
        @Test
        @DisplayName("a fitting approved email is copied as an already-approved version; no new writing needed")
        void reusesEmail() {
            EngagementEmailTemplateRepository repo = mock(EngagementEmailTemplateRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementEmailTemplateAdvisor advisor = mock(EngagementEmailTemplateAdvisor.class);
            var service = new EngagementEmailTemplateService(repo, engines, prompts, advisor);
            EngagementEngine e = new EngagementEngine();
            e.setId("e1");
            e.setInstituteId("i1");
            e.setLanguage("en");
            e.setCreatedBy("admin-1");
            e.setChannels("{\"EMAIL\":{\"enabled\":true}}");
            when(engines.findById("e1")).thenReturn(Optional.of(e));
            EngagementPromptVersion pv = new EngagementPromptVersion();
            pv.setCompiledText(BRIEF);
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(pv));
            when(repo.save(any())).thenAnswer(inv -> {
                EngagementEmailTemplate t = inv.getArgument(0);
                t.setId("new-" + t.getName());
                return t;
            });
            EngagementEmailTemplate src = new EngagementEmailTemplate();
            src.setId("s1");
            src.setEngineId("other");
            src.setInstituteId("i1");
            src.setName("tutezy_intro");
            src.setVersion(2);
            src.setLanguage("en");
            src.setSubject("Meet Tutezy");
            src.setBodyHtml("<p>Hi {{name}}, Tutezy is an AI tutor.</p><p>Team Tutezy</p>");
            src.setVariableNames("[\"name\"]");
            src.setSampleValues("[\"Asha\"]");
            src.setVariableSources("{\"name\":\"profile.firstName\"}");
            src.setStatus(EngagementEmailTemplate.APPROVED);
            src.setApprovedBy("admin-2");
            when(repo.findReusableFromOtherEngines("i1", "e1", "en")).thenReturn(List.of(src));
            ReflectionTestUtils.setField(service, "reuseMatcher",
                    matcherReturning("{\"reuse\":[{\"id\":\"s1\",\"reason\":\"same product\"}]}"));

            var out = service.generate("e1", "i1", new EngagementEmailTemplateService.GenerateRequest(null, 1, null, null, null, null), "u1");

            assertEquals(1, out.size());
            assertEquals("s1", out.get(0).reusedFromId());
            assertEquals(EngagementEmailTemplate.APPROVED, out.get(0).status());
            assertEquals("e1", out.get(0).engineId());
            verifyNoInteractions(advisor);
        }
    }
}
