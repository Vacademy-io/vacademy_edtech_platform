package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService.WakeRequest;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * B5: the engine coordinates with the rest of the CRM — one contact limit across all systems
 * (S1, L10), the counsellor-active hold (F-1), the do-not-automate flag, and lifecycle exits on
 * Lost (L2) and on a move to another list (L7).
 */
class EngagementCrmCoordinationTest {

    private static final String INST = "i1";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static EngagementEngine engine(String id, String audience) {
        EngagementEngine e = new EngagementEngine();
        e.setId(id);
        e.setInstituteId(INST);
        e.setName("Nurture");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setAudience(audience);
        e.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
        e.setQuietHours("{}");
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    private static EngagementMember member(String id, String engineId, String userId, String leadRow) {
        EngagementMember m = new EngagementMember();
        m.setId(id);
        m.setEngineId(engineId);
        m.setInstituteId(INST);
        m.setUserId(userId);
        m.setAudienceResponseId(leadRow);
        m.setStatus("ACTIVE");
        m.setNextActionAt(Instant.now());
        return m;
    }

    private static DataPointRegistry.CohortBundle ledger(String memberId, String contactJson) throws Exception {
        DataPointProvider provider = mock(DataPointProvider.class);
        when(provider.key()).thenReturn("ledger");
        JsonNode payload = MAPPER.readTree("{\"contact\":" + contactJson + "}");
        return new DataPointRegistry.CohortBundle(List.of(provider), Map.of("ledger", Map.of(memberId, payload)));
    }

    // ── L2: Lost / Not interested ──────────────────────────────────────────

    @Nested
    @DisplayName("L2: a lead marked Lost or Not interested is done, like Converted")
    class Lost {
        private EngagementReadDao readDao;
        private PolicyGate gate;

        @BeforeEach
        void setUp() {
            readDao = mock(EngagementReadDao.class);
            gate = new PolicyGate(readDao, mock(EngagementActionRepository.class));
        }

        @Test
        @DisplayName("L2_lostLeadIsBlocked: the lead row's Lost stage blocks it at decision and send time")
        void L2_lostLeadIsBlocked() {
            when(readDao.leadConsentRows(eq(INST), anyCollection())).thenReturn(List.<Object[]>of(
                    new Object[]{"ar1", "ACTIVE", "ACTIVE", "LOST"},
                    new Object[]{"ar2", "ACTIVE", "ACTIVE", null}));
            Map<String, PolicyGate.LeadBlock> blocked = gate.blockedLeads(INST, List.of("ar1", "ar2"));
            assertEquals(PolicyGate.LeadBlock.LOST, blocked.get("ar1"));
            assertNull(blocked.get("ar2"));
        }

        @Test
        @DisplayName("L2_learnerEngineKeepsItsLearner: like Converted, an engine that also targets learners keeps an account holder")
        void L2_learnerEngineKeepsItsLearner() {
            EngagementEngine leadEngine = engine("e-lead", "[{\"type\":\"AUDIENCE\",\"id\":\"list-1\"}]");
            EngagementEngine learnerEngine = engine("e-learn", "[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps\"}]");
            assertEquals(PolicyGate.LeadBlock.LOST, PolicyGate.effectiveLeadBlock(PolicyGate.LeadBlock.LOST,
                    leadEngine, member("m1", "e-lead", "u1", "ar1")));
            assertNull(PolicyGate.effectiveLeadBlock(PolicyGate.LeadBlock.LOST,
                    learnerEngine, member("m2", "e-learn", "u1", "ar1")));
        }

        @Test
        @DisplayName("L2_dueSendWithdrawn: a due auto-send to a Lost lead is withdrawn; an AI-call promise still goes")
        void L2_dueSendWithdrawn() {
            EngagementAction send = new EngagementAction();
            assertNotNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.LOST, send));
            EngagementAction promise = new EngagementAction();
            promise.setSource(EngagementAction.SOURCE_AI_CALL);
            assertNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.LOST, promise));
        }

        @Test
        @DisplayName("L2_exitSweepTakesLostLeadsOut: the 5-minute exit sweep exits Lost leads and cancels their pending rows")
        void L2_exitSweepTakesLostLeadsOut() {
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementActionRepository actions = mock(EngagementActionRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            PolicyGate mockGate = mock(PolicyGate.class);
            EngagementLeadOutcomeService outcomes = new EngagementLeadOutcomeService(members, actions, engines,
                    mock(EngagementCrmMirrorDao.class), mockGate);
            when(engines.findAllById(any())).thenReturn(List.of(engine("e-lead", "[{\"type\":\"AUDIENCE\",\"id\":\"list-1\"}]")));
            when(members.findAllById(any())).thenReturn(List.of(
                    member("m-lost", "e-lead", null, "ar-lost"), member("m-won", "e-lead", null, "ar-won")));
            when(mockGate.blockedLeads(eq(INST), any())).thenReturn(Map.of(
                    "ar-lost", PolicyGate.LeadBlock.LOST, "ar-won", PolicyGate.LeadBlock.CONVERTED));
            when(members.exitMembers(any(), any())).thenReturn(1);

            assertEquals(2, outcomes.exitConverted(List.of("m-lost", "m-won"), Instant.now()));
            verify(actions).cancelOpenForMembers(eq(List.of("m-lost")), contains("Lost"), any(), eq(true));
            verify(actions).cancelOpenForMembers(eq(List.of("m-won")), contains("Converted"), any(), eq(true));
        }
    }

    // ── L7: moved to another list ──────────────────────────────────────────

    @Nested
    @DisplayName("L7: a lead moved to another list leaves the old list's engines and joins the new one's")
    class Moved {
        private EngagementWakeDao dao;
        private EngagementMemberRepository members;
        private EngagementEngineRepository engines;
        private EngagementActionRepository actions;
        private EngagementEngineService engineService;
        private EngagementLeadMoveService move;

        @BeforeEach
        void setUp() {
            dao = mock(EngagementWakeDao.class);
            members = mock(EngagementMemberRepository.class);
            engines = mock(EngagementEngineRepository.class);
            actions = mock(EngagementActionRepository.class);
            engineService = mock(EngagementEngineService.class);
            move = new EngagementLeadMoveService(dao, members, engines, actions, engineService);
            EngagementEngine oldList = engine("e-old", "[{\"type\":\"AUDIENCE\",\"id\":\"list-old\"}]");
            EngagementEngine both = engine("e-both", "[{\"type\":\"AUDIENCE\",\"id\":\"list-old\"},{\"type\":\"AUDIENCE\",\"id\":\"list-new\"}]");
            EngagementEngine learner = engine("e-learn", "[{\"type\":\"AUDIENCE\",\"id\":\"list-old\"},{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps\"}]");
            when(dao.liveMemberIdsOfLeadRow(INST, "ar1")).thenReturn(List.of("m-old", "m-both", "m-learn"));
            when(members.findAllById(any())).thenReturn(List.of(member("m-old", "e-old", "u1", "ar1"),
                    member("m-both", "e-both", "u1", "ar1"), member("m-learn", "e-learn", "u1", "ar1")));
            when(engines.findAllById(any())).thenReturn(List.of(oldList, both, learner));
            when(engineService.targetsAudience(any(), anyString())).thenAnswer(inv ->
                    ((EngagementEngine) inv.getArgument(0)).getAudience().contains("\"" + inv.getArgument(1) + "\""));
            when(members.exitMembers(any(), any())).thenReturn(1);
        }

        @Test
        @DisplayName("L7_leavesOldListEngines: only the engine that no longer reaches the person exits, pending rows cancelled")
        void L7_leavesOldListEngines() {
            move.leadMoved(INST, "ar1", "list-new", "u1", true, Instant.now());
            verify(members).exitMembers(eq(List.of("m-old")), any());
            verify(actions).cancelOpenForMembers(eq(List.of("m-old")), contains("another list"), any(), eq(true));
        }

        @Test
        @DisplayName("L7_joinsNewListEngines: the lead is enrolled into the new list's engines within minutes")
        void L7_joinsNewListEngines() {
            move.leadMoved(INST, "ar1", "list-new", "u1", true, Instant.now());
            verify(engineService).enrollNewLead(INST, "list-new", "ar1", "u1");
        }

        @Test
        @DisplayName("L7_bulkMoveStillExits: a bulk move exits now, joins at the nightly reconcile (no LLM burst)")
        void L7_bulkMoveStillExits() {
            EngagementLeadMoveService moveService = mock(EngagementLeadMoveService.class);
            EngagementWakeDao wakeDao = mock(EngagementWakeDao.class);
            when(wakeDao.leadRows(anyString(), any())).thenAnswer(inv -> List.of(new EngagementWakeDao.LeadRow(
                    inv.getArgument(0), INST, "list-new", null, null, null)));
            EngagementWakeService wake = new EngagementWakeService(wakeDao, members, engineService, moveService);
            for (int i = 0; i < 60; i++) wake.request(new WakeRequest(INST, "ar" + i, null, null, null, null,
                    EngagementWakeService.LEAD_MOVED, false, "user:admin"));
            wake.drain(System.currentTimeMillis() + 10_000);
            verify(moveService, org.mockito.Mockito.times(60))
                    .leadMoved(eq(INST), anyString(), eq("list-new"), any(), eq(false), any());
            verify(moveService, never()).leadMoved(any(), any(), any(), any(), eq(true), any());
        }
    }

    // ── S1 / L10 / F-1 / do-not-automate ─────────────────────────────────────

    @Nested
    @DisplayName("Coordination verdicts: contact limit, counsellor hold, do-not-automate")
    class Verdicts {
        private EngagementCoordinationDao dao;
        private EngagementCoordinationService service;
        private final Instant now = Instant.parse("2026-10-29T06:00:00Z"); // 11:30 IST

        @BeforeEach
        void setUp() {
            dao = mock(EngagementCoordinationDao.class);
            service = new EngagementCoordinationService(dao);
            when(dao.aiCallCounts(anyString(), anyCollection(), any())).thenReturn(Map.of());
            when(dao.leadsWithFollowupDue(anyString(), anyCollection(), any(), any())).thenReturn(Set.of());
            when(dao.doNotAutomate(anyString(), anyCollection())).thenReturn(Set.of());
        }

        private EngagementCoordinationService.Verdict verdict(EngagementMember m, String contact) throws Exception {
            return EngagementCoordinationService.of(
                    service.forCohort(INST, List.of(m), ledger(m.getId(), contact), now), m.getId());
        }

        @Test
        @DisplayName("S1_allSystemsCountTowardOneLimit: 3 workflow/announcement/chatbot touches + 1 AI call reach the limit of 4")
        void S1_allSystemsCountTowardOneLimit() throws Exception {
            when(dao.aiCallCounts(anyString(), anyCollection(), any())).thenReturn(Map.of("ar1", 1L));
            EngagementCoordinationService.Verdict v = verdict(member("m1", "e1", null, "ar1"), "{\"touches\":3}");
            assertTrue(v.contactLimitReached());
            assertEquals(4, v.touches());
        }

        @Test
        @DisplayName("S1_belowLimitIsClear: 3 touches leave room for one more")
        void S1_belowLimitIsClear() throws Exception {
            EngagementCoordinationService.Verdict v = verdict(member("m1", "e1", null, "ar1"), "{\"touches\":3}");
            assertFalse(v.contactLimitReached());
            assertNull(v.hold());
        }

        @Test
        @DisplayName("L10_sharedPhoneSharesTheLimit: two children's leads on one parent phone read the same phone count")
        void L10_sharedPhoneSharesTheLimit() throws Exception {
            // The ledger counts per phone / email, not per lead row: both members see the phone's 4.
            DataPointProvider provider = mock(DataPointProvider.class);
            when(provider.key()).thenReturn("ledger");
            JsonNode sameParent = MAPPER.readTree("{\"contact\":{\"touches\":4}}");
            DataPointRegistry.CohortBundle bundle = new DataPointRegistry.CohortBundle(List.of(provider),
                    Map.of("ledger", Map.of("m-child1", sameParent, "m-child2", sameParent)));
            Map<String, EngagementCoordinationService.Verdict> v = service.forCohort(INST,
                    List.of(member("m-child1", "e1", null, "ar-c1"), member("m-child2", "e1", null, "ar-c2")), bundle, now);
            assertTrue(v.get("m-child1").contactLimitReached());
            assertTrue(v.get("m-child2").contactLimitReached());
        }

        @Test
        @DisplayName("F1_counsellorTouchHolds: a note or call in the last 24 h means draft-only; after 24 h it lifts")
        void F1_counsellorTouchHolds() throws Exception {
            EngagementMember m = member("m1", "e1", null, "ar1");
            m.setHumanTouchAt(now.minus(Duration.ofHours(5)));
            assertEquals(EngagementCoordinationService.HOLD_HUMAN_TOUCH, verdict(m, "{\"touches\":0}").hold());
            m.setHumanTouchAt(now.minus(Duration.ofHours(30)));
            assertNull(verdict(m, "{\"touches\":0}").hold());
        }

        @Test
        @DisplayName("F1_inboxMessageHolds: a counsellor's WhatsApp from the inbox holds too")
        void F1_inboxMessageHolds() throws Exception {
            EngagementCoordinationService.Verdict v = verdict(member("m1", "e1", null, "ar1"),
                    "{\"touches\":0,\"lastHumanSentAt\":\"2026-10-29T04:00:00Z\"}");
            assertEquals(EngagementCoordinationService.HOLD_HUMAN_TOUCH, v.hold());
        }

        @Test
        @DisplayName("F1_followupDueTodayHolds: an open follow-up due today (institute's day) means draft-only")
        void F1_followupDueTodayHolds() throws Exception {
            ArgumentCaptor<Instant> from = ArgumentCaptor.forClass(Instant.class);
            ArgumentCaptor<Instant> to = ArgumentCaptor.forClass(Instant.class);
            when(dao.leadsWithFollowupDue(eq(INST), anyCollection(), from.capture(), to.capture())).thenReturn(Set.of("ar1"));
            assertEquals(EngagementCoordinationService.HOLD_FOLLOWUP_TODAY,
                    verdict(member("m1", "e1", null, "ar1"), "{\"touches\":0}").hold());
            assertEquals(Instant.parse("2026-10-28T18:30:00Z"), from.getValue(), "IST midnight");
            assertEquals(Instant.parse("2026-10-29T18:30:00Z"), to.getValue());
        }

        @Test
        @DisplayName("doNotAutomate_holds: a flagged lead is draft-only, whatever else is true")
        void doNotAutomate_holds() throws Exception {
            when(dao.doNotAutomate(eq(INST), anyCollection())).thenReturn(Set.of("ar1"));
            assertEquals(EngagementCoordinationService.HOLD_DO_NOT_AUTOMATE,
                    verdict(member("m1", "e1", null, "ar1"), "{\"touches\":0}").hold());
        }

        @Test
        @DisplayName("a failed coordination read drafts only (the safe side), never blocks or auto-sends")
        void readFailureDraftsOnly() throws Exception {
            when(dao.doNotAutomate(anyString(), anyCollection())).thenThrow(new RuntimeException("db down"));
            EngagementCoordinationService.Verdict v = verdict(member("m1", "e1", null, "ar1"), "{\"touches\":0}");
            assertEquals(EngagementCoordinationService.HOLD_UNKNOWN, v.hold());
            assertFalse(v.contactLimitReached());
        }

        @Test
        @DisplayName("at send time: a lead flagged after the decision, or touched by a counsellor, is held for the inbox")
        void sendTimeHold() {
            EngagementMember m = member("m1", "e1", null, "ar1");
            assertNull(service.sendHold(m, now));
            m.setHumanTouchAt(now.minus(Duration.ofHours(1)));
            assertEquals(EngagementCoordinationService.HOLD_HUMAN_TOUCH, service.sendHold(m, now));
            when(dao.doNotAutomate(eq(INST), anyCollection())).thenReturn(Set.of("ar1"));
            assertEquals(EngagementCoordinationService.HOLD_DO_NOT_AUTOMATE, service.sendHold(m, now));
        }
    }

    // ── the decision applies the verdicts ─────────────────────────────────

    @Nested
    @DisplayName("Decision: the limit skips the LLM; a hold turns an auto-send into a draft")
    class Decision {
        private EngagementBrainClient brain;
        private EngagementMemberRepository members;
        private EngagementActionRepository actions;
        private EngagementCoordinationService coordination;
        private EngagementDecisionService service;
        private EngagementMember member;
        private EngagementEngine engine;

        @BeforeEach
        void setUp() {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            brain = mock(EngagementBrainClient.class);
            members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            coordination = mock(EngagementCoordinationService.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                    mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "coordination", coordination);
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            engine = engine("e1", "[{\"type\":\"AUDIENCE\",\"id\":\"list-1\"}]");
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nudge leads.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
            member = member("m1", "e1", null, "ar1");
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            // main's send schedule (PolicyGate.scheduleSend) times every send now.
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(9L);
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "Fee details attached", null, null,
                            "asked", 60, 0, null, null, null));
        }

        private void verdict(boolean limit, String hold) {
            when(coordination.forCohort(anyString(), anyList(), any(), any()))
                    .thenReturn(Map.of("m1", new EngagementCoordinationService.Verdict(limit, hold, limit ? 4 : 0)));
        }

        @Test
        @DisplayName("S1_limitReachedSkipsTheLlm: zero tokens, look again tomorrow")
        void S1_limitReachedSkipsTheLlm() {
            verdict(true, null);
            service.decideCohort(engine, List.of(member));
            verify(brain, never()).decide(any(), anyString(), any(), any(), any(), any());
            verify(members).save(argThat(m -> m.getNextActionAt().isAfter(Instant.now().plus(Duration.ofHours(23)))));
        }

        @Test
        @DisplayName("no verdict: a graduated auto channel auto-sends as before")
        void clearAutoSends() {
            when(coordination.forCohort(anyString(), anyList(), any(), any())).thenReturn(Map.of());
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "SEND".equals(a.getKind())));
        }

        @Test
        @DisplayName("F1_holdDraftsOnly: with a counsellor active the decision is an inbox draft, and the model is told why")
        @SuppressWarnings("unchecked")
        void F1_holdDraftsOnly() {
            verdict(false, EngagementCoordinationService.HOLD_HUMAN_TOUCH);
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "TASK".equals(a.getKind())));
            verify(actions, never()).save(argThat(a -> "SEND".equals(a.getKind())));
            ArgumentCaptor<Map<String, String>> blocks = ArgumentCaptor.forClass(Map.class);
            verify(brain).decide(any(), anyString(), blocks.capture(), any(), any(), any());
            assertTrue(blocks.getValue().values().iterator().next().startsWith("HOLD:"));
        }

        @Test
        @DisplayName("doNotAutomate_draftsOnly: a flagged lead never auto-sends")
        void doNotAutomate_draftsOnly() {
            verdict(false, EngagementCoordinationService.HOLD_DO_NOT_AUTOMATE);
            service.decideCohort(engine, List.of(member));
            verify(actions, never()).save(argThat(a -> "SEND".equals(a.getKind())));
        }
    }
}
