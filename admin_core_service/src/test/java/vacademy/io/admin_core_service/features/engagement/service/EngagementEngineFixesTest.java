package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Fixes from the 2026-09-29 Engagement Engines review. */
class EngagementEngineFixesTest {

    private static EngagementEngine engine(String channels, String quietHours) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId("i1");
        e.setName("Re-engage");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setChannels(channels);
        e.setQuietHours(quietHours);
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    // ── wake gate ────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("wake gate: a gate sleep is not a no-op decision")
    class WakeGate {
        private EngagementBrainClient brain;
        private EngagementDecisionService service;
        private EngagementMember member;
        private EngagementEngine engine;

        @BeforeEach
        void setUp() {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            brain = mock(EngagementBrainClient.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members,
                    mock(EngagementActionRepository.class), prompts, mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);

            engine = engine("{\"EMAIL\":{\"enabled\":true}}", "{}");
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nudge quiet learners.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));

            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId("i1");
            member.setUserId("u1");
            member.setStatus("ACTIVE");
            member.setNextActionAt(Instant.now());
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").userId("u1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("NO_OP", null, null, null, null, null,
                            "wait", 0, null, null, null, null));
        }

        @Test
        @DisplayName("after one NO_OP, gate sleeps keep the backoff at 2x cadence, so the model looks again at 144h")
        void backoffDoesNotRunAway() {
            service.decideCohort(engine, List.of(member));            // first look → NO_OP
            verify(brain, times(1)).decide(any(), anyString(), any(), any(), any(), any());
            assertEquals((short) 1, member.getConsecutiveNoOps());

            for (int hoursAgo : new int[] {90, 108, 126}) {             // re-checks every cadence/4
                member.setLastDecidedAt(Instant.now().minus(Duration.ofHours(hoursAgo)));
                service.decideCohort(engine, List.of(member));
                assertEquals((short) 1, member.getConsecutiveNoOps(), "a gate sleep must not count as a no-op");
            }
            verify(brain, times(1)).decide(any(), anyString(), any(), any(), any(), any());

            member.setLastDecidedAt(Instant.now().minus(Duration.ofHours(145)));
            service.decideCohort(engine, List.of(member));
            verify(brain, times(2)).decide(any(), anyString(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("the post-LLM write is targeted: it never saves the whole member row")
        void decisionWriteIsTargeted() {
            EngagementMemberRepository members = (EngagementMemberRepository) ReflectionTestUtils.getField(service, "memberRepository");
            Instant lease = member.getNextActionAt();
            service.decideCohort(engine, List.of(member));
            verify(members).recordDecision(eq("m1"), any(), anyString(), eq((short) 1), eq(lease), any());
            verify(members, never()).save(any());
        }

        @Test
        @DisplayName("graduation is per channel: approvals on another channel do not unlock auto-send")
        void graduationPerChannel() {
            EngagementActionRepository actions = (EngagementActionRepository) ReflectionTestUtils.getField(service, "actionRepository");
            engine.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true},\"IN_APP\":{\"enabled\":true}}");
            when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(0L);
            when(actions.countApprovedSendsForChannel("e1", "IN_APP")).thenReturn(9L);
            when(actions.countApprovedSends("e1")).thenReturn(9L);
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "Hi, we miss you", null, null,
                            "quiet", 50, 0, null, null, null));
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "TASK".equals(a.getKind()) && "EMAIL".equals(a.getChannel())));
            verify(actions, never()).save(argThat(a -> "SEND".equals(a.getKind())));
        }

        @Test
        @DisplayName("nextCheckHours from the model is capped at 30 days")
        void nextCheckCapped() {
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("NO_OP", null, null, null, null, null,
                            "wait", 0, null, 8760, null, null));
            service.decideCohort(engine, List.of(member));
            assertTrue(member.getNextActionAt().isBefore(Instant.now().plus(Duration.ofDays(31))),
                    member.getNextActionAt().toString());
        }
    }

    // ── quiet hours ─────────────────────────────────────────────────────────

    @Nested
    @DisplayName("quiet hours")
    class QuietHours {
        private PolicyGate gate;
        private final ZoneId ist = ZoneId.of("Asia/Kolkata");

        @BeforeEach
        void setUp() {
            gate = new PolicyGate(mock(EngagementReadDao.class), mock(EngagementActionRepository.class));
            ReflectionTestUtils.setField(gate, "quietStartHour", 21);
            ReflectionTestUtils.setField(gate, "quietEndHour", 8);
            ReflectionTestUtils.setField(gate, "quietTimezone", "Asia/Kolkata");
        }

        @Test
        @DisplayName("engine hours that close the rest of the day fall back to the floor, never 2 AM")
        void neverFailsOpen() {
            EngagementEngine e = engine("{}", "{\"startHour\":8,\"endHour\":21,\"timezone\":\"Asia/Kolkata\"}");
            Instant twoAmIst = Instant.parse("2026-09-29T20:30:00Z");
            Instant slot = gate.clampToAllowedWindow(e, twoAmIst);
            assertEquals(LocalTime.of(8, 0), slot.atZone(ist).toLocalTime(), slot.toString());
        }

        @Test
        @DisplayName("the engine's own hours are read in the timezone the admin picked")
        void engineZoneHonoured() {
            EngagementEngine e = engine("{}", "{\"startHour\":21,\"endHour\":8,\"timezone\":\"Europe/London\"}");
            Instant sevenAmLondon = Instant.parse("2026-09-29T06:00:00Z"); // 07:00 BST, 11:30 IST
            assertEquals(Instant.parse("2026-09-29T07:00:00Z"), gate.clampToAllowedWindow(e, sevenAmLondon));
        }

        @Test
        @DisplayName("an allowed time is returned unchanged")
        void allowedUnchanged() {
            EngagementEngine e = engine("{}", "{}");
            Instant afternoonIst = Instant.parse("2026-09-29T08:00:00Z");
            assertEquals(afternoonIst, gate.clampToAllowedWindow(e, afternoonIst));
        }
    }

    // ── access guard ────────────────────────────────────────────────────────

    @Nested
    @DisplayName("access guard: no root-user bypass")
    class AccessGuard {
        private final EngagementAccessGuard guard = new EngagementAccessGuard();

        private CustomUserDetails user(boolean root, String... authorities) {
            UserServiceDTO dto = new UserServiceDTO();
            dto.setUsername("u");
            dto.setUserId("u1");
            dto.setRootUser(root);
            dto.setAuthorities(List.of(authorities));
            return new CustomUserDetails(dto);
        }

        private void clientId(String id) {
            MockHttpServletRequest req = new MockHttpServletRequest();
            if (id != null) req.addHeader("clientId", id);
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
        }

        @AfterEach
        void clear() {
            RequestContextHolder.resetRequestAttributes();
        }

        @Test
        @DisplayName("a root learner (is_root_user is ~98% of accounts) is refused")
        void rootLearnerRefused() {
            clientId("inst-a");
            assertThrows(RuntimeException.class, () -> guard.requireAdmin(user(true, "STUDENT"), "inst-a"));
        }

        @Test
        @DisplayName("a root user naming another institute is refused")
        void rootOtherInstituteRefused() {
            clientId("inst-b");
            assertThrows(RuntimeException.class, () -> guard.requireAdmin(user(true, "ADMIN"), "inst-a"));
        }

        @Test
        @DisplayName("an admin of the institute passes")
        void adminPasses() {
            clientId("inst-a");
            assertDoesNotThrow(() -> guard.requireAdmin(user(false, "ADMIN"), "inst-a"));
        }

        @Test
        @DisplayName("a teacher of the institute is refused (engines are admin-only)")
        void teacherRefused() {
            clientId("inst-a");
            assertThrows(RuntimeException.class, () -> guard.requireAdmin(user(false, "TEACHER"), "inst-a"));
        }
    }

    // ── dispatch-time re-checks ─────────────────────────────────────────────

    @Nested
    @DisplayName("dispatch job re-checks the person and the clock at send time")
    class DispatchRecheck {
        private EngagementActionRepository actions;
        private EngagementEngineRepository engines;
        private EngagementMemberRepository members;
        private PolicyGate gate;
        private EngagementDispatcher dispatcher;
        private CreditClient credits;
        private EngagementDispatchJob job;
        private EngagementMember member;
        private EngagementAction send;

        @BeforeEach
        void setUp() {
            actions = mock(EngagementActionRepository.class);
            engines = mock(EngagementEngineRepository.class);
            members = mock(EngagementMemberRepository.class);
            gate = mock(PolicyGate.class);
            dispatcher = mock(EngagementDispatcher.class);
            credits = mock(CreditClient.class);
            job = new EngagementDispatchJob(actions, engines, members, gate, dispatcher, credits);
            ReflectionTestUtils.setField(job, "batch", 100);
            ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
            ReflectionTestUtils.setField(job, "maxUnbilled", 25);

            send = new EngagementAction();
            send.setId("a1");
            send.setEngineId("e1");
            send.setMemberId("m1");
            send.setInstituteId("i1");
            send.setKind("SEND");
            send.setStatus("OPEN");
            send.setChannel("EMAIL");
            when(actions.findDueAutoSends(any(), anyInt())).thenReturn(List.of(send));
            when(actions.findUnbilledSent(anyInt())).thenReturn(List.of());
            when(engines.findById("e1")).thenReturn(Optional.of(engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}", "{}")));

            member = new EngagementMember();
            member.setId("m1");
            member.setUserId("u1");
            member.setStatus("ACTIVE");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        }

        @Test
        @DisplayName("a member opted out after the decision: withdrawn, nothing sent")
        void optedOutMemberWithdrawn() {
            member.setStatus("OPTED_OUT");
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), anyString(), any());
            verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("an opt-out recorded in the consent store after the decision: withdrawn")
        void consentStoreOptOutWithdrawn() {
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of("u1"));
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("due inside quiet hours (engine resumed at night): moved to the next allowed time")
        void quietHoursRescheduled() {
            Instant morning = Instant.now().plus(Duration.ofHours(8));
            when(gate.clampToAllowedWindow(any(), any())).thenReturn(morning);
            job.dispatch();
            verify(actions).rescheduleDueSend(eq("a1"), eq(morning), any());
            verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
        }

        @Test
        @DisplayName("auto left on for a disabled channel: demoted to a human task, not sent")
        void autoOnDisabledChannelDemoted() {
            when(engines.findById("e1")).thenReturn(Optional.of(engine("{\"EMAIL\":{\"enabled\":false,\"auto\":true}}", "{}")));
            job.dispatch();
            verify(actions).demoteSendToTask(eq("a1"), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }
    }

    // ── opt-out replies ─────────────────────────────────────────────────────

    @Nested
    @DisplayName("replies asking to stop")
    class OptOut {

        @Test
        @DisplayName("clear opt-outs match; ordinary uses of 'stop' do not")
        void patterns() {
            for (String yes : List.of("STOP", "stop.", "Please stop messaging me", "unsubscribe", "Opt out",
                    "don't message me again", "band karo", "msg mat karo", "Mujhe message mat bhejo",
                    "remove my number")) {
                assertTrue(EngagementReplyResponder.OPT_OUT.matcher(yes).find(), yes);
            }
            for (String no : List.of("I had to stop studying for exams", "don't send the fee pdf again, I have it",
                    "What time does class stop?", "stopwatch", "yes please send the link")) {
                assertFalse(EngagementReplyResponder.OPT_OUT.matcher(no).find(), no);
            }
            assertTrue(EngagementReplyResponder.STOP_MENTION.matcher("I had to stop studying for exams").find());
            assertTrue(EngagementReplyResponder.STOP_MENTION.matcher("not interested").find());
            assertFalse(EngagementReplyResponder.STOP_MENTION.matcher("stopwatch").find());
        }

        @Test
        @DisplayName("while a proactive decision holds the member, the reply goes to a human, not the bot")
        void heldMemberEscalates() {
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementActionRepository actions = mock(EngagementActionRepository.class);
            EngagementReplyBrain brain = mock(EngagementReplyBrain.class);
            EngagementDispatcher dispatcher = mock(EngagementDispatcher.class);
            EngagementReplyResponder responder = new EngagementReplyResponder(members, engines, prompts, actions, brain, dispatcher);
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
            EngagementMemberRepository.AutoReplyCandidate cand = mock(EngagementMemberRepository.AutoReplyCandidate.class);
            when(cand.getMemberId()).thenReturn("m1");
            when(cand.getEngineId()).thenReturn("e1");
            when(members.findAutoReplyCandidates(eq("i1"), eq("9000000001"), any())).thenReturn(List.of(cand));
            when(members.claimHandledReply(eq("i1"), eq("wamid.2"), any())).thenReturn(1);
            when(members.holdForReply(eq("m1"), any(), any())).thenReturn(0);
            when(engines.findById("e1")).thenReturn(Optional.of(engine("{}", "{}")));
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.empty());

            assertTrue(responder.handleReply("i1", "9000000001", "What time is the class tomorrow?", "wamid.2"));

            verify(brain, never()).decide(any(), any(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
            verify(actions).save(argThat(a -> a.getRationale() != null && a.getRationale().contains("concurrent-decision")));
        }

        @Test
        @DisplayName("a STOP reply opts the number out everywhere and is never auto-answered")
        void stopReplyOptsOut() {
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementActionRepository actions = mock(EngagementActionRepository.class);
            EngagementReplyBrain brain = mock(EngagementReplyBrain.class);
            EngagementDispatcher dispatcher = mock(EngagementDispatcher.class);
            EngagementReplyResponder responder = new EngagementReplyResponder(members, engines, prompts, actions, brain, dispatcher);
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);

            EngagementMemberRepository.AutoReplyCandidate cand = mock(EngagementMemberRepository.AutoReplyCandidate.class);
            when(cand.getMemberId()).thenReturn("m1");
            when(cand.getEngineId()).thenReturn("e1");
            when(members.findAutoReplyCandidates(eq("i1"), eq("9000000001"), any())).thenReturn(List.of(cand));
            when(members.claimHandledReply(eq("i1"), eq("wamid.1"), any())).thenReturn(1);
            when(members.optOutByPhone(eq("i1"), eq("9000000001"), any())).thenReturn(2);
            when(engines.findById("e1")).thenReturn(Optional.of(engine("{}", "{}")));
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.empty());

            assertTrue(responder.handleReply("i1", "+91 90000 00001", "Please stop messaging me", "wamid.1"));

            verify(members).optOutByPhone(eq("i1"), eq("9000000001"), any());
            verify(brain, never()).decide(any(), any(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
            verify(actions).save(argThat(a -> a.getRationale() != null && a.getRationale().startsWith("Asked to stop")
                    && "REPLY".equals(a.getKind()) && a.getDraftBody() == null));
        }
    }

    @SuppressWarnings("unused")
    private static final ObjectMapper OM = new ObjectMapper();
}
