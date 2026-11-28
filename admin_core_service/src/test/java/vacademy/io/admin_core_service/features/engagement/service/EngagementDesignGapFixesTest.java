package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.math.BigDecimal;
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
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Gaps found by testing main against the Lead Engagement Engine design (28 Oct): an opt-out an
 * engine created later did not know about, a CRM Converted lead still messaged, Hinglish
 * not-interested and callback replies going unnoticed, and one person enrolled twice.
 */
class EngagementDesignGapFixesTest {

    private static final String LEAD_ONLY = "[{\"type\":\"AUDIENCE\",\"id\":\"aud-1\"}]";
    private static final String MIXED = "[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps-1\"},{\"type\":\"AUDIENCE\",\"id\":\"aud-1\"}]";

    private static EngagementEngine engine(String audience) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId("i1");
        e.setName("Nurture leads");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setAudience(audience);
        e.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
        e.setQuietHours("{}");
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    private static EngagementMember member(String userId) {
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setEngineId("e1");
        m.setInstituteId("i1");
        m.setUserId(userId);
        m.setAudienceResponseId("r1");
        m.setStatus("ACTIVE");
        m.setNextActionAt(Instant.now());
        return m;
    }

    @Nested
    @DisplayName("Hinglish replies")
    class Patterns {
        @Test
        void notInterestedInHinglishIsAStopMention() {
            for (String yes : List.of("interested nahi hai", "mujhe nahi chahiye", "call mat karo", "please disturb mat karo")) {
                assertTrue(EngagementReplyResponder.STOP_MENTION.matcher(yes).find(), yes);
                assertFalse(EngagementReplyResponder.OPT_OUT.matcher(yes).find(), "not a full opt-out: " + yes);
            }
            for (String no : List.of("abhi nahi", "kal class hai na?", "fees kitni hai")) {
                assertFalse(EngagementReplyResponder.STOP_MENTION.matcher(no).find(), no);
            }
        }

        @Test
        void callbackRequests() {
            for (String yes : List.of("baad mein call karo kal 5 baje", "call me tomorrow 5 pm", "please call back",
                    "kal call karna", "call karo shaam ko", "bad me baat karte hai")) {
                assertTrue(EngagementReplyResponder.CALLBACK.matcher(yes).find(), yes);
            }
            for (String no : List.of("class kal hai", "I missed the call", "callbacks are slow", "thanks")) {
                assertFalse(EngagementReplyResponder.CALLBACK.matcher(no).find(), no);
            }
        }
    }

    @Nested
    @DisplayName("replies on engines without auto-reply")
    class NoAutoReply {
        private EngagementMemberRepository members;
        private EngagementActionRepository actions;
        private EngagementReplyMemberQueries replyQueries;
        private EngagementReplyResponder responder;

        @BeforeEach
        void setUp() {
            members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            replyQueries = mock(EngagementReplyMemberQueries.class);
            responder = new EngagementReplyResponder(members, mock(EngagementEngineRepository.class),
                    mock(EngagementPromptVersionRepository.class), actions, mock(EngagementReplyBrain.class),
                    mock(EngagementDispatcher.class));
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
            ReflectionTestUtils.setField(responder, "replyMemberQueries", replyQueries);
            when(members.findAutoReplyCandidates(eq("i1"), eq("9100000006"), any())).thenReturn(List.of());
            EngagementReplyMemberQueries.LiveMember live = mock(EngagementReplyMemberQueries.LiveMember.class);
            when(live.getMemberId()).thenReturn("m1");
            when(live.getEngineId()).thenReturn("e1");
            when(live.getCadenceHours()).thenReturn(72);
            when(replyQueries.findLiveMembersByPhone("i1", "9100000006")).thenReturn(List.of(live));
            when(members.claimHandledReply(eq("i1"), anyString(), any())).thenReturn(1);
        }

        @Test
        @DisplayName("T3: 'baad mein call karo' raises a callback item for a person, nobody is opted out")
        void callbackRaisesHumanItem() {
            assertTrue(responder.handleReply("i1", "9100000006", "baad mein call karo kal 5 baje", "w1"));
            verify(actions).save(argThat(a -> "REPLY".equals(a.getKind()) && "OPEN".equals(a.getStatus())
                    && a.getRationale().startsWith("Escalated (callback)")
                    && a.getPriority().compareTo(BigDecimal.valueOf(85)) == 0));
            verify(members).markReplyHandled(eq("m1"), any(), any());
            verify(members, never()).optOutByPhone(anyString(), anyString(), any());
        }

        @Test
        @DisplayName("'interested nahi hai' raises a stop-mention item")
        void hinglishNotInterested() {
            assertTrue(responder.handleReply("i1", "9100000006", "interested nahi hai", "w2"));
            verify(actions).save(argThat(a -> a.getRationale().startsWith("Escalated (stop-mention)")));
            verify(members, never()).optOutByPhone(anyString(), anyString(), any());
        }

        @Test
        @DisplayName("'abhi nahi' is left to the sweep, as before")
        void abhiNahiUntouched() {
            assertFalse(responder.handleReply("i1", "9100000006", "abhi nahi", "w3"));
            verifyNoInteractions(actions);
        }
    }

    @Nested
    @DisplayName("a lead the CRM marked Converted")
    class Converted {
        @Test
        void blockedLeadsReadsTheLeadStage() {
            EngagementReadDao dao = mock(EngagementReadDao.class);
            PolicyGate gate = new PolicyGate(dao, mock(EngagementActionRepository.class));
            when(dao.leadConsentRows(eq("i1"), anyCollection())).thenReturn(List.of(
                    new Object[] {"r-conv", null, "ACTIVE", "CONVERTED"},
                    new Object[] {"r-opted-conv", "OPTED_OUT", "ACTIVE", "CONVERTED"},
                    new Object[] {"r-ok", null, "ACTIVE", null},
                    new Object[] {"r-old-shape", null, "ACTIVE"}));
            Map<String, PolicyGate.LeadBlock> b = gate.blockedLeads("i1",
                    List.of("r-conv", "r-opted-conv", "r-ok", "r-old-shape"));
            assertEquals(PolicyGate.LeadBlock.CONVERTED, b.get("r-conv"));
            assertEquals(PolicyGate.LeadBlock.OPTED_OUT, b.get("r-opted-conv"));
            assertEquals(2, b.size());
        }

        @Test
        @DisplayName("stops a lead-only engine; a learner engine keeps a converted lead who has an account")
        void effectiveBlock() {
            PolicyGate.LeadBlock c = PolicyGate.LeadBlock.CONVERTED;
            assertEquals(c, PolicyGate.effectiveLeadBlock(c, engine(LEAD_ONLY), member("u1")));
            assertEquals(c, PolicyGate.effectiveLeadBlock(c, engine(LEAD_ONLY), member(null)));
            assertNull(PolicyGate.effectiveLeadBlock(c, engine(MIXED), member("u1")));
            assertEquals(c, PolicyGate.effectiveLeadBlock(c, engine(MIXED), member(null)));
            assertNull(PolicyGate.effectiveLeadBlock(c, engine("not json"), member("u1")));
            assertEquals(PolicyGate.LeadBlock.OPTED_OUT,
                    PolicyGate.effectiveLeadBlock(PolicyGate.LeadBlock.OPTED_OUT, engine(MIXED), member("u1")));
            assertNull(PolicyGate.effectiveLeadBlock(null, engine(LEAD_ONLY), member(null)));
        }

        @Test
        @DisplayName("an AI-call promise is still kept for a converted lead")
        void promiseKept() {
            EngagementAction promise = new EngagementAction();
            promise.setSource(EngagementAction.SOURCE_AI_CALL);
            assertNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.CONVERTED, promise));
            String reason = EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.CONVERTED, new EngagementAction());
            assertNotNull(reason);
            assertTrue(reason.contains("Converted"), reason);
        }

        private EngagementDecisionService decisionService(PolicyGate gate, EngagementBrainClient brain,
                                                          EngagementMemberRepository members, EngagementMember m) {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            EngagementDecisionService service = new EngagementDecisionService(registry, contacts, gate, brain, members,
                    mock(EngagementActionRepository.class), prompts, mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nurture new leads.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(m));
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").userId(m.getUserId()).audienceResponseId("r1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(gate.blockedLeads(eq("i1"), anyCollection())).thenReturn(Map.of("r1", PolicyGate.LeadBlock.CONVERTED));
            return service;
        }

        @Test
        @DisplayName("T11: decision time, lead-only engine: the member leaves as EXITED, no LLM call")
        void decisionExitsOnLeadOnlyEngine() {
            PolicyGate gate = mock(PolicyGate.class);
            EngagementBrainClient brain = mock(EngagementBrainClient.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementMember m = member(null);
            decisionService(gate, brain, members, m).decideCohort(engine(LEAD_ONLY), List.of(m));
            assertEquals("EXITED", m.getStatus());
            verifyNoInteractions(brain);
        }

        @Test
        @DisplayName("decision time, learner engine: a converted lead with an account is decided as before")
        void decisionKeepsLearner() {
            PolicyGate gate = mock(PolicyGate.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementMember m = member("u1");
            decisionService(gate, mock(EngagementBrainClient.class), members, m).decideCohort(engine(MIXED), List.of(m));
            assertEquals("ACTIVE", m.getStatus());
            verify(gate).preDecision(any(), any());
        }

        private EngagementDispatchJob dispatchJob(EngagementActionRepository actions, PolicyGate gate,
                                                  EngagementEngine engine, EngagementMember m) {
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            EngagementDispatchJob job = new EngagementDispatchJob(actions, engines, members, gate,
                    mock(EngagementDispatcher.class), mock(CreditClient.class));
            ReflectionTestUtils.setField(job, "batch", 100);
            ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
            ReflectionTestUtils.setField(job, "maxUnbilled", 25);
            EngagementAction send = new EngagementAction();
            send.setId("a1");
            send.setEngineId("e1");
            send.setMemberId("m1");
            send.setInstituteId("i1");
            send.setKind("SEND");
            send.setStatus("OPEN");
            send.setChannel("EMAIL");
            when(actions.findDueAutoSends(any(), anyInt())).thenReturn(List.of(send));
            when(actions.findUnbilledSent(anyInt())).thenReturn(List.of());
            when(engines.findById("e1")).thenReturn(Optional.of(engine));
            when(members.findById("m1")).thenReturn(Optional.of(m));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(gate.leadBlock("i1", "r1")).thenReturn(PolicyGate.LeadBlock.CONVERTED);
            return job;
        }

        @Test
        @DisplayName("T11: send time, lead-only engine: the pending touch is withdrawn")
        void dispatchWithdrawsOnLeadOnlyEngine() {
            EngagementActionRepository actions = mock(EngagementActionRepository.class);
            dispatchJob(actions, mock(PolicyGate.class), engine(LEAD_ONLY), member(null)).dispatch();
            verify(actions).withdrawDueSend(eq("a1"), argThat(r -> r.contains("Converted")), any());
            verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
        }

        @Test
        @DisplayName("send time, learner engine: a converted learner's send is not withdrawn for it")
        void dispatchKeepsLearner() {
            EngagementActionRepository actions = mock(EngagementActionRepository.class);
            dispatchJob(actions, mock(PolicyGate.class), engine(MIXED), member("u1")).dispatch();
            verify(actions, never()).withdrawDueSend(anyString(), anyString(), any());
        }
    }

    @Nested
    @DisplayName("enrolment")
    class Enrolment {
        private EngagementEngineRepository engines;
        private EngagementMemberRepository members;
        private EngagementReadDao dao;
        private EngagementEngineService service;

        @BeforeEach
        void setUp() {
            engines = mock(EngagementEngineRepository.class);
            members = mock(EngagementMemberRepository.class);
            dao = mock(EngagementReadDao.class);
            service = new EngagementEngineService(engines, members, mock(EngagementPromptVersionRepository.class),
                    mock(EngagementTemplateProposalRepository.class), dao);
        }

        private void enrolledExactly(String... responseIds) {
            for (String r : responseIds) {
                verify(members).enrollOrStamp(anyString(), eq("e1"), eq("i1"), any(), eq(r), any(), anyString(), anyInt());
            }
            verify(members, org.mockito.Mockito.times(responseIds.length))
                    .enrollOrStamp(anyString(), anyString(), anyString(), any(), any(), any(), anyString(), anyInt());
        }

        @Test
        @DisplayName("T13 + T4 + T11: one member per phone, opted-out people and converted leads left out")
        void leadOnlyReconcile() {
            when(engines.findById("e1")).thenReturn(Optional.of(engine(LEAD_ONLY)));
            when(dao.leadsByAudience("aud-1", "i1")).thenReturn(List.of(
                    new Object[] {"r1", null, "9100000001", null},
                    new Object[] {"r2", null, "9100000001", null},       // same person, newer row
                    new Object[] {"r3", null, "9100000003", "CONVERTED"},
                    new Object[] {"r4", "u4", "9100000004", "CONVERTED"},
                    new Object[] {"r5", null, "9100000005", null},       // said STOP to another engine
                    new Object[] {"r6", null, null, null}));
            when(dao.optedOutSubjects("i1")).thenReturn(List.<Object[]>of(new Object[] {null, "r-old", "9100000005"}));

            assertEquals(2, service.enrollAndReconcile("e1", "i1").audienceSize());
            enrolledExactly("r1", "r6");
        }

        @Test
        @DisplayName("learner engine: a converted lead with an account stays; an opted-out learner is not enrolled")
        void mixedReconcile() {
            when(engines.findById("e1")).thenReturn(Optional.of(engine(MIXED)));
            when(dao.userIdsByPackageSession("ps-1", "i1")).thenReturn(List.of("u4", "u9"));
            when(dao.leadsByAudience("aud-1", "i1")).thenReturn(List.<Object[]>of(
                    new Object[] {"r4", "u4", "9100000004", "CONVERTED"}));
            when(dao.optedOutSubjects("i1")).thenReturn(List.<Object[]>of(new Object[] {"u9", null, "9000000009"}));

            service.enrollAndReconcile("e1", "i1");

            verify(members).enrollOrStamp(anyString(), eq("e1"), eq("i1"), eq("u4"), eq("r4"), any(), anyString(), anyInt());
            verify(members, never()).enrollOrStamp(anyString(), anyString(), anyString(), eq("u9"), any(), any(), anyString(), anyInt());
        }

        @Test
        @DisplayName("old two-column rows still enrol (nothing deduped or skipped)")
        void oldRowShape() {
            when(engines.findById("e1")).thenReturn(Optional.of(engine(LEAD_ONLY)));
            when(dao.leadsByAudience("aud-1", "i1")).thenReturn(List.of(
                    new Object[] {"r1", null}, new Object[] {"r2", null}));
            service.enrollAndReconcile("e1", "i1");
            enrolledExactly("r1", "r2");
        }

        @Test
        @DisplayName("intake: an opted-out person is not enrolled anywhere")
        void intakeOptedOut() {
            when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(engine(LEAD_ONLY)));
            when(dao.leadPhone10("r7")).thenReturn("9100000005");
            when(dao.optedOutSubjects("i1")).thenReturn(List.<Object[]>of(new Object[] {null, "r-old", "9100000005"}));
            assertEquals(0, service.enrollNewLead("i1", "aud-1", "r7", null));
            verify(members, never()).enrollOrStamp(anyString(), anyString(), anyString(), any(), any(), any(), anyString(), anyInt());
        }

        @Test
        @DisplayName("T13 intake: the same person already in the engine is not added again")
        void intakeSamePerson() {
            when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(engine(LEAD_ONLY)));
            when(dao.leadPhone10("r7")).thenReturn("9100000001");
            when(dao.liveMembersForSamePerson("e1", "r7", null, "9100000001")).thenReturn(1L);
            assertEquals(0, service.enrollNewLead("i1", "aud-1", "r7", null));
            verify(members, never()).enrollOrStamp(anyString(), anyString(), anyString(), any(), any(), any(), anyString(), anyInt());
        }

        @Test
        @DisplayName("intake: a new person joins as before")
        void intakeNewPerson() {
            when(engines.findByInstituteIdOrderByCreatedAtDesc("i1")).thenReturn(List.of(engine(LEAD_ONLY)));
            when(dao.leadPhone10("r7")).thenReturn("9100000077");
            assertEquals(1, service.enrollNewLead("i1", "aud-1", "r7", null));
            verify(members).enrollOrStamp(anyString(), eq("e1"), eq("i1"), isNull(), eq("r7"), any(), anyString(), anyInt());
        }
    }
}
