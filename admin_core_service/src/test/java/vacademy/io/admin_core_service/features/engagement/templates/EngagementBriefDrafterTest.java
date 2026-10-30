package vacademy.io.admin_core_service.features.engagement.templates;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.agent.dto.ConversationSession;
import vacademy.io.admin_core_service.features.agent.service.LLMService;
import vacademy.io.admin_core_service.features.engagement.dto.BriefDraftRequest;
import vacademy.io.admin_core_service.features.engagement.service.EngagementReadDao;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EngagementBriefDrafterTest {

    private static final ObjectMapper OM = new ObjectMapper();

    private LLMService llm;
    private EngagementReadDao dao;
    private EngagementBriefDrafter drafter;

    @BeforeEach
    void setUp() {
        llm = mock(LLMService.class);
        dao = mock(EngagementReadDao.class);
        drafter = new EngagementBriefDrafter(llm, dao);
    }

    private void answer(String content) {
        when(llm.generateChatCompletion(any())).thenReturn(LLMService.LLMResponse.builder().content(content).build());
    }

    private static BriefDraftRequest req(String objective, String product, String site) {
        return new BriefDraftRequest(objective, site, product, "en", "Team Tutezy", null, null);
    }

    @Test
    @DisplayName("a Lead Agent's brief is described by what it sells, who sells it, the site and who it is for")
    void describesTheAgent() {
        String text = EngagementBriefDrafter.describe(OM, """
                {"description": "Tutezy helps tutors run classes online.",
                 "products": ["Tutezy", "Tutezy Live"],
                 "offer": {"name": "Tutezy", "seller": "Vidyayatan", "website": "https://tutezy.ai"},
                 "buyer_roles": ["Founder", "Academic head"],
                 "industries": [{"name": "Coaching institutes", "search_term": "coaching"}],
                 "keywords": ["lms"], "deal_breakers": ["no budget"], "exclude": ["bigcorp.com"]}
                """);
        assertEquals("""
                Tutezy helps tutors run classes online.
                What we offer: Tutezy, Tutezy Live
                Offered by: Vidyayatan
                Website: https://tutezy.ai
                Who it is for: Founder, Academic head in Coaching institutes""", text);
        assertTrue(!text.contains("bigcorp") && !text.contains("no budget"), "lead-finding internals leaked: " + text);
    }

    @Test
    @DisplayName("an empty or unreadable brief says nothing")
    void emptyBrief() {
        assertEquals("", EngagementBriefDrafter.describe(OM, "{}"));
        assertEquals("", EngagementBriefDrafter.describe(OM, "not json"));
        assertEquals("", EngagementBriefDrafter.describe(OM, null));
        assertEquals("", EngagementBriefDrafter.describe(OM, "[]"));
    }

    @Test
    @DisplayName("only the lead lists whose agent describes an offer are returned")
    void fromLeadAgents() {
        when(dao.leadAgentBriefsByAudienceIds(eq("i1"), anyList())).thenReturn(List.of(
                new Object[]{"aud1", "Agent A", "{\"description\":\"We sell X.\"}"},
                new Object[]{"aud2", "Agent B", "{}"}));
        List<EngagementBriefDrafter.LeadAgentBrief> out = drafter.fromLeadAgents("i1", List.of("aud1", "aud2"));
        assertEquals(1, out.size());
        assertEquals("aud1", out.get(0).audienceId());
        assertEquals("Agent A", out.get(0).agentName());
        assertEquals("We sell X.", out.get(0).text());
    }

    @Test
    @DisplayName("nothing to write from: refused before the AI is called")
    void needsSomething() {
        VacademyException e = assertThrows(VacademyException.class,
                () -> drafter.generate("i1", new BriefDraftRequest(" ", null, "", "en", "Team", null, "an old brief")));
        assertTrue(e.getMessage().contains("Say what the engine is for"), e.getMessage());
        verify(llm, never()).generateChatCompletion(any());
    }

    @Test
    @DisplayName("a website that is not a full http(s) address is refused")
    void badWebsite() {
        VacademyException e = assertThrows(VacademyException.class,
                () -> drafter.generate("i1", req("Book demos", "", "tutezy.ai")));
        assertTrue(e.getMessage().contains("http"), e.getMessage());
        verify(llm, never()).generateChatCompletion(any());
    }

    @Test
    @DisplayName("the AI gets the admin's input and the rules, free of charge to the institute")
    void promptAndFlags() {
        answer("Who we are and what we offer: Tutezy.\nLink to share: https://tutezy.ai");
        String brief = drafter.generate("i1", new BriefDraftRequest("Book demos with tutors", "https://tutezy.ai",
                "Tutezy runs online classes for tutors", "hinglish", "Team Tutezy", "Tutezy helps tutors.", "Earlier draft"));
        assertTrue(brief.startsWith("Who we are and what we offer"));
        ArgumentCaptor<ConversationSession> s = ArgumentCaptor.forClass(ConversationSession.class);
        verify(llm).generateChatCompletion(s.capture());
        assertEquals(Boolean.TRUE, s.getValue().getContext().get(LLMService.CTX_BILLED_BY_CALLER));
        assertEquals("engagement", s.getValue().getContext().get(LLMService.CTX_USE_CASE));
        String system = s.getValue().getHistory().get(0).getContent();
        String user = s.getValue().getHistory().get(1).getContent();
        assertTrue(system.contains("Hinglish"), "language missing");
        assertTrue(system.contains("You cannot open the website"), "website rule missing");
        assertTrue(system.contains("starts with \"TODO:\""), "TODO rule missing");
        assertTrue(system.contains("Use ONLY facts in the INPUT"), "no-invention rule missing");
        assertTrue(user.contains("Objective of the engine: Book demos with tutors"), user);
        assertTrue(user.contains("Website: https://tutezy.ai"), user);
        assertTrue(user.contains("Product or offer: Tutezy runs online classes for tutors"), user);
        assertTrue(user.contains("Tutezy helps tutors."), "Lead Agent description missing: " + user);
        assertTrue(user.contains("Earlier draft"), "current brief missing: " + user);
    }

    @Test
    @DisplayName("a code fence around the answer is removed")
    void stripsFence() {
        answer("```text\nWho we are: Tutezy\n```");
        assertEquals("Who we are: Tutezy", drafter.generate("i1", req("Book demos", "", "")));
    }

    @Test
    @DisplayName("no answer, or an AI failure, is a plain message to the admin")
    void failures() {
        answer("   ");
        assertTrue(assertThrows(VacademyException.class, () -> drafter.generate("i1", req("Book demos", "", "")))
                .getMessage().contains("did not return a brief"));
        when(llm.generateChatCompletion(any())).thenThrow(new IllegalStateException("provider down"));
        assertTrue(assertThrows(VacademyException.class, () -> drafter.generate("i1", req("Book demos", "", "")))
                .getMessage().contains("Try again"));
    }
}
