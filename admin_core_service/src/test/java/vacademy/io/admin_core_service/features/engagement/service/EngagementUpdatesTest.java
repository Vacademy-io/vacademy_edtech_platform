package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.dto.EngagementUpdateRequest;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPromptVersion;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementTemplateProposal;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementUpdate;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPromptVersionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementTemplateProposalRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementUpdateRepository;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Updates and offers: the brain may use them while live, each person gets one once, nothing after the end. */
class EngagementUpdatesTest {

    private static final Instant NOW = Instant.now();

    private static EngagementUpdate update(String id, String template, Instant start, Instant end) {
        EngagementUpdate u = new EngagementUpdate();
        u.setId(id);
        u.setEngineId("e1");
        u.setInstituteId("i1");
        u.setMessage("Diwali offer: 20% off until the 10th");
        u.setTemplateName(template);
        u.setStartsAt(start);
        u.setEndsAt(end);
        return u;
    }

    private static EngagementUpdate live(String id, String template) {
        return update(id, template, NOW.minus(Duration.ofHours(1)), NOW.plus(Duration.ofDays(2)));
    }

    @Nested
    @DisplayName("the service")
    class Service {
        private EngagementUpdateRepository updates;
        private EngagementActionRepository actions;
        private EngagementMemberRepository members;
        private EngagementTemplateProposalRepository templates;
        private EngagementUpdateService service;
        private EngagementEngine engine;

        @BeforeEach
        void setUp() {
            updates = mock(EngagementUpdateRepository.class);
            actions = mock(EngagementActionRepository.class);
            members = mock(EngagementMemberRepository.class);
            templates = mock(EngagementTemplateProposalRepository.class);
            service = new EngagementUpdateService(updates, actions, members, templates);
            when(updates.save(any())).thenAnswer(inv -> inv.getArgument(0));
            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
        }

        private EngagementUpdateRequest request(String message, Instant start, Instant end, String template) {
            EngagementUpdateRequest r = new EngagementUpdateRequest();
            r.setMessage(message);
            r.setStartsAt(start);
            r.setEndsAt(end);
            r.setTemplateName(template);
            return r;
        }

        @Test
        @DisplayName("needs a message and an end in the future, after the start, and a template approved here")
        void validatesInput() {
            Instant later = NOW.plus(Duration.ofDays(1));
            assertThrows(VacademyException.class, () -> service.create(engine, request(" ", null, later, null), "u"));
            assertThrows(VacademyException.class, () -> service.create(engine, request("x".repeat(1001), null, later, null), "u"));
            assertThrows(VacademyException.class, () -> service.create(engine, request("Hi", null, null, null), "u"));
            assertThrows(VacademyException.class, () -> service.create(engine, request("Hi", null, NOW.minusSeconds(60), null), "u"));
            assertThrows(VacademyException.class, () -> service.create(engine, request("Hi", later.plusSeconds(60), later, null), "u"));
            when(templates.findApproved("e1", "i1")).thenReturn(List.of());
            assertThrows(VacademyException.class, () -> service.create(engine, request("Hi", null, later, "not_approved"), "u"));
        }

        @Test
        @DisplayName("no start means now, and an approved template is kept")
        void createsWithDefaults() {
            EngagementTemplateProposal approved = new EngagementTemplateProposal();
            approved.setName("diwali_offer");
            when(templates.findApproved("e1", "i1")).thenReturn(List.of(approved));

            EngagementUpdate made = service.create(engine, request(" Happy Diwali ", null, NOW.plus(Duration.ofDays(1)), "diwali_offer"), "admin");

            assertEquals("Happy Diwali", made.getMessage());
            assertEquals("diwali_offer", made.getTemplateName());
            assertFalse(made.getStartsAt().isAfter(Instant.now()));
            assertEquals("admin", made.getCreatedBy());
        }

        @Test
        @DisplayName("the brain sees live ones only; a template of one not live is hidden, unless a live one shares it")
        void decisionViewFollowsTheDates() {
            EngagementUpdate on = live("on", "offer_on");
            EngagementUpdate over = update("over", "offer_over", NOW.minus(Duration.ofDays(3)), NOW.minus(Duration.ofDays(1)));
            EngagementUpdate soon = update("soon", "offer_soon", NOW.plus(Duration.ofDays(1)), NOW.plus(Duration.ofDays(2)));
            EngagementUpdate oldTwin = update("oldTwin", "offer_on", NOW.minus(Duration.ofDays(3)), NOW.minus(Duration.ofDays(1)));
            when(updates.findByEngineIdOrderByCreatedAtDesc("e1")).thenReturn(List.of(on, over, soon, oldTwin));

            var view = service.forDecision("e1", NOW);

            assertEquals(List.of(on), view.live());
            assertEquals(Set.of("offer_over", "offer_soon"), view.hiddenTemplates());
            assertEquals("on", view.resolve("offer_on", null));
            assertEquals("on", view.resolve(null, "on"));
            assertNull(view.resolve(null, "over"), "an id the model made up or remembered is ignored");
            assertNull(view.resolve("other_template", null));
        }

        @Test
        @DisplayName("an update ended by hand counts as over even before its date")
        void endedByHandIsNotLive() {
            EngagementUpdate on = live("on", null);
            on.setStatus(EngagementUpdate.ENDED);
            when(updates.findById("on")).thenReturn(Optional.of(on));
            assertFalse(service.isLive("on", NOW));
            assertFalse(service.isLive("missing", NOW));
        }

        @Test
        @DisplayName("starting wakes the engine's people once, and only one replica does it")
        void announcesOnce() {
            EngagementUpdate a = live("a", null);
            EngagementUpdate b = live("b", null);
            when(updates.findDueToAnnounce(NOW)).thenReturn(List.of(a, b));
            when(updates.markAnnounced("a", NOW)).thenReturn(1);
            when(updates.markAnnounced("b", NOW)).thenReturn(0);

            assertEquals(1, service.announceDue(NOW));

            verify(members, times(1)).wakeEngineMembers("e1", NOW, EngagementWakeService.UPDATE_POSTED,
                    EngagementUpdateService.ANNOUNCE_WINDOW_SECONDS);
        }

        @Test
        @DisplayName("past its end date: closed, and what waited for it is cancelled")
        void closesEnded() {
            when(updates.findPastTheirEnd(NOW)).thenReturn(List.of(live("a", null)));

            assertEquals(1, service.closeEnded(NOW));

            verify(updates).markEnded("a", NOW);
            verify(actions).cancelActionsOfUpdate("e1", "a", EngagementUpdateService.ENDED_REASON, NOW);
        }

        @Test
        @DisplayName("ending by hand cancels too, and another engine's update cannot be ended")
        void endByHand() {
            EngagementUpdate mine = live("a", null);
            when(updates.findById("a")).thenReturn(Optional.of(mine));
            assertEquals(EngagementUpdate.ENDED, service.end(engine, "a").getStatus());
            verify(actions).cancelActionsOfUpdate(eq("e1"), eq("a"), any(), any());

            EngagementUpdate foreign = live("b", null);
            foreign.setEngineId("other");
            when(updates.findById("b")).thenReturn(Optional.of(foreign));
            assertThrows(VacademyException.class, () -> service.end(engine, "b"));
        }

        @Test
        @DisplayName("the brief gets live updates with their id and end; none means the brief is unchanged")
        void briefText() {
            assertEquals("Brief", EngagementUpdateService.briefWith("Brief", List.of()));
            String brief = EngagementUpdateService.briefWith("Brief", List.of(live("a", "tmpl")));
            assertTrue(brief.startsWith("Brief"));
            assertTrue(brief.contains("[updateId a]"), brief);
            assertTrue(brief.contains("Diwali offer"), brief);
            assertTrue(brief.contains("WhatsApp template: tmpl"), brief);
        }
    }

    @Nested
    @DisplayName("the decision")
    class Deciding {
        private ContactResolver contacts;
        private EngagementBrainClient brain;
        private EngagementMemberRepository members;
        private EngagementActionRepository actions;
        private EngagementUpdateService updates;
        private EngagementDecisionService service;
        private EngagementEngine engine;
        private EngagementMember member;

        @BeforeEach
        void setUp() {
            DataPointRegistry registry = mock(DataPointRegistry.class);
            contacts = mock(ContactResolver.class);
            PolicyGate gate = mock(PolicyGate.class);
            brain = mock(EngagementBrainClient.class);
            members = mock(EngagementMemberRepository.class);
            actions = mock(EngagementActionRepository.class);
            updates = mock(EngagementUpdateService.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                    mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "updateService", updates);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("The brief");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
            when(registry.hydrate(any(), anyList(), anyList()))
                    .thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.scheduleSend(any(), any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(contacts.resolve(anyList())).thenReturn(List.of(
                    Subject.builder().memberId("m1").userId("u1").phone("9000000001").email("a@test.local").build()));

            engine = new EngagementEngine();
            engine.setId("e1");
            engine.setInstituteId("i1");
            engine.setStatus("ACTIVE");
            engine.setCadenceHours(72);
            engine.setChannels("{\"EMAIL\":{\"enabled\":true},\"WHATSAPP\":{\"enabled\":true}}");
            member = new EngagementMember();
            member.setId("m1");
            member.setEngineId("e1");
            member.setInstituteId("i1");
            member.setUserId("u1");
            member.setStatus("ACTIVE");
            member.setNextActionAt(Instant.now());
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
        }

        private void liveUpdate(String id) {
            when(updates.forDecision(eq("e1"), any())).thenReturn(new EngagementUpdateService.LiveUpdates(
                    List.of(live(id, null)), Map.of(), Set.of()));
        }

        private void brainEmails(String updateId) {
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "Happy Diwali!", null, null,
                            "offer", 50, 0, null, null, null, "Diwali", null, null, updateId));
        }

        @Test
        @DisplayName("the brain reads the update in its brief, and the message is tied to it")
        void messageIsTiedToTheUpdate() {
            liveUpdate("u1");
            brainEmails("u1");

            service.decideCohort(engine, List.of(member));

            var brief = ArgumentCaptor.forClass(String.class);
            verify(brain).decide(any(), brief.capture(), any(), any(), any(), any());
            assertTrue(brief.getValue().contains("[updateId u1]"), brief.getValue());
            verify(actions).save(argThat((EngagementAction a) -> "EMAIL".equals(a.getChannel())
                    && a.getVariablesJson() != null && a.getVariablesJson().contains("\"_updateId\":\"u1\"")
                    && a.getVariablesJson().contains("Diwali")));
        }

        @Test
        @DisplayName("someone who already has this update does not get it again, whatever the model says")
        void onePerPerson() {
            liveUpdate("u1");
            when(actions.updateIdsOfMember("m1")).thenReturn(List.of("u1"));
            brainEmails("u1");

            service.decideCohort(engine, List.of(member));

            verify(actions).save(argThat((EngagementAction a) -> "NO_OP".equals(a.getKind())
                    && a.getRationale().contains("already has this update")));
            verify(actions, never()).save(argThat((EngagementAction a) -> "TASK".equals(a.getKind())));
        }

        @Test
        @DisplayName("an update id the model invents ties nothing, and the message still goes as normal")
        void inventedIdIsDropped() {
            liveUpdate("u1");
            brainEmails("made-up");

            service.decideCohort(engine, List.of(member));

            verify(actions).save(argThat((EngagementAction a) -> "TASK".equals(a.getKind())
                    && !a.getVariablesJson().contains("_updateId")));
        }
    }

    @Test
    @DisplayName("a due send tied to an ended update is withdrawn, even where autonomy is off; a live one is not")
    void dispatchJobWithdrawsAfterTheEnd() {
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        EngagementEngineRepository engines = mock(EngagementEngineRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        PolicyGate gate = mock(PolicyGate.class);
        EngagementDispatcher dispatcher = mock(EngagementDispatcher.class);
        var job = new EngagementDispatchJob(actions, engines, members, gate, dispatcher, mock(CreditClient.class));
        ReflectionTestUtils.setField(job, "batch", 100);
        ReflectionTestUtils.setField(job, "perMessageCredits", BigDecimal.ONE);
        ReflectionTestUtils.setField(job, "maxUnbilled", 25);
        EngagementUpdateService updates = mock(EngagementUpdateService.class);
        ReflectionTestUtils.setField(job, "updateService", updates);

        EngagementEngine active = new EngagementEngine();
        active.setId("e1");
        active.setStatus("ACTIVE");
        EngagementMember member = new EngagementMember();
        member.setId("m1");
        member.setStatus("ACTIVE");
        EngagementAction send = new EngagementAction();
        send.setId("a1");
        send.setEngineId("e1");
        send.setMemberId("m1");
        send.setInstituteId("i1");
        send.setKind("SEND");
        send.setStatus("OPEN");
        send.setChannel("EMAIL");
        send.setVariablesJson("{\"" + EngagementDispatcher.VAR_UPDATE_ID + "\":\"u1\"}");
        when(actions.findDueAutoSends(any(), anyInt())).thenReturn(List.of(send));
        when(actions.findUnbilledSent(anyInt())).thenReturn(List.of());
        when(engines.findById("e1")).thenReturn(Optional.of(active));
        when(members.findById("m1")).thenReturn(Optional.of(member));

        when(updates.isLive(eq("u1"), any())).thenReturn(false);
        job.dispatch();
        verify(actions).withdrawDueSend(eq("a1"), contains("has ended"), any());
        verify(actions, never()).demoteSendToTask(anyString(), anyString(), any());
        verify(dispatcher, never()).dispatchClaimed(any(), any(), any());

        clearInvocations(actions);
        when(updates.isLive(eq("u1"), any())).thenReturn(true);
        job.dispatch();
        verify(actions, never()).withdrawDueSend(anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a message tied to an update that has ended is refused at send, whoever approves it")
    void dispatcherRefusesAfterTheEnd() {
        NotificationService notifications = mock(NotificationService.class);
        EngagementActionRepository actions = mock(EngagementActionRepository.class);
        EngagementMemberRepository members = mock(EngagementMemberRepository.class);
        ContactResolver contacts = mock(ContactResolver.class);
        var dispatcher = new EngagementDispatcher(notifications, actions, members, mock(TimelineEventService.class),
                contacts, mock(EngagementInternalClients.class), mock(EngagementEngineRepository.class),
                mock(PolicyGate.class));
        EngagementUpdateService updates = mock(EngagementUpdateService.class);
        when(updates.isLive(eq("over"), any())).thenReturn(false);
        ReflectionTestUtils.setField(dispatcher, "updateService", updates);
        when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setInstituteId("i1");
        m.setStatus("ACTIVE");
        when(members.findById("m1")).thenReturn(Optional.of(m));

        EngagementAction a = new EngagementAction();
        a.setId("a1");
        a.setEngineId("e1");
        a.setMemberId("m1");
        a.setInstituteId("i1");
        a.setKind("TASK");
        a.setChannel("EMAIL");
        a.setStatus("DISPATCHING");
        a.setDraftBody("Offer!");
        a.setVariablesJson("{\"_updateId\":\"over\"}");

        var ex = assertThrows(VacademyException.class, () -> dispatcher.dispatchClaimed(a, null, "tester"));
        assertTrue(ex.getMessage().contains("has ended"), ex.getMessage());
        assertEquals("OPEN", a.getStatus());
        verifyNoInteractions(notifications);
    }
}
