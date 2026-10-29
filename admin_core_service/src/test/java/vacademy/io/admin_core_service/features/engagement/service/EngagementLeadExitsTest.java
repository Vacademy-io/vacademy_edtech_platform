package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.service.AudienceOptOutService;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries.LiveMember;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Design exits on today's engine: an opt-out is mirrored into the CRM (T4), a plain "not
 * interested" exits the lead (T6), a lead marked Converted leaves within one exit sweep (T11),
 * email replies are read (T17), and lead nurture workflows skip leads an engine is working (T12).
 */
class EngagementLeadExitsTest {

    private static final String INST = "inst-1";
    private static final String LEAD_ENGINE = "e-lead";
    private static final String LEARNER_ENGINE = "e-learn";

    private EngagementMemberRepository members;
    private EngagementActionRepository actions;
    private EngagementEngineRepository engines;
    private EngagementCrmMirrorDao crm;
    private PolicyGate gate;
    private AudienceOptOutService optOutList;
    private LeadStatusService leadStatuses;
    private TimelineEventService timeline;
    private EngagementLeadOutcomeService outcomes;

    @BeforeEach
    void setUp() {
        members = mock(EngagementMemberRepository.class);
        actions = mock(EngagementActionRepository.class);
        engines = mock(EngagementEngineRepository.class);
        crm = mock(EngagementCrmMirrorDao.class);
        gate = mock(PolicyGate.class);
        optOutList = mock(AudienceOptOutService.class);
        leadStatuses = mock(LeadStatusService.class);
        timeline = mock(TimelineEventService.class);
        outcomes = new EngagementLeadOutcomeService(members, actions, engines, crm, gate);
        ReflectionTestUtils.setField(outcomes, "audienceOptOutService", optOutList);
        ReflectionTestUtils.setField(outcomes, "leadStatusService", leadStatuses);
        ReflectionTestUtils.setField(outcomes, "timelineEventService", timeline);
        when(engines.findAllById(any())).thenReturn(List.of(
                engine(LEAD_ENGINE, "[{\"type\":\"AUDIENCE\",\"id\":\"list-1\"}]"),
                engine(LEARNER_ENGINE, "[{\"type\":\"PACKAGE_SESSION\",\"id\":\"ps-1\"}]")));
    }

    private static EngagementEngine engine(String id, String audience) {
        EngagementEngine e = new EngagementEngine();
        e.setId(id);
        e.setInstituteId(INST);
        e.setAudience(audience);
        return e;
    }

    static LiveMember live(String memberId, String engineId, String userId, String leadRow) {
        LiveMember m = mock(LiveMember.class);
        when(m.getMemberId()).thenReturn(memberId);
        when(m.getEngineId()).thenReturn(engineId);
        when(m.getUserId()).thenReturn(userId);
        when(m.getAudienceResponseId()).thenReturn(leadRow);
        when(m.getCadenceHours()).thenReturn(72);
        return m;
    }

    private static LeadStatus status(String id, String key, String label) {
        LeadStatus s = new LeadStatus();
        s.setId(id);
        s.setStatusKey(key);
        s.setLabel(label);
        return s;
    }

    // ==================== T4: opt-out mirrored into the CRM ====================

    @Nested
    class OptOutMirror {

        @Test
        @DisplayName("T4: account holder goes to the opt-out list, every lead row is marked OPTED_OUT, timeline says why")
        void mirrorsIntoCrm() {
            outcomes.mirrorOptOut(INST, List.of(live("m1", LEAD_ENGINE, "u1", "ar1"),
                    live("m2", LEAD_ENGINE, null, "ar2")), "WHATSAPP", "band karo");

            verify(optOutList).moveUserToOptOutAudience("u1", INST, "WHATSAPP");
            verify(crm).markLeadsOptedOut(eq(INST), argThat(ids -> Set.copyOf(ids).equals(Set.of("ar1", "ar2"))));
            verify(timeline).logJourneyEvent(eq("AUDIENCE_RESPONSE"), eq("ar2"), any(), anyString(), isNull(),
                    anyString(), argThat(t -> t.startsWith("Opted out")), argThat(d -> d.contains("band karo")),
                    any(), isNull());
        }

        @Test
        @DisplayName("T4: a CRM failure never undoes the engine's own opt-out")
        void crmFailureIsContained() {
            doThrow(new RuntimeException("db down")).when(optOutList).moveUserToOptOutAudience(any(), any(), any());
            when(crm.markLeadsOptedOut(any(), any())).thenThrow(new RuntimeException("db down"));
            outcomes.mirrorOptOut(INST, List.of(live("m1", LEAD_ENGINE, "u1", "ar1")), "WHATSAPP", "stop");
            verify(crm).markLeadsOptedOut(any(), any());
        }
    }

    // ==================== T6: a plain "not interested" exits the lead ====================

    @Nested
    class NotInterested {

        @BeforeEach
        void statuses() {
            when(leadStatuses.listForInstitute(INST)).thenReturn(List.of(
                    status("s-new", "LEAD", "New"), status("s-lost", "LOST", "Lost")));
        }

        @Test
        @DisplayName("T6: lead members leave as EXITED, pending rows cancelled, CRM status -> Lost, handled note left")
        void exitsLead() {
            List<LiveMember> left = outcomes.exitNotInterested(INST,
                    List.of(live("m1", LEAD_ENGINE, null, "ar1")), "WHATSAPP", "not interested", Instant.now());

            assertEquals(1, left.size());
            verify(members).exitMembers(eq(List.of("m1")), any());
            verify(actions).cancelOpenForMembers(eq(List.of("m1")), anyString(), any(), eq(false));
            verify(leadStatuses).changeLeadStatus("ar1", "s-lost", null, "ENGAGEMENT_ENGINE");
            verify(actions).save(argThat((EngagementAction a) -> "DONE".equals(a.getStatus())
                    && a.getRationale().contains("not interested") && a.getRationale().contains("Lost")));
        }

        @Test
        @DisplayName("T6: the institute's own NOT_INTERESTED status wins over Lost")
        void prefersNotInterestedStatus() {
            when(leadStatuses.listForInstitute(INST)).thenReturn(List.of(
                    status("s-lost", "LOST", "Lost"), status("s-ni", "NOT_INTERESTED", "Not interested")));
            outcomes.exitNotInterested(INST, List.of(live("m1", LEAD_ENGINE, null, "ar1")), "WHATSAPP",
                    "not interested", Instant.now());
            verify(leadStatuses).changeLeadStatus("ar1", "s-ni", null, "ENGAGEMENT_ENGINE");
        }

        @Test
        @DisplayName("T6: a lead already Converted keeps its status (a reply never undoes a sale)")
        void neverDowngradesConverted() {
            when(crm.leadStatusKeys(eq(INST), any())).thenReturn(Map.of("ar1", "CONVERTED"));
            outcomes.exitNotInterested(INST, List.of(live("m1", LEAD_ENGINE, null, "ar1")), "WHATSAPP",
                    "not interested", Instant.now());
            verify(leadStatuses, never()).changeLeadStatus(any(), any(), any(), any());
        }

        @Test
        @DisplayName("T6: a learner engine keeps its learner; nothing exits")
        void learnerEngineKeepsLearner() {
            List<LiveMember> left = outcomes.exitNotInterested(INST,
                    List.of(live("m1", LEARNER_ENGINE, "u1", "ar1")), "WHATSAPP", "not interested", Instant.now());
            assertTrue(left.isEmpty());
            verify(members, never()).exitMembers(any(), any());
            verify(actions, never()).save(any());
        }
    }

    // ==================== T11: converted in the CRM leaves within one sweep ====================

    @Nested
    class Converted {

        private EngagementMember member(String id, String engineId, String userId, String leadRow, String status) {
            EngagementMember m = new EngagementMember();
            m.setId(id);
            m.setEngineId(engineId);
            m.setInstituteId(INST);
            m.setUserId(userId);
            m.setAudienceResponseId(leadRow);
            m.setStatus(status);
            return m;
        }

        @Test
        @DisplayName("T11: still-converted lead leaves; AI-call promises are kept; a learner engine keeps its learner")
        void exitsConvertedLeads() {
            when(members.findAllById(any())).thenReturn(List.of(
                    member("m1", LEAD_ENGINE, null, "ar1", "ACTIVE"),
                    member("m2", LEARNER_ENGINE, "u2", "ar2", "ACTIVE"),
                    member("m3", LEAD_ENGINE, null, "ar3", "ACTIVE")));
            // ar3 was moved back to New after the conversion: it stays.
            when(gate.blockedLeads(eq(INST), any())).thenReturn(Map.of(
                    "ar1", PolicyGate.LeadBlock.CONVERTED, "ar2", PolicyGate.LeadBlock.CONVERTED));
            when(members.exitMembers(any(), any())).thenReturn(1);

            assertEquals(1, outcomes.exitConverted(List.of("m1", "m2", "m3"), Instant.now()));
            verify(members).exitMembers(eq(List.of("m1")), any());
            verify(actions).cancelOpenForMembers(eq(List.of("m1")), anyString(), any(), eq(true));
        }

        @Test
        @DisplayName("T11: the exit sweep reads conversions since the previous run and exits them")
        void jobChainsItsCursor() {
            EngagementLeadExitJob job = new EngagementLeadExitJob(members, crm, outcomes);
            when(members.institutesWithLiveEngines()).thenReturn(List.of(INST));
            when(crm.membersOfLeadsConvertedSince(any(), any())).thenReturn(List.of());

            job.sweep();
            verify(crm).membersOfLeadsConvertedSince(eq(List.of(INST)),
                    argThat(since -> since.isBefore(Instant.now().minusSeconds(23 * 3600))));
            job.sweep();
            verify(crm).membersOfLeadsConvertedSince(eq(List.of(INST)),
                    argThat(since -> since.isAfter(Instant.now().minusSeconds(3600))));
        }
    }

    // ==================== the responder: WhatsApp + email ====================

    @Nested
    class Replies {

        private EngagementReplyMemberQueries replyQueries;
        private EngagementLeadOutcomeService outcomeMock;
        private EngagementReplyResponder responder;

        @BeforeEach
        void responder() {
            replyQueries = mock(EngagementReplyMemberQueries.class);
            outcomeMock = mock(EngagementLeadOutcomeService.class);
            responder = new EngagementReplyResponder(members, engines, mock(EngagementPromptVersionRepository.class),
                    actions, mock(EngagementReplyBrain.class), mock(EngagementDispatcher.class));
            ReflectionTestUtils.setField(responder, "taskExpireHours", 72);
            ReflectionTestUtils.setField(responder, "leaseMinutes", 15);
            ReflectionTestUtils.setField(responder, "replyMemberQueries", replyQueries);
            ReflectionTestUtils.setField(responder, "outcomeService", outcomeMock);
            when(members.findAutoReplyCandidates(any(), any(), any())).thenReturn(List.of());
            when(members.claimHandledReply(any(), any(), any())).thenReturn(1);
        }

        @Test
        @DisplayName("T4: STOP on a no-auto-reply engine is mirrored into the CRM")
        void stopMirrors() {
            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, null, "ar1"));
            when(replyQueries.findLiveMembersByPhone(INST, "9000000002")).thenReturn(found);
            assertTrue(responder.handleReply(INST, "+919000000002", "band karo", "w1"));
            verify(members).optOutByPhone(eq(INST), eq("9000000002"), any());
            verify(outcomeMock).mirrorOptOut(INST, found, "WHATSAPP", "band karo");
        }

        @Test
        @DisplayName("T6: 'interested nahi hai' exits the lead; no human task when every member left")
        void notInterestedExits() {
            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, null, "ar1"));
            when(replyQueries.findLiveMembersByPhone(INST, "9000000002")).thenReturn(found);
            when(outcomeMock.exitNotInterested(eq(INST), eq(found), eq("WHATSAPP"), any(), any())).thenReturn(found);
            assertTrue(responder.handleReply(INST, "9000000002", "Sorry, interested nahi hai", "w2"));
            verify(actions, never()).save(any());
        }

        @Test
        @DisplayName("T7: a qualified 'not interested' stays a human item, no exit")
        void qualifiedStaysHuman() {
            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, null, "ar1"));
            when(replyQueries.findLiveMembersByPhone(INST, "9000000002")).thenReturn(found);
            assertTrue(responder.handleReply(INST, "9000000002", "not interested in the morning batch", "w3"));
            verify(outcomeMock, never()).exitNotInterested(any(), any(), any(), any(), any());
            verify(actions).save(argThat((EngagementAction a) -> "OPEN".equals(a.getStatus())
                    && a.getRationale().contains("stop-mention")));
        }

        @Test
        @DisplayName("T17: an email reply becomes an email REPLY task with a Re: subject; members held")
        void emailReplyTask() {
            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, null, "ar1"));
            when(replyQueries.findLiveMembersByEmail(INST, "asha@example.com")).thenReturn(found);
            assertTrue(responder.handleEmailReply(INST, " Asha@Example.com ", "Re: Course details",
                    "What are the batch timings?", "<msg-1@mail>"));
            verify(actions).save(argThat((EngagementAction a) -> "EMAIL".equals(a.getChannel())
                    && "REPLY".equals(a.getKind()) && "OPEN".equals(a.getStatus())
                    && a.getVariablesJson().contains("Re: Course details")
                    && a.getRationale().contains("batch timings")));
            verify(members).markReplyHandled(eq("m1"), any(), any());
        }

        @Test
        @DisplayName("T17: 'Unsubscribe' in the email subject opts out and mirrors into the CRM")
        void emailOptOutBySubject() {
            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, "u1", "ar1"));
            when(replyQueries.findLiveMembersByEmail(INST, "asha@example.com")).thenReturn(found);
            assertTrue(responder.handleEmailReply(INST, "asha@example.com", "Unsubscribe", null, "<msg-2@mail>"));
            verify(members).optOutMembers(eq(List.of("m1")), any());
            verify(outcomeMock).mirrorOptOut(eq(INST), eq(found), eq("EMAIL"), any());
        }

        @Test
        @DisplayName("T17: an email from nobody in an engine, or one already handled, does nothing")
        void emailIgnoredWhenUnknownOrHandled() {
            when(replyQueries.findLiveMembersByEmail(INST, "x@example.com")).thenReturn(List.of());
            assertFalse(responder.handleEmailReply(INST, "x@example.com", "Hi", "hello", "<m3@mail>"));

            List<LiveMember> found = List.of(live("m1", LEAD_ENGINE, null, "ar1"));
            when(replyQueries.findLiveMembersByEmail(INST, "asha@example.com")).thenReturn(found);
            when(members.claimHandledReply(eq(INST), eq("<m4@mail>"), any())).thenReturn(0);
            assertFalse(responder.handleEmailReply(INST, "asha@example.com", "Hi", "hello", "<m4@mail>"));
            verify(actions, never()).save(any());
        }

        @Test
        @DisplayName("T17: a Message-ID longer than the key column is hashed")
        void longMessageIdHashed() {
            String key = EngagementReplyResponder.replyKey("x".repeat(300));
            assertTrue(key.startsWith("sha256:") && key.length() <= 255);
            assertEquals("<short@id>", EngagementReplyResponder.replyKey("<short@id>"));
        }
    }

    @Test
    @DisplayName("T17: the reply sweep sends an email row to handleEmailReply, never to the WhatsApp promotion")
    void replyJobRoutesEmail() throws Exception {
        vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients clients =
                mock(vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients.class);
        EngagementReplyResponder responder = mock(EngagementReplyResponder.class);
        EngagementReplyJob job = new EngagementReplyJob(clients, members, responder);
        when(members.institutesWithLiveEngines()).thenReturn(List.of(INST));
        when(clients.inboundSince(eq(INST), org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                        "[{\"channel\":\"EMAIL\",\"email\":\"asha@example.com\",\"subject\":\"Re: Hi\","
                                + "\"text\":\"stop\",\"wamid\":\"<m1@mail>\"}]"));

        job.sweep();
        verify(responder).handleEmailReply(INST, "asha@example.com", "Re: Hi", "stop", "<m1@mail>");
        verify(responder, never()).handleReply(any(), any(), any(), any());
        verify(members, never()).promoteByPhones(any(), any(), any(), any());
    }

    // ==================== the not-interested pattern ====================

    @Test
    @DisplayName("NOT_INTERESTED_CLEAR: plain refusals match, qualified or 'not now' ones do not")
    void notInterestedPattern() {
        for (String yes : List.of("not interested", "Not interested.", "Sorry, not interested", "I am not interested sir",
                "interested nahi hai", "nahi chahiye", "No thanks, not interested", "mujhe nahi chahiye bhai",
                "zarurat nahi hai 🙏")) {
            assertTrue(EngagementReplyResponder.NOT_INTERESTED_CLEAR.matcher(yes).find(), yes);
        }
        for (String no : List.of("not interested in the morning batch", "abhi nahi", "not interested abhi",
                "not interested right now, maybe next year", "interested", "fees kitni hai, not interested otherwise")) {
            assertFalse(EngagementReplyResponder.NOT_INTERESTED_CLEAR.matcher(no).find(), no);
        }
    }

    // ==================== T12: workflow nurture skips engine leads ====================

    @Test
    @DisplayName("T12: scheduled runs and lead nurture events are held; transactional and terminal ones never")
    void workflowSuppressionScope() {
        assertTrue(EngagementWorkflowSuppression.appliesTo(Map.of("scheduleId", "s1")));
        assertTrue(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "FOLLOW_UP_DUE")));
        assertTrue(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "LEAD_STATUS_CHANGED",
                "newStatus", "INTERESTED")));
        assertFalse(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "LEAD_STATUS_CHANGED",
                "newStatus", "CONVERTED")));
        assertFalse(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "PAYMENT_SUCCESS")));
        assertFalse(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "AUDIENCE_LEAD_SUBMISSION")));
        assertFalse(EngagementWorkflowSuppression.appliesTo(Map.of("triggerEvents", "LIVE_SESSION_START",
                "scheduleId", "s1")));
        assertFalse(EngagementWorkflowSuppression.appliesTo(Map.of("executionId", "x")));
        assertEquals("9000000002", EngagementWorkflowSuppression.phoneKey("+91 90000 00002"));
        assertNull(EngagementWorkflowSuppression.phoneKey("12345"));
        assertEquals("a@b.com", EngagementWorkflowSuppression.emailKey(" A@B.com "));
    }

    @Test
    @DisplayName("stopsAsLead: no account, or a lead-only engine, ends the member; a learner engine keeps an account holder")
    void stopsAsLeadRule() {
        EngagementEngine leadOnly = engine(LEAD_ENGINE, "[{\"type\":\"AUDIENCE\",\"id\":\"l\"}]");
        EngagementEngine learner = engine(LEARNER_ENGINE, "[{\"type\":\"USER\",\"id\":\"u\"}]");
        assertTrue(PolicyGate.stopsAsLead(learner, null));
        assertTrue(PolicyGate.stopsAsLead(leadOnly, "u1"));
        assertFalse(PolicyGate.stopsAsLead(learner, "u1"));
        assertTrue(PolicyGate.stopsAsLead(leadOnly, null));
    }
}
