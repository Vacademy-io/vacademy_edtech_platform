package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI-call promises ride the engagement dispatcher on the system engine, whose members are
 * PAUSED by design (AiCallEngagementProvisioner). From 2026-09-29 the dispatch job's send-time
 * re-check required ACTIVE and withdrew every one of them (106 on prod by 10-17).
 */
class EngagementAiCallPromiseDispatchTest {

    @Nested
    @DisplayName("send-time member check")
    class MemberCheck {
        private EngagementActionRepository actions;
        private EngagementDispatcher dispatcher;
        private CreditClient credits;
        private EngagementDispatchJob job;
        private EngagementMember member;
        private EngagementAction send;

        @BeforeEach
        void setUp() {
            actions = mock(EngagementActionRepository.class);
            EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
            EngagementMemberRepository members = mock(EngagementMemberRepository.class);
            PolicyGate gate = mock(PolicyGate.class);
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
            send.setChannel("WHATSAPP");
            send.setSource(EngagementAction.SOURCE_AI_CALL);
            send.setExpiresAt(Instant.now().plus(Duration.ofHours(23)));
            when(actions.findDueAutoSends(any(), anyInt())).thenReturn(List.of(send));
            when(actions.findUnbilledSent(anyInt())).thenReturn(List.of());
            when(actions.claimForDispatch(eq("a1"), eq("i1"), any())).thenReturn(1);
            when(actions.findById("a1")).thenReturn(Optional.of(send));

            // The system engine as AiCallEngagementProvisioner creates it.
            EngagementEngine engine = new EngagementEngine();
            engine.setId("e1");
            engine.setStatus("ACTIVE");
            engine.setAutoSendKilled(false);
            engine.setCreatedBy("SYSTEM_AI_CALL");
            engine.setChannels("{\"WHATSAPP\":{\"enabled\":true,\"auto\":true,\"autoReply\":false},"
                    + "\"EMAIL\":{\"enabled\":true,\"auto\":true}}");
            when(engines.findById("e1")).thenReturn(Optional.of(engine));

            member = new EngagementMember();
            member.setId("m1");
            member.setUserId("u1");
            member.setStatus("PAUSED");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(credits.readBalance("i1")).thenReturn(Optional.of(50.0));
            when(credits.deductPrecomputed(any(), any(), any(), any(), any(), any())).thenReturn(true);
            EngagementAction sent = new EngagementAction();
            sent.setId("a1");
            sent.setStatus("SENT");
            when(dispatcher.dispatchClaimed(any(), any(), any())).thenReturn(sent);
        }

        @Test
        @DisplayName("a PAUSED member on an AI-call promise is sent and charged, not withdrawn")
        void pausedAiCallMemberIsSent() {
            job.dispatch();
            verify(actions, never()).withdrawDueSend(anyString(), anyString(), any());
            verify(dispatcher).dispatchClaimed(any(), any(), any());
            verify(actions).markBilled(eq("a1"), any());
        }

        @Test
        @DisplayName("a PAUSED member on an engine-drafted send is still withdrawn")
        void pausedEngineSendWithdrawn() {
            send.setSource(null);
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), argThat(r -> r.contains("paused")), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @ParameterizedTest
        @ValueSource(strings = {"OPTED_OUT", "EXITED"})
        @DisplayName("an AI-call promise to someone who opted out or left is withdrawn")
        void optedOutOrExitedWithdrawnEvenForAiCall(String status) {
            member.setStatus(status);
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), anyString(), any());
            verify(actions, never()).claimForDispatch(anyString(), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("a PAUSED member who opted out in the consent store is withdrawn")
        void consentStoreStillApplies() {
            PolicyGate gate = (PolicyGate) ReflectionTestUtils.getField(job, "policyGate");
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of("u1"));
            job.dispatch();
            verify(actions).withdrawDueSend(eq("a1"), argThat(r -> r.contains("opted out")), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("an unreadable balance holds the send and retries; it is not 'out of credits'")
        void unknownBalanceHolds() {
            when(credits.readBalance("i1")).thenReturn(Optional.empty());
            Instant before = Instant.now();
            job.dispatch();
            verify(actions).rescheduleDueSend(eq("a1"), argThat(at -> {
                Duration d = Duration.between(before, at);
                return d.compareTo(EngagementDispatchJob.UNKNOWN_BALANCE_RETRY_DELAY.minusSeconds(5)) >= 0
                        && d.compareTo(EngagementDispatchJob.UNKNOWN_BALANCE_RETRY_DELAY.plusSeconds(5)) <= 0;
            }), any());
            verify(actions, never()).demoteSendToTask(anyString(), anyString(), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }

        @Test
        @DisplayName("an unreadable balance close to expiry goes to the inbox, labelled honestly")
        void unknownBalanceNearExpiryDemoted() {
            when(credits.readBalance("i1")).thenReturn(Optional.empty());
            send.setExpiresAt(Instant.now().plus(Duration.ofMinutes(30)));
            job.dispatch();
            verify(actions).demoteSendToTask(eq("a1"), argThat(r -> r.startsWith("Couldn't check the credit balance")), any());
            verify(actions, never()).rescheduleDueSend(anyString(), any(), any());
        }

        @Test
        @DisplayName("an empty wallet still demotes as out of credits")
        void emptyWalletDemoted() {
            when(credits.readBalance("i1")).thenReturn(Optional.of(0.0));
            job.dispatch();
            verify(actions).demoteSendToTask(eq("a1"), argThat(r -> r.startsWith("Out of credits")), any());
            verify(dispatcher, never()).dispatchClaimed(any(), any(), any());
        }
    }

    @Nested
    @DisplayName("notSendableReason")
    class Reasons {
        private EngagementAction action(String source) {
            EngagementAction a = new EngagementAction();
            a.setSource(source);
            return a;
        }

        private EngagementMember member(String status) {
            EngagementMember m = new EngagementMember();
            m.setStatus(status);
            return m;
        }

        @Test
        void allowList() {
            assertNull(EngagementDispatchJob.notSendableReason(member("ACTIVE"), action(null)));
            assertNull(EngagementDispatchJob.notSendableReason(member("ACTIVE"), action("AI_CALL")));
            assertNull(EngagementDispatchJob.notSendableReason(member("PAUSED"), action("AI_CALL")));
            assertNotNull(EngagementDispatchJob.notSendableReason(member("PAUSED"), action(null)));
            assertNotNull(EngagementDispatchJob.notSendableReason(member("OPTED_OUT"), action("AI_CALL")));
            assertNotNull(EngagementDispatchJob.notSendableReason(member("EXITED"), action("AI_CALL")));
            assertNotNull(EngagementDispatchJob.notSendableReason(null, action("AI_CALL")));
            // A status added later fails safe.
            assertNotNull(EngagementDispatchJob.notSendableReason(member("CLOSED"), action("AI_CALL")));
        }
    }

    @Nested
    @DisplayName("who an AI-call WhatsApp promise goes to")
    class Recipient {
        private NotificationService notifications;
        private EngagementActionRepository actions;
        private EngagementMemberRepository members;
        private ContactResolver contacts;
        private EngagementDispatcher dispatcher;
        private EngagementMember member;

        @BeforeEach
        void setUp() {
            notifications = mock(NotificationService.class);
            actions = mock(EngagementActionRepository.class);
            members = mock(EngagementMemberRepository.class);
            contacts = mock(ContactResolver.class);
            dispatcher = new EngagementDispatcher(notifications, actions, members,
                    mock(TimelineEventService.class), contacts, mock(EngagementInternalClients.class),
                    mock(EngagementEngineRepository.class));
            member = new EngagementMember();
            member.setId("m1");
            member.setUserId("u1");
            member.setStatus("PAUSED");
            when(members.findById("m1")).thenReturn(Optional.of(member));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(notifications.sendUnified(any())).thenReturn(
                    UnifiedSendResponse.builder().total(1).accepted(1).build());
        }

        private EngagementAction promise(String source, String variablesJson) {
            EngagementAction a = new EngagementAction();
            a.setId("a1");
            a.setEngineId("e1");
            a.setMemberId("m1");
            a.setInstituteId("i1");
            a.setKind("SEND");
            a.setStatus("DISPATCHING");
            a.setChannel("WHATSAPP");
            a.setTemplateName("sn_unlockx");
            a.setTemplateLanguage("en");
            a.setDraftBody("Send Scholarship quiz link to Raza (promised on the AI call).");
            a.setSource(source);
            a.setVariablesJson(variablesJson);
            return a;
        }

        private UnifiedSendRequest.Recipient sentTo() {
            ArgumentCaptor<UnifiedSendRequest> req = ArgumentCaptor.forClass(UnifiedSendRequest.class);
            verify(notifications).sendUnified(req.capture());
            return req.getValue().getRecipients().get(0);
        }

        @Test
        @DisplayName("goes to the number the call was on, even when no lead or student row has a phone")
        void calledNumberWins() {
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").userId("u1").build()));
            EngagementAction result = dispatcher.dispatchClaimed(promise("AI_CALL",
                    "{\"_toPhone\":\"919000000001\",\"_headerUrl\":\"https://x/i.jpg\",\"_headerType\":\"image\"}"),
                    null, "ENGAGEMENT_ENGINE");

            assertEquals("SENT", result.getStatus());
            UnifiedSendRequest.Recipient to = sentTo();
            assertEquals("919000000001", to.getPhone());
            assertFalse(to.getVariables().containsKey(EngagementDispatcher.VAR_TO_PHONE));
            assertTrue(to.getVariables().containsKey("_headerUrl"));
        }

        @Test
        @DisplayName("an engine-drafted row cannot redirect a send with a model-written _toPhone")
        void ignoredOutsideAiCall() {
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").userId("u1").phone("919000000002").build()));
            member.setStatus("ACTIVE");
            dispatcher.dispatchClaimed(promise(null, "{\"1\":\"Raza\",\"_toPhone\":\"919000000009\"}"),
                    null, "ENGAGEMENT_ENGINE");

            UnifiedSendRequest.Recipient to = sentTo();
            assertEquals("919000000002", to.getPhone());
            assertFalse(to.getVariables().containsKey(EngagementDispatcher.VAR_TO_PHONE));
            assertEquals("Raza", to.getVariables().get("1"));
        }

        @Test
        @DisplayName("an older AI-call row without the stamp still falls back to the resolved contact")
        void fallsBackToResolvedPhone() {
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").userId("u1").phone("919000000003").build()));
            dispatcher.dispatchClaimed(promise("AI_CALL", "{\"_headerUrl\":\"https://x/i.jpg\"}"),
                    null, "ENGAGEMENT_ENGINE");
            assertEquals("919000000003", sentTo().getPhone());
        }
    }
}
