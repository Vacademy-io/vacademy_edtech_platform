package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
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
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * F2 / L3: a lead opted out (or removed) in the CRM after enrollment. The consent store is keyed by
 * user_id, so before this an unconverted lead was decided and sent to until the nightly reconcile.
 */
class EngagementLeadConsentTest {

    private static EngagementEngine engine() {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId("i1");
        e.setName("Nurture leads");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
        e.setQuietHours("{}");
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    /** An unconverted lead: lead row, no user_id. */
    private static EngagementMember lead() {
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setEngineId("e1");
        m.setInstituteId("i1");
        m.setAudienceResponseId("r1");
        m.setStatus("ACTIVE");
        m.setNextActionAt(Instant.now());
        return m;
    }

    @Nested
    @DisplayName("PolicyGate.blockedLeads reads the lead row")
    class Classify {
        private EngagementReadDao dao;
        private PolicyGate gate;

        @BeforeEach
        void setUp() {
            dao = mock(EngagementReadDao.class);
            gate = new PolicyGate(dao, mock(EngagementActionRepository.class));
        }

        @Test
        @DisplayName("L3: OPTED_OUT lead is opted out, INACTIVE or missing row is exited, ACTIVE passes")
        void L3_classifiesLeadRows() {
            when(dao.leadConsentRows(eq("i1"), anyCollection())).thenReturn(List.of(
                    new Object[] {"r-opted", "OPTED_OUT", "ACTIVE"},
                    new Object[] {"r-removed", null, "INACTIVE"},
                    new Object[] {"r-ok", null, "ACTIVE"},
                    new Object[] {"r-ok-other-status", "INTERESTED", "ACTIVE"}));

            Map<String, PolicyGate.LeadBlock> blocked = gate.blockedLeads("i1",
                    List.of("r-opted", "r-removed", "r-ok", "r-ok-other-status", "r-missing"));

            assertEquals(PolicyGate.LeadBlock.OPTED_OUT, blocked.get("r-opted"));
            assertEquals(PolicyGate.LeadBlock.EXITED, blocked.get("r-removed"));
            assertEquals(PolicyGate.LeadBlock.EXITED, blocked.get("r-missing"));
            assertEquals(3, blocked.size());
        }

        @Test
        @DisplayName("L3: opted out wins over removed when both are set")
        void L3_optOutWinsOverRemoved() {
            when(dao.leadConsentRows(eq("i1"), anyCollection())).thenReturn(List.<Object[]>of(
                    new Object[] {"r1", "OPTED_OUT", "INACTIVE"}));
            assertEquals(PolicyGate.LeadBlock.OPTED_OUT, gate.leadBlock("i1", "r1"));
        }

        @Test
        @DisplayName("L3: a member without a lead row is not looked up")
        void L3_noLeadNoQuery() {
            assertNull(gate.leadBlock("i1", null));
            assertTrue(gate.blockedLeads("i1", List.of()).isEmpty());
            verifyNoInteractions(dao);
        }
    }

    @Nested
    @DisplayName("decision time: no LLM call for a blocked lead")
    class AtDecision {
        private EngagementBrainClient brain;
        private PolicyGate gate;
        private EngagementMemberRepository members;
        private EngagementDecisionService service;
        private EngagementMember member;

        @BeforeEach
        void setUp() {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            ContactResolver contacts = mock(ContactResolver.class);
            gate = mock(PolicyGate.class);
            brain = mock(EngagementBrainClient.class);
            members = mock(EngagementMemberRepository.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members,
                    mock(EngagementActionRepository.class), prompts, mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "recentWindowDays", 14);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);

            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nurture new leads.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));

            member = lead();
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").audienceResponseId("r1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        }

        @Test
        @DisplayName("L3: lead opted out in the CRM after enrollment → OPTED_OUT, no LLM call")
        void L3_optedOutLeadNotDecided() {
            when(gate.blockedLeads(eq("i1"), anyCollection()))
                    .thenReturn(Map.of("r1", PolicyGate.LeadBlock.OPTED_OUT));

            assertEquals(0, service.decideCohort(engine(), List.of(member)));

            assertEquals("OPTED_OUT", member.getStatus());
            verify(members).save(member);
            verifyNoInteractions(brain);
        }

        @Test
        @DisplayName("L3: lead removed in the CRM → EXITED (the reconcile revives it if restored), no LLM call")
        void L3_removedLeadExited() {
            when(gate.blockedLeads(eq("i1"), anyCollection()))
                    .thenReturn(Map.of("r1", PolicyGate.LeadBlock.EXITED));

            service.decideCohort(engine(), List.of(member));

            assertEquals("EXITED", member.getStatus());
            verifyNoInteractions(brain);
        }

        @Test
        @DisplayName("L3: one batch lookup for the cohort, by lead id")
        void L3_batchLookup() {
            when(gate.blockedLeads(eq("i1"), anyCollection()))
                    .thenReturn(Map.of("r1", PolicyGate.LeadBlock.OPTED_OUT));
            service.decideCohort(engine(), List.of(member));
            verify(gate).blockedLeads("i1", List.of("r1"));
        }
    }

    @Nested
    @DisplayName("send time: autonomous dispatch")
    class AtDispatch {
        private EngagementActionRepository actions;
        private PolicyGate gate;
        private EngagementDispatcher dispatcher;
        private EngagementDispatchJob job;
        private EngagementAction send;

        @BeforeEach
        void setUp() {
            actions = mock(EngagementActionRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            gate = mock(PolicyGate.class);
            dispatcher = mock(EngagementDispatcher.class);
            job = new EngagementDispatchJob(actions, engines, members, gate, dispatcher, mock(CreditClient.class));
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
            when(engines.findById("e1")).thenReturn(Optional.of(engine()));
            when(members.findById("m1")).thenReturn(Optional.of(lead()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
        }

        @Test
        @DisplayName("L3: a due SEND for a lead who opted out in the CRM is withdrawn, nothing sent")
        void L3_optedOutLeadSendWithdrawn() {
            when(gate.leadBlock("i1", "r1")).thenReturn(PolicyGate.LeadBlock.OPTED_OUT);
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), anyString(), any());
            verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("L3: a due SEND for a lead removed in the CRM is withdrawn")
        void L3_removedLeadSendWithdrawn() {
            when(gate.leadBlock("i1", "r1")).thenReturn(PolicyGate.LeadBlock.EXITED);
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("L3: an AI-call promise stops on an opt-out, not on a removed lead row")
        void L3_aiCallPromiseOnlyStopsOnOptOut() {
            EngagementAction promise = new EngagementAction();
            promise.setSource(EngagementAction.SOURCE_AI_CALL);
            assertNotNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.OPTED_OUT, promise));
            assertNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.EXITED, promise));
            assertNull(EngagementDispatchJob.leadNotSendableReason(null, promise));
            assertNotNull(EngagementDispatchJob.leadNotSendableReason(PolicyGate.LeadBlock.EXITED, new EngagementAction()));
        }
    }

    @Nested
    @DisplayName("send time: a human's Review & send")
    class AtHumanSend {
        private NotificationService notifications;
        private EngagementActionRepository actions;
        private PolicyGate gate;
        private EngagementDispatcher dispatcher;

        @BeforeEach
        void setUp() {
            notifications = mock(NotificationService.class);
            actions = mock(EngagementActionRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            ContactResolver contacts = mock(ContactResolver.class);
            gate = mock(PolicyGate.class);
            dispatcher = new EngagementDispatcher(notifications, actions, members,
                    mock(TimelineEventService.class), contacts, mock(EngagementInternalClients.class),
                    mock(EngagementEngineRepository.class), gate);
            when(members.findById("m1")).thenReturn(Optional.of(lead()));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder()
                    .memberId("m1").audienceResponseId("r1").email("lead@test.local").build()));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        }

        private EngagementAction task() {
            EngagementAction a = new EngagementAction();
            a.setId("a1");
            a.setEngineId("e1");
            a.setMemberId("m1");
            a.setInstituteId("i1");
            a.setKind("TASK");
            a.setStatus("DISPATCHING");
            a.setChannel("EMAIL");
            a.setDraftBody("Hi, following up on your enquiry.");
            return a;
        }

        @Test
        @DisplayName("L3: a task drafted before the lead opted out in the CRM is refused and returned to OPEN")
        void L3_humanSendRefusedForOptedOutLead() {
            when(gate.leadBlock("i1", "r1")).thenReturn(PolicyGate.LeadBlock.OPTED_OUT);
            EngagementAction task = task();

            assertThrows(VacademyException.class, () -> dispatcher.dispatchClaimed(task, null, "admin-1"));

            assertEquals("OPEN", task.getStatus());
            verifyNoInteractions(notifications);
        }
    }
}
