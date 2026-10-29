package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService.WakeRequest;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointProvider;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.enums.TimelineCategory;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * B4: CRM activity wakes the engine for that lead — the gate lets a woken member through, a
 * person's touch keeps the next decision a draft, the timeline hook picks what wakes, the wake
 * service resolves, debounces and caps (L5 duplicate merged, L6 re-enquiry, S2 bulk change).
 */
class EngagementCrmWakeTest {

    private static final String INST = "i1";

    private static EngagementEngine engine(String channels) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId(INST);
        e.setName("Re-engage");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setChannels(channels);
        e.setQuietHours("{}");
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    // ── the decision side ───────────────────────────────────────────────────

    @Nested
    @DisplayName("Decision: a woken member is looked at, and a person's touch keeps it a draft")
    class Decision {
        private EngagementBrainClient brain;
        private EngagementMemberRepository members;
        private EngagementActionRepository actions;
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
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                    mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);

            engine = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nudge quiet leads.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));

            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId(INST);
            member.setUserId("u1");
            member.setStatus("ACTIVE");
            member.setNextActionAt(Instant.now());
            // Decided 10 h ago with the fingerprint an empty bundle produces: nothing moved, the
            // 72 h cadence has not elapsed — without a wake the gate sleeps.
            member.setLastDecidedAt(Instant.now().minus(Duration.ofHours(10)));
            member.setWakeFingerprint(service.quantizedFingerprint(Map.of()));
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").userId("u1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(9L); // graduated
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "Here are the fee details", null, null,
                            "asked for fees", 60, 0, null, null, null));
        }

        @Test
        @DisplayName("not woken: the gate sleeps (no LLM) and writes only the fingerprint and re-check time")
        void notWokenSleeps() {
            service.decideCohort(engine, List.of(member));
            verify(brain, never()).decide(any(), anyString(), any(), any(), any(), any());
            verify(members).recordGateSleep(eq("m1"), anyString(), any(), any());
            verify(members, never()).save(any());
        }

        @Test
        @DisplayName("woken after the last decision: the LLM runs although nothing in the fingerprint moved")
        void wokenRunsTheModel() {
            member.setWokenAt(Instant.now().minus(Duration.ofMinutes(16)));
            member.setWakeReason(EngagementWakeService.AI_CALL);
            service.decideCohort(engine, List.of(member));
            verify(brain, times(1)).decide(any(), anyString(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("a wake from before the last decision is spent: it does not wake again")
        void oldWakeIsSpent() {
            member.setWokenAt(member.getLastDecidedAt().minus(Duration.ofMinutes(1)));
            service.decideCohort(engine, List.of(member));
            verify(brain, never()).decide(any(), anyString(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("woken by a system event on a graduated auto channel: auto-sends as before")
        void systemWakeMayAutoSend() {
            member.setWokenAt(Instant.now().minus(Duration.ofMinutes(16)));
            member.setWakeReason(EngagementWakeService.AI_CALL);
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "SEND".equals(a.getKind())));
        }

        @Test
        @DisplayName("a counsellor's note or call since the last decision: a draft for the inbox, never an auto-send")
        void humanTouchOnlyDrafts() {
            Instant noteAt = Instant.now().minus(Duration.ofMinutes(16));
            member.setWokenAt(noteAt);
            member.setWakeReason(EngagementWakeService.NOTE);
            member.setHumanTouchAt(noteAt);
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "TASK".equals(a.getKind()) && "EMAIL".equals(a.getChannel())));
            verify(actions, never()).save(argThat(a -> "SEND".equals(a.getKind())));
        }

        @Test
        @DisplayName("L6: a re-enquiry wake tells the model the person came back, first in its data")
        @SuppressWarnings("unchecked")
        void reEnquiryWhyNow() {
            member.setWokenAt(Instant.now().minus(Duration.ofMinutes(16)));
            member.setWakeReason(EngagementWakeService.RE_ENQUIRY);
            service.decideCohort(engine, List.of(member));
            ArgumentCaptor<Map<String, String>> blocks = ArgumentCaptor.forClass(Map.class);
            verify(brain).decide(any(), anyString(), blocks.capture(), any(), any(), any());
            String first = blocks.getValue().values().iterator().next();
            assertTrue(first.contains("came back and enquired again"), first);
        }

        @Test
        @DisplayName("why-now is left out of a routine look")
        void noWhyNowWhenNotWoken() {
            Map<String, String> blocks = Map.of("ledger", "LEDGER: ...");
            assertSame(blocks, EngagementDecisionService.withWhyNow(member, blocks));
        }
    }

    // ── fingerprint bands (the safety net for a missed wake) ─────────────────

    @Nested
    @DisplayName("Fingerprint: CRM bands move only when a person does something")
    class Fingerprint {
        private final ObjectMapper mapper = new ObjectMapper();
        private final EngagementDecisionService service = new EngagementDecisionService(null, null, null, null,
                null, null, null, null);

        private JsonNode json(String s) throws Exception {
            return mapper.readTree(s);
        }

        @Test
        @DisplayName("a new staff note changes it; an engine-written entry does not")
        void staffNoteMoves() throws Exception {
            Map<String, JsonNode> before = Map.of("crm_timeline", json(
                    "{\"events\":[{\"at\":\"2026-10-20T10:00:00Z\",\"by\":\"STAFF\",\"kind\":\"NOTE\"}]}"));
            Map<String, JsonNode> engineWrote = Map.of("crm_timeline", json(
                    "{\"events\":[{\"at\":\"2026-10-28T10:00:00Z\",\"by\":\"ENGINE\",\"kind\":\"EVENT\"},"
                            + "{\"at\":\"2026-10-20T10:00:00Z\",\"by\":\"STAFF\",\"kind\":\"NOTE\"}]}"));
            Map<String, JsonNode> staffWrote = Map.of("crm_timeline", json(
                    "{\"events\":[{\"at\":\"2026-10-28T11:00:00Z\",\"by\":\"STAFF\",\"kind\":\"NOTE\"},"
                            + "{\"at\":\"2026-10-20T10:00:00Z\",\"by\":\"STAFF\",\"kind\":\"NOTE\"}]}"));
            assertEquals(service.quantizedFingerprint(before), service.quantizedFingerprint(engineWrote));
            assertNotEquals(service.quantizedFingerprint(before), service.quantizedFingerprint(staffWrote));
        }

        @Test
        @DisplayName("a follow-up going overdue, and a call's analysis coming in, change it")
        void followupsAndCalls() throws Exception {
            String onTime = "{\"open\":[{\"dueAt\":\"2026-10-29T10:00:00Z\",\"overdue\":false}]}";
            String late = "{\"open\":[{\"dueAt\":\"2026-10-29T10:00:00Z\",\"overdue\":true}]}";
            assertNotEquals(service.quantizedFingerprint(Map.of("crm_followups", json(onTime))),
                    service.quantizedFingerprint(Map.of("crm_followups", json(late))));

            String processing = "{\"calls\":[{\"at\":\"2026-10-29T09:00:00Z\",\"analysis\":\"PROCESSING\"}]}";
            String done = "{\"calls\":[{\"at\":\"2026-10-29T09:00:00Z\",\"analysis\":\"COMPLETED\"}]}";
            assertNotEquals(service.quantizedFingerprint(Map.of("ai_calls", json(processing))),
                    service.quantizedFingerprint(Map.of("ai_calls", json(done))));
        }

        @Test
        @DisplayName("a fingerprint stored before the CRM bands is recognised: the gate sleeps, so the rollout does not wake everyone")
        void legacyRecognised() throws Exception {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            EngagementBrainClient brain = mock(EngagementBrainClient.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementDecisionService svc = new EngagementDecisionService(registry, contacts, gate, brain, members,
                    mock(EngagementActionRepository.class), prompts, mock(EngagementTemplateProposalRepository.class));
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("x");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));

            JsonNode timeline = json("{\"events\":[{\"at\":\"2026-10-20T10:00:00Z\",\"by\":\"STAFF\"}]}");
            DataPointProvider provider = mock(DataPointProvider.class);
            when(provider.key()).thenReturn("crm_timeline");
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(
                    List.of(provider), Map.of("crm_timeline", Map.of("m1", timeline))));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").userId("u1").build()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);

            Map<String, JsonNode> payloads = Map.of("crm_timeline", timeline);
            String legacy = svc.legacyFingerprint(payloads);
            assertNotEquals(legacy, svc.quantizedFingerprint(payloads));

            EngagementMember m = new EngagementMember();
            m.setId("m1");
            m.setEngineId("e1");
            m.setInstituteId(INST);
            m.setUserId("u1");
            m.setStatus("ACTIVE");
            m.setNextActionAt(Instant.now());
            m.setLastDecidedAt(Instant.now().minus(Duration.ofHours(10)));
            m.setWakeFingerprint(legacy);
            when(members.findById("m1")).thenReturn(Optional.of(m));

            svc.decideCohort(engine("{\"EMAIL\":{\"enabled\":true}}"), List.of(m));
            verify(brain, never()).decide(any(), anyString(), any(), any(), any(), any());
            verify(members).recordGateSleep(eq("m1"), eq(svc.quantizedFingerprint(payloads)), any(), any());
        }
    }

    // ── the timeline hook ──────────────────────────────────────────────────

    @Nested
    @DisplayName("Hook: which timeline events wake whom")
    class Hook {
        private final EngagementTimelineWakeHook hook = new EngagementTimelineWakeHook(mock(EngagementWakeService.class));

        private TimelineEvent event(String type, String typeId, String action, String actorType, String actorId,
                                    String metadata) {
            return TimelineEvent.builder().type(type).typeId(typeId).actionType(action).actorType(actorType)
                    .actorId(actorId).metadataJson(metadata).instituteId(INST).category(TimelineCategory.ACTIVITY)
                    .build();
        }

        @Test
        @DisplayName("a counsellor's note on a lead wakes it as a person's touch")
        void note() {
            WakeRequest r = hook.toRequest(event("LEAD", "ar1", "NOTE", "ADMIN", "c1", null));
            assertEquals("ar1", r.leadRowId());
            assertEquals(EngagementWakeService.NOTE, r.reason());
            assertTrue(r.human());
            assertEquals("user:c1", r.actorKey());
            assertEquals(INST, r.instituteId());
        }

        @Test
        @DisplayName("a status change is not a person's touch; an owner change is keyed by the lead profile")
        void statusAndOwner() {
            WakeRequest status = hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", "STATUS_CHANGED", "ADMIN", "c1", "{}"));
            assertEquals(EngagementWakeService.STATUS, status.reason());
            assertFalse(status.human());
            WakeRequest owner = hook.toRequest(event("USER_LEAD_PROFILE", "p1", "COUNSELOR_ASSIGNED", "ADMIN", "c1", null));
            assertEquals("p1", owner.profileId());
            assertEquals(EngagementWakeService.OWNER_CHANGED, owner.reason());
        }

        @Test
        @DisplayName("L5 / L6: a duplicate merge and a re-enquiry wake as a re-enquiry")
        void duplicateAndReEnquiry() {
            assertEquals(EngagementWakeService.RE_ENQUIRY,
                    hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", "DUPLICATE_MERGED", "SYSTEM", null, null)).reason());
            assertEquals(EngagementWakeService.RE_ENQUIRY,
                    hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", "RE_ENQUIRY", "SYSTEM", null, null)).reason());
        }

        @Test
        @DisplayName("a call event carries its call log, so the wake can tell an AI agent's call from a person's")
        void callCarriesCallLog() {
            WakeRequest r = hook.toRequest(event("LEAD", "ar1", "CALL_MADE", "USER", "c1", "{\"call_log_id\":\"cl1\"}"));
            assertEquals("cl1", r.callLogId());
            assertEquals(EngagementWakeService.HUMAN_CALL, r.reason());
        }

        @Test
        @DisplayName("a new lead is enrolled, not woken")
        void newLead() {
            WakeRequest r = hook.toRequest(event("AUDIENCE_RESPONSE", "ar9", "LEAD_SUBMITTED", "SYSTEM", null, "{}"));
            assertEquals(EngagementWakeService.NEW_LEAD, r.reason());
            assertEquals("SYSTEM:LEAD_SUBMITTED", r.actorKey());
        }

        @Test
        @DisplayName("the engine's own writes never wake it (actor, or a status change it made)")
        void engineWritesIgnored() {
            assertNull(hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", "STATUS_CHANGED", "ENGAGEMENT_ENGINE", null, null)));
            assertNull(hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", "STATUS_CHANGED", "SYSTEM", null,
                    "{\"source\":\"ENGAGEMENT_ENGINE\"}")));
        }

        @Test
        @DisplayName("noise does not wake: score updates, TAT edits, reach-out logs, applicants, converted")
        void noiseIgnored() {
            for (String action : List.of("SCORE_UPDATED", "MANUAL_SCORE_UPDATE", "TAT_DEADLINE_CHANGED", "REACHOUT",
                    "LEAD_AGENT_RESEARCH", "LEAD_CONVERTED")) {
                assertNull(hook.toRequest(event("AUDIENCE_RESPONSE", "ar1", action, "SYSTEM", null, null)), action);
            }
            assertNull(hook.toRequest(event("APPLICANT", "ap1", "NOTE", "ADMIN", "c1", null)));
        }
    }

    // ── the wake service ──────────────────────────────────────────────────

    @Nested
    @DisplayName("Wake service: after commit, debounced past the lease, bulk-capped")
    class Wake {
        private EngagementWakeDao dao;
        private EngagementMemberRepository members;
        private EngagementEngineService engines;
        private EngagementWakeService service;
        private long t0;

        @BeforeEach
        void setUp() {
            dao = mock(EngagementWakeDao.class);
            members = mock(EngagementMemberRepository.class);
            engines = mock(EngagementEngineService.class);
            service = new EngagementWakeService(dao, members, engines);
            t0 = System.currentTimeMillis();
            when(dao.leadRows(anyString(), any())).thenAnswer(inv -> List.of(new EngagementWakeDao.LeadRow(
                    inv.getArgument(0), INST, "list-1", null, null, "9876543210")));
            when(dao.liveMemberIds(eq(INST), anyCollection(), anyCollection(), anyCollection()))
                    .thenReturn(List.of("m1"));
            when(members.wake(anyList(), any(), any(), anyString(), anyBoolean(), anyBoolean())).thenReturn(1);
        }

        @AfterEach
        void clearTx() {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.clearSynchronization();
            }
        }

        private WakeRequest lead(String leadRow, String reason, boolean human, String actor) {
            return new WakeRequest(INST, leadRow, null, null, null, null, reason, human, actor);
        }

        private int drainLater() {
            return service.drain(System.currentTimeMillis() + 10_000);
        }

        @Test
        @DisplayName("inside a transaction the wake is queued only after commit; a rollback wakes nobody")
        void afterCommitOnly() {
            TransactionSynchronizationManager.initSynchronization();
            service.request(lead("ar1", EngagementWakeService.NOTE, true, "user:c1"));
            assertEquals(0, service.queuedCount());
            List<TransactionSynchronization> syncs = TransactionSynchronizationManager.getSynchronizations();
            syncs.forEach(s -> s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
            assertEquals(0, service.queuedCount());
            syncs.forEach(TransactionSynchronization::afterCommit);
            assertEquals(1, service.queuedCount());
        }

        @Test
        @DisplayName("a request waits to settle (a journey event commits before its caller), then wakes")
        void settlesThenWakes() {
            service.request(lead("ar1", EngagementWakeService.NOTE, true, "user:c1"));
            assertEquals(0, service.drain(t0));
            verify(members, never()).wake(anyList(), any(), any(), anyString(), anyBoolean(), anyBoolean());
            assertEquals(1, drainLater());
            verify(members).wake(eq(List.of("m1")), any(), any(), eq(EngagementWakeService.NOTE), eq(true), eq(false));
        }

        @Test
        @DisplayName("the wake time is past any lease or auto-reply hold (15 min) and within 20 min")
        void wakeTimeIsPastTheLease() {
            Instant now = Instant.now();
            service.apply(lead("ar1", EngagementWakeService.STATUS, false, "user:c1"), now);
            ArgumentCaptor<Instant> wakeAt = ArgumentCaptor.forClass(Instant.class);
            verify(members).wake(anyList(), eq(now), wakeAt.capture(), anyString(), anyBoolean(), anyBoolean());
            long minutes = Duration.between(now, wakeAt.getValue()).toMinutes();
            assertTrue(minutes >= 15 && minutes <= 20, minutes + " min");
        }

        @Test
        @DisplayName("a note, a status change and a follow-up on one lead in one drain: one wake, as a person's touch")
        void burstOnOneLeadIsOneWake() {
            service.request(lead("ar1", EngagementWakeService.STATUS, false, "user:c1"));
            service.request(lead("ar1", EngagementWakeService.NOTE, true, "user:c1"));
            service.request(lead("ar1", EngagementWakeService.FOLLOWUP, true, "user:c1"));
            assertEquals(1, drainLater());
            verify(members, times(1)).wake(anyList(), any(), any(), anyString(), eq(true), anyBoolean());
        }

        @Test
        @DisplayName("S2: one person changing 51 leads at once wakes none of them")
        void bulkChangeWakesNone() {
            for (int i = 0; i < 51; i++) service.request(lead("ar" + i, EngagementWakeService.STATUS, false, "user:admin"));
            assertEquals(0, drainLater());
            verify(members, never()).wake(anyList(), any(), any(), anyString(), anyBoolean(), anyBoolean());
        }

        @Test
        @DisplayName("S2: 50 leads is still a normal session and all are woken; the window then stays bulk")
        void fiftyIsFine() {
            for (int i = 0; i < 50; i++) service.request(lead("ar" + i, EngagementWakeService.STATUS, false, "user:admin"));
            assertEquals(50, drainLater());
            service.request(lead("ar-next", EngagementWakeService.STATUS, false, "user:admin"));
            assertEquals(0, drainLater(), "the 51st within the window is part of the bulk change");
        }

        @Test
        @DisplayName("S2: the cap is per person — another counsellor's note still wakes")
        void capIsPerActor() {
            for (int i = 0; i < 51; i++) service.request(lead("ar" + i, EngagementWakeService.STATUS, false, "user:admin"));
            service.request(lead("ar-other", EngagementWakeService.NOTE, true, "user:c2"));
            assertEquals(1, drainLater());
        }

        @Test
        @DisplayName("AI call outcomes are one real event per lead and are not capped")
        void aiCallsUncapped() {
            for (int i = 0; i < 60; i++) {
                service.wakeLead(INST, "ar" + i, null, EngagementWakeService.AI_CALL, false);
            }
            assertEquals(60, drainLater());
        }

        @Test
        @DisplayName("L6: a re-enquiry puts the member first in the due scan (tier 0)")
        void reEnquiryIsHot() {
            service.apply(lead("ar1", EngagementWakeService.RE_ENQUIRY, false, "SYSTEM:RE_ENQUIRY"), Instant.now());
            verify(members).wake(anyList(), any(), any(), eq(EngagementWakeService.RE_ENQUIRY), eq(false), eq(true));
        }

        @Test
        @DisplayName("L5: the event's lead row, its account and its phone all find the one member of that person")
        void findsThePersonByRowAccountAndPhone() {
            when(dao.leadRows(eq("ar-dup"), any())).thenReturn(List.of(new EngagementWakeDao.LeadRow(
                    "ar-dup", INST, "list-1", "u7", "s7", "9876543210")));
            service.apply(lead("ar-dup", EngagementWakeService.RE_ENQUIRY, false, "SYSTEM:DUPLICATE_MERGED"), Instant.now());
            verify(dao).liveMemberIds(eq(INST),
                    argThat(rows -> rows.contains("ar-dup")),
                    argThat(users -> users.containsAll(List.of("u7", "s7"))),
                    argThat(phones -> phones.contains("9876543210")));
        }

        @Test
        @DisplayName("a call analysis: a person's call is a touch; an AI agent's call is not")
        void callAnalysisHumanOrAgent() {
            when(dao.call("cl-human")).thenReturn(new EngagementWakeDao.CallRow("ar1", "u1", INST, false));
            when(dao.call("cl-ai")).thenReturn(new EngagementWakeDao.CallRow("ar2", "u2", INST, true));
            service.callAnalyzed(INST, "cl-human");
            service.callAnalyzed(INST, "cl-ai");
            drainLater();
            verify(members).wake(anyList(), any(), any(), eq(EngagementWakeService.CALL_ANALYZED), eq(true), eq(false));
            verify(members).wake(anyList(), any(), any(), eq(EngagementWakeService.CALL_ANALYZED), eq(false), eq(false));
        }

        @Test
        @DisplayName("a call from another institute wakes nobody")
        void callFromAnotherInstitute() {
            when(dao.call("cl-x")).thenReturn(new EngagementWakeDao.CallRow("ar1", "u1", "other-inst", false));
            assertFalse(service.apply(new WakeRequest(INST, null, null, null, null, "cl-x",
                    EngagementWakeService.CALL_ANALYZED, true, "SYSTEM:CALL_ANALYZED"), Instant.now()));
            verify(members, never()).wake(anyList(), any(), any(), anyString(), anyBoolean(), anyBoolean());
        }

        @Test
        @DisplayName("a lead row that does not exist (rolled back) wakes nobody beyond its account id")
        void missingLeadRow() {
            when(dao.leadRows(eq("gone"), any())).thenReturn(List.of());
            when(dao.liveMemberIds(eq(INST), anyCollection(), anyCollection(), anyCollection())).thenReturn(List.of());
            assertFalse(service.apply(lead("gone", EngagementWakeService.NOTE, true, "user:c1"), Instant.now()));
        }

        @Test
        @DisplayName("a new lead is enrolled into the engines targeting its list")
        void newLeadEnrolled() {
            when(engines.enrollNewLead(INST, "list-1", "ar9", null)).thenReturn(1);
            assertTrue(service.apply(lead("ar9", EngagementWakeService.NEW_LEAD, false, "SYSTEM:LEAD_SUBMITTED"), Instant.now()));
            verify(engines).enrollNewLead(INST, "list-1", "ar9", null);
            verify(members, never()).wake(anyList(), any(), any(), anyString(), anyBoolean(), anyBoolean());
        }

        @Test
        @DisplayName("S2: a CSV import of 51 leads is not enrolled within minutes (the nightly reconcile takes them)")
        void bulkImportNotEnrolled() {
            for (int i = 0; i < 51; i++) service.request(lead("imp" + i, EngagementWakeService.NEW_LEAD, false, "SYSTEM:LEAD_SUBMITTED"));
            assertEquals(0, drainLater());
            verify(engines, never()).enrollNewLead(anyString(), anyString(), anyString(), any());
        }

        @Test
        @DisplayName("switched off: nothing is queued")
        void disabled() {
            ReflectionTestUtils.setField(service, "enabled", false);
            service.request(lead("ar1", EngagementWakeService.NOTE, true, "user:c1"));
            assertEquals(0, service.queuedCount());
        }
    }
}
