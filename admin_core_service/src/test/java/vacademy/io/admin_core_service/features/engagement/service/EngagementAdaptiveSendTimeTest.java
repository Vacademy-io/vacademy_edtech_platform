package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A person who got three messages at the same time of day and answered none of them gets the next
 * one at another time, and keeps that time until three more go unanswered or they write back.
 */
class EngagementAdaptiveSendTimeTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final ObjectMapper OM = new ObjectMapper();

    /** {@code daysAgo} days before today, at hour:10 IST. */
    private static Instant sentAt(int daysAgo, int hour) {
        return ZonedDateTime.now(IST).minusDays(daysAgo).withHour(hour).withMinute(10).withSecond(0).withNano(0)
                .toInstant();
    }

    @Nested
    @DisplayName("the rules")
    class Rules {

        @Test
        @DisplayName("three sends in the same hour on three days, no reply: stuck at that hour")
        void aRut() {
            OptionalInt stuck = EngagementAdaptiveSendTime.stuckHour(
                    List.of(sentAt(1, 11), sentAt(2, 11), sentAt(3, 11)), null, IST);
            assertEquals(11, stuck.orElseThrow());
        }

        @Test
        @DisplayName("fewer than three sends, or a different hour in the last three: not stuck")
        void notARut() {
            assertTrue(EngagementAdaptiveSendTime.stuckHour(List.of(sentAt(1, 11), sentAt(2, 11)), null, IST).isEmpty());
            assertTrue(EngagementAdaptiveSendTime.stuckHour(
                    List.of(sentAt(1, 16), sentAt(2, 11), sentAt(3, 11)), null, IST).isEmpty());
            assertTrue(EngagementAdaptiveSendTime.stuckHour(null, null, IST).isEmpty());
        }

        @Test
        @DisplayName("three sends on one day are not three days of silence")
        void sameDay() {
            Instant a = sentAt(1, 11);
            assertTrue(EngagementAdaptiveSendTime.stuckHour(
                    List.of(a, a.minusSeconds(60), a.minusSeconds(120)), null, IST).isEmpty());
        }

        @Test
        @DisplayName("a reply after the oldest of the three ends the rut; one before it does not")
        void replies() {
            List<Instant> sends = List.of(sentAt(1, 11), sentAt(2, 11), sentAt(3, 11));
            assertTrue(EngagementAdaptiveSendTime.stuckHour(sends, sentAt(2, 20), IST).isEmpty());
            assertEquals(11, EngagementAdaptiveSendTime.stuckHour(sends, sentAt(5, 20), IST).orElseThrow());
        }

        @Test
        @DisplayName("the next hour is about half a day away, and always an allowed one")
        void nextHour() {
            assertEquals(16, EngagementAdaptiveSendTime.nextHour(11, h -> true).orElseThrow());
            // 21:00 and later is quiet: from 16 the first choice (21) is out, so 20
            assertEquals(20, EngagementAdaptiveSendTime.nextHour(16, h -> h >= 8 && h < 21).orElseThrow());
            // from 20 the later hours are all quiet, so it goes back to the afternoon
            assertEquals(15, EngagementAdaptiveSendTime.nextHour(20, h -> h >= 8 && h < 21).orElseThrow());
            assertTrue(EngagementAdaptiveSendTime.nextHour(11, h -> false).isEmpty());
        }

        @Test
        @DisplayName("the minute stays; a time already past moves to the next day")
        void atHour() {
            Instant base = ZonedDateTime.now(IST).plusDays(1).withHour(11).withMinute(23).withSecond(40).toInstant();
            ZonedDateTime moved = EngagementAdaptiveSendTime.atHour(base, 16, IST, Instant.now()).atZone(IST);
            assertEquals(16, moved.getHour());
            assertEquals(23, moved.getMinute());
            assertEquals(0, moved.getSecond());
            Instant past = ZonedDateTime.now(IST).minusHours(2).toInstant();
            Instant later = EngagementAdaptiveSendTime.atHour(past, past.atZone(IST).getHour(), IST, Instant.now());
            assertTrue(later.isAfter(Instant.now()));
        }
    }

    @Nested
    @DisplayName("in a decision")
    class Deciding {
        private EngagementActionRepository actions;
        private EngagementMemberRepository members;
        private DataPointRegistry registry;
        private EngagementDecisionService service;
        private EngagementMember member;
        private EngagementEngine engine;

        @BeforeEach
        void setUp() {
            registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            EngagementBrainClient brain = mock(EngagementBrainClient.class);
            members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                    mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setName("Follow-ups");
            engine.setStatus("ACTIVE");
            engine.setCadenceHours(24);
            engine.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true,\"emailType\":\"UTILITY_EMAIL\"}}");
            engine.setQuietHours("{}");
            engine.setDataPoints("[]");
            engine.setAudience("[{\"type\":\"AUDIENCE\",\"id\":\"aud-1\"}]");
            engine.setAutoSendKilled(false);
            engine.setFirstN(0);
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Get the lead to book a demo.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId("i1");
            member.setUserId("u1");
            member.setAudienceResponseId("r1");
            member.setStatus("ACTIVE");
            member.setNextActionAt(Instant.now());
            member.setLastDecidedAt(Instant.now().minusSeconds(86400));
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").userId("u1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL",
                            "Hi, following up on your enquiry.", null, null,
                            "follow up", 60, 0, null, null, null, "Your enquiry"));
        }

        private EngagementAction decide() {
            service.decideCohort(engine, List.of(member));
            ArgumentCaptor<EngagementAction> saved = ArgumentCaptor.forClass(EngagementAction.class);
            verify(actions).save(saved.capture());
            return saved.getValue();
        }

        private void sent(Instant... times) {
            when(actions.recentSendTimes(eq("m1"), any(Pageable.class))).thenReturn(List.of(times));
        }

        @Test
        @DisplayName("three unanswered sends at 11:00: the next goes at 16:00, and the engine remembers it")
        void movesTheTime() throws Exception {
            sent(sentAt(1, 11), sentAt(2, 11), sentAt(3, 11));
            EngagementAction a = decide();
            assertEquals(16, a.getScheduledFor().atZone(IST).getHour());
            assertTrue(a.getRationale().contains("Send time changed: 3 messages at 11:00 got no reply, so this one goes at 16:00."),
                    a.getRationale());
            ArgumentCaptor<String> pref = ArgumentCaptor.forClass(String.class);
            verify(members).setSendPreference(eq("m1"), pref.capture(), any());
            JsonNode saved = OM.readTree(pref.getValue());
            assertEquals(16, saved.get("hour").asInt());
            assertEquals(16, OM.readTree(member.getMemoryJson()).get("sendPref").get("hour").asInt());
        }

        @Test
        @DisplayName("sends at different hours: the time is left alone")
        void leavesItAlone() {
            sent(sentAt(1, 16), sentAt(2, 11), sentAt(3, 11));
            EngagementAction a = decide();
            assertFalse(a.getRationale() != null && a.getRationale().contains("Send time changed"));
            verify(members, never()).setSendPreference(any(), any(), any());
        }

        @Test
        @DisplayName("three sends but the person wrote back since: the time is left alone")
        void aReplyResetsIt() throws Exception {
            sent(sentAt(1, 11), sentAt(2, 11), sentAt(3, 11));
            String reply = sentAt(1, 15).toString();
            JsonNode ledger = OM.readTree("{\"email\":{\"lastSentAt\":\"" + sentAt(1, 11) + "\",\"lastReplyAt\":\"" + reply + "\"}}");
            DataPointProvider ledgerProvider = mock(DataPointProvider.class);
            when(ledgerProvider.key()).thenReturn("ledger");
            when(ledgerProvider.render(any())).thenReturn("LEDGER");
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(
                    new DataPointRegistry.CohortBundle(List.of(ledgerProvider), Map.of("ledger", Map.of("m1", ledger))));
            service.decideCohort(engine, List.of(member));
            verify(members, never()).setSendPreference(any(), any(), any());
        }

        @Test
        @DisplayName("a remembered time keeps applying to the next sends")
        void keepsTheNewTime() {
            member.setMemoryJson("{\"sendPref\":{\"hour\":16,\"since\":\"" + sentAt(1, 12) + "\"}}");
            sent(sentAt(1, 16), sentAt(2, 11), sentAt(3, 11));
            EngagementAction a = decide();
            assertEquals(16, a.getScheduledFor().atZone(IST).getHour());
            verify(members, never()).setSendPreference(any(), any(), any());
            verify(members, never()).clearSendPreference(any(), any());
        }

        @Test
        @DisplayName("the admin changed the engine's send time: the remembered time is dropped")
        void engineTimeChanged() {
            engine.setQuietHours("{\"sendHour\":15,\"sendMinute\":0}");
            member.setMemoryJson("{\"sendPref\":{\"hour\":16,\"engineHour\":11,\"since\":\"" + sentAt(1, 12) + "\"}}");
            sent(sentAt(1, 16), sentAt(2, 11), sentAt(3, 11));
            decide();
            verify(members).clearSendPreference(eq("m1"), any());
            assertFalse(member.getMemoryJson().contains("sendPref"), member.getMemoryJson());
        }

        @Test
        @DisplayName("a person who writes back goes back to the engine's own schedule")
        void repliedSincePreferenceSet() throws Exception {
            member.setMemoryJson("{\"sendPref\":{\"hour\":16,\"since\":\"" + sentAt(2, 12) + "\"}}");
            sent(sentAt(2, 16), sentAt(3, 11), sentAt(4, 11));
            JsonNode ledger = OM.readTree("{\"email\":{\"lastReplyAt\":\"" + sentAt(1, 9) + "\"}}");
            DataPointProvider ledgerProvider = mock(DataPointProvider.class);
            when(ledgerProvider.key()).thenReturn("ledger");
            when(ledgerProvider.render(any())).thenReturn("LEDGER");
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(
                    new DataPointRegistry.CohortBundle(List.of(ledgerProvider), Map.of("ledger", Map.of("m1", ledger))));
            service.decideCohort(engine, List.of(member));
            verify(members).clearSendPreference(eq("m1"), any());
            assertFalse(member.getMemoryJson().contains("sendPref"), member.getMemoryJson());
        }
    }
}
