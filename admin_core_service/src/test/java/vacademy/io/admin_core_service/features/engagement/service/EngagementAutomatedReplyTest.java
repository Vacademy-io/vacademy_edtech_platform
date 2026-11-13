package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.providers.LedgerDataPointProvider;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.spi.FetchContext;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EngagementAutomatedReplyTest {

    private static final ObjectMapper OM = new ObjectMapper();

    @Nested
    @DisplayName("what counts as automated")
    class Detector {

        @ParameterizedTest
        @ValueSource(strings = {
                "Thank you for contacting ABC Academy! Please let us know how we can help you.",
                "Thanks for contacting ABC study circle & tutorials. How can we help you",
                "Thank you for contacting ABC Classes! A complete coaching institute",
                "Thank you for reaching out to ABC! We're here to support you. For urgent queries please call us.",
                "Thank you for your message. We're unavailable right now, but will respond as soon as possible.",
                "Thank you for your message. Will respond as soon as possible.",
                "Thank you for your message. We'll connect you shortly. You can also fill the form at this link.",
                "Hello Student!! Thank you for the Enquiry ✅ Please select your Level so that we can guide you better",
                "Our support team is currently offline. Please leave your message.",
                "Welcome to ABC Academy. We are pleased to host your queries. Feel free to ask ?",
                "Hi! 👋 Welcome to ABC Institute. Our team will get back to you shortly.",
                "Hello Students, Welcome to the official WhatsApp Account of ABC, Our Team will respond to you soon",
                "नमस्कार & Welcome to ABC Academy!",
                "🙏 नमस्कार 🙏 ABC Academy में आपका हार्दिक स्वागत है।",
                "Choose a course 1️⃣ Science 2️⃣ Commerce",
                "128049 is your verification code. For your security, do not share this code.",
                "Mujhe laga tha fake hai par sach me mil gaye, try karo! https://abcde.buzz/xyz/in-en?1&s=wa",
                "https://abc.xyzqw.xyz/j2wv3ZivQf/789a453837e2934e?p=w",
                "Thanks for contacting us. To unsubscribe reply STOP. How can we help you?"
        })
        void bots(String text) {
            assertTrue(EngagementAutomatedReply.isAutomated(text), text);
        }

        @ParameterizedTest
        @ValueSource(strings = {
                "Hi", "Ok", "Hello sir", "Thank you", "Thanks for the info", "Link", "1", "Timing", "How to login",
                "Call me", "Not interested", "Stop",
                "Thank you for your message. What is the fee?",
                "Thanks for your message, I will revert tomorrow",
                "Thank you for contacting me, please share the details",
                "Thanks for reaching out to us, what do you offer?",
                "I am unavailable right now, call me tomorrow",
                "I'll get back to you",
                "You are welcome to call me",
                "Why are you sending automated messages?",
                "Please call me at 5 pm",
                // Consent is always read, even inside something that looks like a greeting.
                "Thank you for contacting ABC, but please stop messaging me",
                "Welcome to ABC. Not interested, thank you. Remove my number"
        })
        void people(String text) {
            assertFalse(EngagementAutomatedReply.isAutomated(text), text);
        }

        @Test
        @DisplayName("email: the sender and the raw subject decide; a person answering one still counts")
        void email() {
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("no-reply@abc.in", "Re: your mail", "Sure"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("mailer-daemon@abc.in", "x", "x"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Automatic reply: Your offer", "away"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Out of Office: Your offer", "away"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "We've received your message", "x"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Re: Your offer", "Thank you for contacting ABC!"));

            assertFalse(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Re: Your offer", "Yes, send details"));
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Re: Automatic reply: Your offer", "I am back"));
        }

        @Test
        @DisplayName("email: our own mail quoted further down does not make a real reply look automated")
        void quotedOwnMail() {
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("a@abc.in", "Re: Your offer",
                    "Yes interested. On Tue you wrote: our team will get back to you. We are closed on Sunday."));
        }

        @Test
        @DisplayName("helpdesk ticket notices are not a person replying")
        void helpdeskNotices() {
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("ops@lender.in", "Ticket received - #85661", "x"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("ops@lender.in",
                    "Ticket Closed - Calling every new loan enquiry in 60 seconds-#85661", "x"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("help@abc.in", "[ABC Support] Ticket #4411 has been created", "x"));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("ops@lender.in", "Re: Calling every new loan enquiry",
                    "Dear Manshu From,\n\nWe are pleased to inform you that your service request with Ticket ID\n#85661 has\nbeen successfully closed."));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("info@acad.in", "Re: Your offer",
                    "Dear Shreyash from Vacademy,\n\nWe would like to acknowledge that we have received your request and a ticket has been created."));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("ops@lender.in", "Re: Your offer",
                    "Dear Manshu From , We wanted to let you know that we have received your request outside of business hours."));
            assertTrue(EngagementAutomatedReply.isAutomatedEmail("help@abc.in", "Re: Your offer",
                    "Hello, your ticket #A-2231 has been resolved. Rate us below."));
        }

        @Test
        @DisplayName("a person mentioning a ticket, or writing from inside a helpdesk, is still a person")
        void ticketWordsFromPeople() {
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("ravi@abc.in", "[Ticket #4411] Re: Your offer",
                    "Hi Shreyash, yes please share a time for a demo next week."));
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("ravi@abc.in", "Re: Your offer",
                    "Thanks. We had a ticketing problem last term, tell me how you handle doubts."));
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("ravi@abc.in", "Re: Ticket booking for our event",
                    "Can your platform sell event tickets?"));
            assertFalse(EngagementAutomatedReply.isAutomatedEmail("ravi@abc.in", "Re: Your offer",
                    "We have received your email and would like a call on Monday."));
        }
    }

    @Test
    @DisplayName("the ledger hides a bot's reply, so nobody reads it as the person replying; a person's stays")
    void ledgerHidesTheBot() throws Exception {
        EngagementInternalClients clients = mock(EngagementInternalClients.class);
        when(clients.ledgerBatch(any(), anyList(), anyInt(), any())).thenReturn(OM.readTree("""
                {"bySubject":{
                  "bot":{"whatsapp":{"lastSentAt":"2026-01-01T00:00:00Z","lastReplyAt":"2026-01-02T00:00:00Z",
                         "lastReplyText":"Thank you for contacting ABC!","windowOpenUntil":"2026-01-03T00:00:00Z"}},
                  "person":{"whatsapp":{"lastReplyAt":"2026-01-02T00:00:00Z","lastReplyText":"Kitne ki hai?",
                         "windowOpenUntil":"2026-01-03T00:00:00Z"}}}}
                """));
        var fetched = new LedgerDataPointProvider(clients).fetch(mock(FetchContext.class),
                List.of(Subject.builder().memberId("bot").build(), Subject.builder().memberId("person").build()));

        JsonNode bot = fetched.get("bot").get("whatsapp");
        assertFalse(bot.has("lastReplyAt") || bot.has("lastReplyText") || bot.has("windowOpenUntil"));
        assertEquals("2026-01-01T00:00:00Z", bot.get("lastSentAt").asText());
        assertEquals("2026-01-02T00:00:00Z", fetched.get("person").get("whatsapp").get("lastReplyAt").asText());
    }

    @Nested
    @DisplayName("the responder")
    class Responder {

        private final EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        private final EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        private final EngagementActionRepository actions = mock(EngagementActionRepository.class);
        private final EngagementReplyBrain brain = mock(EngagementReplyBrain.class);
        private final EngagementDispatcher dispatcher = mock(EngagementDispatcher.class);
        private final EngagementTeamAlertService alerts = mock(EngagementTeamAlertService.class);
        private final EngagementReplyMemberQueries queries = mock(EngagementReplyMemberQueries.class);
        private final EngagementReplyResponder responder = new EngagementReplyResponder(members, engines,
                mock(EngagementPromptVersionRepository.class), actions, brain, dispatcher);

        Responder() {
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
            ReflectionTestUtils.setField(responder, "teamAlertService", alerts);
            ReflectionTestUtils.setField(responder, "replyMemberQueries", queries);
            EngagementEngine engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setName("Engine");
            engine.setCadenceHours(48);
            when(engines.findById("e1")).thenReturn(Optional.of(engine));
            EngagementMember member = new EngagementMember();
            member.setId("m1");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            EngagementMemberRepository.AutoReplyCandidate cand = mock(EngagementMemberRepository.AutoReplyCandidate.class);
            when(cand.getEngineId()).thenReturn("e1");
            when(cand.getMemberId()).thenReturn("m1");
            when(members.findAutoReplyCandidates(eq("i1"), anyString(), any())).thenReturn(List.of(cand));
            when(members.claimHandledReply(eq("i1"), anyString(), any())).thenReturn(1);
            when(members.holdForReply(eq("m1"), any(), any())).thenReturn(1);
        }

        @Test
        @DisplayName("the brain calls it automated: nothing is sent, nobody is told, the reply is closed")
        void brainIgnores() {
            when(brain.decide(any(), anyString(), anyString(), anyList())).thenReturn(
                    new EngagementReplyBrain.ReplyDecision("IGNORE", null, "A broadcast advert.", null));

            assertTrue(responder.handleReply("i1", "919000000001", "Big sale on phones today", "w1"));

            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            assertEquals("NO_OP", saved.getValue().getKind());
            assertEquals("DONE", saved.getValue().getStatus());
            assertTrue(saved.getValue().getRationale().contains("Automated message"));
            verify(members).markReplyHandled(eq("m1"), any(), any());
            verifyNoInteractions(dispatcher, alerts);
        }

        @Test
        @DisplayName("the brain is not sure: a person is asked, and the team is told")
        void brainEscalates() {
            when(brain.decide(any(), anyString(), anyString(), anyList())).thenReturn(
                    new EngagementReplyBrain.ReplyDecision("ESCALATE", "draft", "Not sure what they mean.", "uncertainty"));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));

            responder.handleReply("i1", "919000000001", "Woh wala bhejo", "w1");

            verify(alerts).notifyEscalated(any(), any(), any(), eq("Not sure what they mean."), eq("Woh wala bhejo"));
            verifyNoInteractions(dispatcher);
        }

        @Test
        @DisplayName("an out-of-office email: no task, no alert, and the sweep will not read it as waiting")
        void automatedEmail() {
            EngagementReplyMemberQueries.LiveMember live = mock(EngagementReplyMemberQueries.LiveMember.class);
            when(live.getMemberId()).thenReturn("m1");
            when(live.getCadenceHours()).thenReturn(48);
            when(queries.findLiveMembersByEmail("i1", "a@abc.in")).thenReturn(List.of(live));

            assertFalse(responder.handleEmailReply("i1", "a@abc.in", "Automatic reply: Your offer", "I am away", "mid1"));

            verify(members).markReplyHandled(eq("m1"), any(), any());
            verify(actions, never()).save(any());
            verifyNoInteractions(alerts, dispatcher);
        }

        @Test
        @DisplayName("a callback request on an engine without auto-reply reaches the team")
        void noAutoReplyEngineAlerts() {
            when(members.findAutoReplyCandidates(eq("i1"), anyString(), any())).thenReturn(List.of());
            EngagementReplyMemberQueries.LiveMember live = mock(EngagementReplyMemberQueries.LiveMember.class);
            when(live.getMemberId()).thenReturn("m1");
            when(live.getEngineId()).thenReturn("e1");
            when(queries.findLiveMembersByPhone("i1", "9000000001")).thenReturn(List.of(live));

            assertTrue(responder.handleReply("i1", "919000000001", "Please call me", "w1"));

            verify(alerts).notifyEscalated(any(), any(), any(), contains("called back"), eq("Please call me"));
        }
    }
}
