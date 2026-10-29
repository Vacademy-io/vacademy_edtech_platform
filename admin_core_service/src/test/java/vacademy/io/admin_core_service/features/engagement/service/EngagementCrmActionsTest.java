package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.CreateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.LeadFollowupDto;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.engagement.actions.AddNoteActionHandler;
import vacademy.io.admin_core_service.features.engagement.actions.CreateFollowupActionHandler;
import vacademy.io.admin_core_service.features.engagement.actions.EscalateActionHandler;
import vacademy.io.admin_core_service.features.engagement.actions.ScheduleAiCallActionHandler;
import vacademy.io.admin_core_service.features.engagement.actions.UpdateStatusActionHandler;
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
import vacademy.io.admin_core_service.features.engagement.templates.EngagementEmailTemplateCatalog;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * B6: CRM actions as copilot tasks — the allow-list (S4), the handlers' rules (F-3, F-4, F-5,
 * C-1 to C-4, statuses), approve and undo (S9), and template-only email.
 */
class EngagementCrmActionsTest {

    private static final String INST = "i1";

    private static EngagementEngine engine(String channels) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId(INST);
        e.setName("Nurture");
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setAudience("[{\"type\":\"AUDIENCE\",\"id\":\"list-1\"}]");
        e.setChannels(channels);
        e.setQuietHours("{}");
        e.setDataPoints("[]");
        e.setAutoSendKilled(false);
        return e;
    }

    private static EngagementMember member() {
        EngagementMember m = new EngagementMember();
        m.setId("m1");
        m.setEngineId("e1");
        m.setInstituteId(INST);
        m.setAudienceResponseId("ar1");
        m.setStatus("ACTIVE");
        m.setNextActionAt(Instant.now());
        return m;
    }

    private static LeadStatus status(String id, String key, String label) {
        LeadStatus s = new LeadStatus();
        s.setId(id);
        s.setStatusKey(key);
        s.setLabel(label);
        return s;
    }

    private static EngagementActionHandler.Context ctx(EngagementEngine e, String phone) {
        return new EngagementActionHandler.Context(e, member(), "ar1", phone, "a1", Instant.now());
    }

    private static CustomUserDetails admin() {
        CustomUserDetails u = mock(CustomUserDetails.class);
        when(u.getUserId()).thenReturn("admin-1");
        when(u.getUsername()).thenReturn("Asha");
        return u;
    }

    private static EngagementActionHandler.Approver approver() {
        CustomUserDetails u = admin();
        return new EngagementActionHandler.Approver("admin-1", "Asha", u);
    }

    // ── handlers ───────────────────────────────────────────────────────────

    @Nested
    @DisplayName("Handlers: each action's own rules")
    class Handlers {
        private TimelineEventService timeline;
        private EngagementCoordinationDao coordination;
        private PolicyGate gate;
        private final EngagementEngine engine = engine("{}");

        @BeforeEach
        void setUp() {
            timeline = mock(TimelineEventService.class);
            coordination = mock(EngagementCoordinationDao.class);
            gate = mock(PolicyGate.class);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(timeline.logEngineNote(anyString(), anyString(), anyString(), anyMap(), any())).thenReturn("note-1");
        }

        @Test
        @DisplayName("ADD_NOTE: a normal note labelled AI; undo deletes exactly that note")
        void addNote() {
            AddNoteActionHandler h = new AddNoteActionHandler(timeline);
            assertNotNull(h.validate(ctx(engine, null), Map.of()));
            Map<String, String> params = Map.of("note", "Father asked about hostel fees twice.");
            assertNull(h.validate(ctx(engine, null), params));
            Map<String, String> result = h.execute(ctx(engine, null), params, approver());
            verify(timeline).logEngineNote(eq("ar1"), eq("AI note"), eq("Father asked about hostel fees twice."), anyMap(), any());
            h.undo(ctx(engine, null), params, result, approver());
            verify(timeline).deleteEngineNote("note-1");
        }

        @Test
        @DisplayName("ESCALATE needs a reason and records who took it as an AI note")
        void escalate() {
            EscalateActionHandler h = new EscalateActionHandler(timeline);
            assertNotNull(h.validate(ctx(engine, null), Map.of()));
            assertEquals("note-1", h.execute(ctx(engine, null), Map.of("reason", "Angry about fees"), approver()).get("noteId"));
        }

        @Test
        @DisplayName("F4_noSecondFollowup: refused while the lead has an open follow-up")
        void F4_noSecondFollowup() {
            CreateFollowupActionHandler h = new CreateFollowupActionHandler(mock(LeadFollowupService.class), coordination, gate);
            when(coordination.openFollowups(INST, "ar1")).thenReturn(1L);
            assertTrue(h.validate(ctx(engine, null), Map.of("note", "Discuss fees")).contains("already has an open follow-up"));
        }

        @Test
        @DisplayName("F3_followupTimeClamped: never in the past, and moved out of quiet hours")
        void F3_followupTimeClamped() {
            LeadFollowupService followups = mock(LeadFollowupService.class);
            LeadFollowupDto dto = mock(LeadFollowupDto.class);
            when(dto.getId()).thenReturn("fu-1");
            when(followups.create(any(), any())).thenReturn(dto);
            PolicyGate realGate = new PolicyGate(mock(EngagementReadDao.class), mock(EngagementActionRepository.class));
            ReflectionTestUtils.setField(realGate, "quietStartHour", 21);
            ReflectionTestUtils.setField(realGate, "quietEndHour", 8);
            ReflectionTestUtils.setField(realGate, "quietTimezone", "Asia/Kolkata");
            CreateFollowupActionHandler h = new CreateFollowupActionHandler(followups, coordination, realGate);
            // 23:00 IST now; "in 0 hours" (past) → at least an hour out → still night → next morning.
            Instant elevenPmIst = Instant.parse("2026-10-29T17:30:00Z");
            EngagementActionHandler.Context night = new EngagementActionHandler.Context(engine, member(), "ar1", null, "a1", elevenPmIst);
            h.execute(night, Map.of("note", "Call about fees", "dueInHours", "-5"), approver());
            ArgumentCaptor<CreateLeadFollowupRequest> req = ArgumentCaptor.forClass(CreateLeadFollowupRequest.class);
            verify(followups).create(req.capture(), any());
            Instant due = req.getValue().getScheduleTime().toInstant();
            assertTrue(due.isAfter(elevenPmIst.plus(Duration.ofMinutes(59))), due.toString());
            assertEquals(LocalTime.of(8, 0), due.atZone(ZoneId.of("Asia/Kolkata")).toLocalTime(), due.toString());
            assertTrue(req.getValue().getContent().startsWith("AI suggestion: "));
        }

        @Test
        @DisplayName("F5_followupOwnedByApprover: created as the person who approved it (a lead with no counsellor still has an owner)")
        void F5_followupOwnedByApprover() {
            LeadFollowupService followups = mock(LeadFollowupService.class);
            LeadFollowupDto dto = mock(LeadFollowupDto.class);
            when(dto.getId()).thenReturn("fu-1");
            when(followups.create(any(), any())).thenReturn(dto);
            CreateFollowupActionHandler h = new CreateFollowupActionHandler(followups, coordination, gate);
            EngagementActionHandler.Approver who = approver();
            assertEquals("fu-1", h.execute(ctx(engine, null), Map.of("note", "x"), who).get("followupId"));
            verify(followups).create(any(), eq(who.user()));
        }

        private UpdateStatusActionHandler statusHandler(LeadStatusService statuses, AudienceResponseRepository leads) {
            when(statuses.listForInstitute(INST)).thenReturn(List.of(status("s-new", "NEW", "New"),
                    status("s-int", "INTERESTED", "Interested"), status("s-conv", "CONVERTED", "Converted"),
                    status("s-lost", "LOST", "Lost"), status("s-ni", "NOT_INTERESTED", "Not interested")));
            AudienceResponse lead = new AudienceResponse();
            lead.setLeadStatusId("s-new");
            when(leads.findById("ar1")).thenReturn(Optional.of(lead));
            return new UpdateStatusActionHandler(statuses, leads, timeline);
        }

        @Test
        @DisplayName("status_neverConverted: the engine never marks a lead Converted, and the menu leaves it out")
        void status_neverConverted() {
            UpdateStatusActionHandler h = statusHandler(mock(LeadStatusService.class), mock(AudienceResponseRepository.class));
            assertTrue(h.validate(ctx(engine, null), Map.of("statusKey", "CONVERTED")).contains("never marks a lead Converted"));
            assertFalse(h.allowedStatuses(INST).stream().anyMatch(s -> "CONVERTED".equals(s.getStatusKey())));
        }

        @Test
        @DisplayName("status_lostNeedsNote: Lost / Not interested only with a note; the note is written next to the change")
        void status_lostNeedsNote() {
            LeadStatusService statuses = mock(LeadStatusService.class);
            UpdateStatusActionHandler h = statusHandler(statuses, mock(AudienceResponseRepository.class));
            assertNotNull(h.validate(ctx(engine, null), Map.of("statusKey", "LOST")));
            assertNotNull(h.validate(ctx(engine, null), Map.of("statusKey", "NOT_INTERESTED")));
            Map<String, String> params = Map.of("statusKey", "LOST", "note", "Said on the call they joined another institute.");
            assertNull(h.validate(ctx(engine, null), params));
            Map<String, String> result = h.execute(ctx(engine, null), params, approver());
            verify(statuses).changeLeadStatus("ar1", "s-lost", "admin-1", "ENGAGEMENT_ENGINE");
            verify(timeline).logEngineNote(eq("ar1"), eq("AI: status moved to Lost"), anyString(), anyMap(), any());
            assertEquals("s-new", result.get("fromStatusId"));
        }

        @Test
        @DisplayName("status_otherStatusesAllowed and undo goes back to the previous status")
        void status_undo() {
            LeadStatusService statuses = mock(LeadStatusService.class);
            UpdateStatusActionHandler h = statusHandler(statuses, mock(AudienceResponseRepository.class));
            Map<String, String> params = Map.of("statusKey", "INTERESTED");
            assertNull(h.validate(ctx(engine, null), params));
            Map<String, String> result = h.execute(ctx(engine, null), params, approver());
            h.undo(ctx(engine, null), params, result, approver());
            verify(statuses).changeLeadStatus("ar1", "s-new", "admin-1", "ENGAGEMENT_ENGINE");
            assertNotNull(h.validate(ctx(engine, null), Map.of("statusKey", "NEW")), "already in that status");
            assertNotNull(h.validate(ctx(engine, null), Map.of("statusKey", "NO_SUCH")));
        }

        private ScheduleAiCallActionHandler callHandler(AiCallQueueService queue) {
            when(coordination.aiCallCounts(anyString(), any(), any())).thenReturn(Map.of());
            return new ScheduleAiCallActionHandler(queue, coordination);
        }

        @Test
        @DisplayName("C2_C3_noCallAfterWrongNumberOrDnd: a wrong number or do-not-disturb on any call stops AI calls")
        void C2_C3_noCallAfterWrongNumberOrDnd() {
            ScheduleAiCallActionHandler h = callHandler(mock(AiCallQueueService.class));
            when(coordination.doNotCall(INST, "ar1")).thenReturn(true);
            assertTrue(h.validate(ctx(engine, "9876543210"), Map.of()).contains("wrong number or do-not-disturb"));
        }

        @Test
        @DisplayName("C4_maxAttempts: 3 AI calls this week from any system is the limit")
        void C4_maxAttempts() {
            ScheduleAiCallActionHandler h = callHandler(mock(AiCallQueueService.class));
            when(coordination.aiCallCounts(anyString(), any(), any())).thenReturn(Map.of("ar1", 3L));
            assertTrue(h.validate(ctx(engine, "9876543210"), Map.of()).contains("limit is 3"));
            assertNotNull(h.validate(ctx(engine, null), Map.of()), "no phone");
        }

        @Test
        @DisplayName("C7_throughTheQueue: queued as automation (calling shifts, capacity) on the engine's agent; undo cancels it")
        void C7_throughTheQueue() {
            AiCallQueueService queue = mock(AiCallQueueService.class);
            ScheduleAiCallActionHandler h = callHandler(queue);
            when(queue.enqueue(any(), eq(CallTrigger.AUTOMATION), eq("ENGAGEMENT_ENGINE"), eq("a1"), eq("admin-1")))
                    .thenReturn(AiCallQueueDTOs.EnqueueResult.builder().queued(true).queueItemId("q-1").build());
            EngagementEngine withAgent = engine("{\"AI_CALL\":{\"agent\":\"Admissions caller\"}}");
            Map<String, String> result = h.execute(ctx(withAgent, "9876543210"), Map.of(), approver());
            verify(queue).enqueue(argThat(r -> "Admissions caller".equals(r.getCampaignName())
                    && "ar1".equals(r.getResponseId()) && "9876543210".equals(r.getPhoneNumber())),
                    any(), any(), any(), any());
            when(queue.cancelOne(INST, "q-1", "Undone in the engagement inbox")).thenReturn(true);
            h.undo(ctx(withAgent, "9876543210"), Map.of(), result, approver());
            when(queue.cancelOne(INST, "q-1", "Undone in the engagement inbox")).thenReturn(false);
            assertThrows(VacademyException.class, () -> h.undo(ctx(withAgent, "9876543210"), Map.of(), result, approver()));
        }

        @Test
        @DisplayName("the engine's own CRM writes never wake it")
        void ownWritesDoNotWake() {
            EngagementWakeService wake = new EngagementWakeService(mock(EngagementWakeDao.class),
                    mock(EngagementMemberRepository.class), mock(EngagementEngineService.class), mock(EngagementLeadMoveService.class));
            EngagementWakeService.withoutWakes(() -> {
                wake.wakeLead(INST, "ar1", null, EngagementWakeService.FOLLOWUP, true);
                return null;
            });
            assertEquals(0, wake.queuedCount());
            wake.wakeLead(INST, "ar1", null, EngagementWakeService.FOLLOWUP, true);
            assertEquals(1, wake.queuedCount());
        }
    }

    // ── the service: allow-list, approve, undo ────────────────────────────

    @Nested
    @DisplayName("Service: allow-list, approve, scheduled call, undo")
    class Service {
        private EngagementActionRepository actions;
        private EngagementMemberRepository members;
        private EngagementEngineRepository engines;
        private EngagementActionHandler note;
        private ScheduleAiCallActionHandler call;
        private EngagementCrmActionService service;
        private EngagementEngine engine;
        private EngagementAction task;

        @BeforeEach
        void setUp() {
            actions = mock(EngagementActionRepository.class);
            members = mock(EngagementMemberRepository.class);
            engines = mock(EngagementEngineRepository.class);
            note = mock(EngagementActionHandler.class);
            when(note.type()).thenReturn(EngagementActionTypes.ADD_NOTE);
            call = mock(ScheduleAiCallActionHandler.class);
            when(call.type()).thenReturn(EngagementActionTypes.SCHEDULE_AI_CALL);
            ContactResolver contacts = mock(ContactResolver.class);
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").phone("9876543210").build()));
            service = new EngagementCrmActionService(List.of(note, call), actions, members, engines, contacts);
            engine = engine("{\"actions\":[\"ADD_NOTE\",\"SCHEDULE_AI_CALL\",\"NOT_A_TYPE\"]}");
            when(engines.findById("e1")).thenReturn(Optional.of(engine));
            when(members.findById("m1")).thenReturn(Optional.of(member()));
            task = new EngagementAction();
            task.setId("t1");
            task.setEngineId("e1");
            task.setMemberId("m1");
            task.setInstituteId(INST);
            task.setKind("TASK");
            task.setStatus("DISPATCHING");
            task.setActionType(EngagementActionTypes.ADD_NOTE);
            task.setVariablesJson(service.taskVariables(Map.of("note", "Asked for hostel fees")));
            when(actions.findById("t1")).thenReturn(Optional.of(task));
            when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(actions.claimCrmAction(eq("t1"), eq(INST), anyList(), any())).thenReturn(1);
        }

        @Test
        @DisplayName("S4_allowListOnTheServer: only the types the engine allows; none by default")
        void S4_allowListOnTheServer() {
            assertEquals(List.of(EngagementActionTypes.ADD_NOTE, EngagementActionTypes.SCHEDULE_AI_CALL), service.allowedActions(engine));
            assertEquals(List.of(), service.allowedActions(engine("{\"EMAIL\":{\"enabled\":true}}")));
            assertTrue(service.validateProposal(engine("{}"), member(), null, EngagementActionTypes.ADD_NOTE, Map.of("note", "x"))
                    .contains("not allowed"));
        }

        @Test
        @DisplayName("approve runs the handler, stores what undo needs, and marks the task done")
        void approveRuns() {
            when(note.execute(any(), anyMap(), any())).thenReturn(Map.of("noteId", "n-9"));
            when(note.describe(any(), anyMap())).thenReturn("Add a note");
            EngagementAction done = service.approve("t1", INST, admin());
            assertEquals("DONE", done.getStatus());
            assertEquals("ACCEPTED", done.getOutcome());
            assertTrue(done.getVariablesJson().contains("n-9"));
            assertEquals("n-9", service.result(done).get("noteId"));
        }

        @Test
        @DisplayName("approve re-checks: a proposal no longer valid goes back to the inbox with the reason")
        void approveRechecks() {
            when(note.validate(any(), anyMap())).thenReturn("The note is empty.");
            assertThrows(VacademyException.class, () -> service.approve("t1", INST, admin()));
            verify(note, never()).execute(any(), anyMap(), any());
            assertEquals("OPEN", task.getStatus());
            assertTrue(task.getErrorMessage().contains("The note is empty."));
        }

        @Test
        @DisplayName("approve is at most once: a second click finds nothing to claim")
        void approveOnce() {
            when(actions.claimCrmAction(eq("t1"), eq(INST), anyList(), any())).thenReturn(0);
            assertThrows(VacademyException.class, () -> service.approve("t1", INST, admin()));
            verify(note, never()).execute(any(), anyMap(), any());
        }

        @Test
        @DisplayName("C1_callBackAtTheAskedTime: an AI call asked for later waits as a scheduled row, queued then")
        void C1_callBackAtTheAskedTime() {
            task.setActionType(EngagementActionTypes.SCHEDULE_AI_CALL);
            task.setVariablesJson(service.taskVariables(Map.of("dueInHours", "26")));
            Instant later = Instant.now().plus(Duration.ofHours(26));
            when(call.callAt(any(), anyMap())).thenReturn(later);
            EngagementAction held = service.approve("t1", INST, admin());
            assertEquals("SEND", held.getKind());
            assertEquals("OPEN", held.getStatus());
            assertEquals(later, held.getScheduledFor());
            verify(call, never()).execute(any(), anyMap(), any());

            // Its time comes: the dispatch job hands it back, it is re-checked and queued.
            when(actions.claimForDispatch(eq("t1"), eq(INST), any())).thenReturn(1);
            when(call.execute(any(), anyMap(), argThat(a -> "admin-1".equals(a.userId())))).thenReturn(Map.of("queueItemId", "q-1"));
            assertTrue(service.runScheduled(held, Instant.now()));
            assertEquals("DONE", held.getStatus());
        }

        @Test
        @DisplayName("C1_rechecksAtCallTime: a lead who said don't-call since is not called; the row expires with the reason")
        void C1_rechecksAtCallTime() {
            task.setActionType(EngagementActionTypes.SCHEDULE_AI_CALL);
            task.setKind("SEND");
            when(actions.claimForDispatch(eq("t1"), eq(INST), any())).thenReturn(1);
            when(call.validate(any(), anyMap())).thenReturn("wrong number or do-not-disturb");
            assertFalse(service.runScheduled(task, Instant.now()));
            assertEquals("EXPIRED", task.getStatus());
            verify(call, never()).execute(any(), anyMap(), any());
        }

        @Test
        @DisplayName("S9_undo: a done action is reversed through its handler and labelled UNDONE")
        void S9_undo() {
            task.setStatus("DONE");
            task.setOutcome("ACCEPTED");
            task.setVariablesJson("{\"action\":{\"note\":\"x\"},\"result\":{\"noteId\":\"n-9\"}}");
            when(actions.claimCrmUndo(eq("t1"), eq(INST), anyList(), any())).thenReturn(1);
            EngagementAction undone = service.undo("t1", INST, admin());
            verify(note).undo(any(), eq(Map.of("note", "x")), eq(Map.of("noteId", "n-9")), any());
            assertEquals(EngagementCrmActionService.OUTCOME_UNDONE, undone.getOutcome());
        }

        @Test
        @DisplayName("S9_undoWaitingCall: an approved call still waiting for its time is simply dropped")
        void S9_undoWaitingCall() {
            task.setActionType(EngagementActionTypes.SCHEDULE_AI_CALL);
            task.setKind("SEND");
            task.setStatus("OPEN");
            when(actions.claimForDispatch(eq("t1"), eq(INST), any())).thenReturn(1);
            EngagementAction undone = service.undo("t1", INST, admin());
            assertEquals("DISMISSED", undone.getStatus());
            verify(call, never()).undo(any(), anyMap(), anyMap(), any());
        }

        @Test
        @DisplayName("the menu lists the allowed actions and, in template mode, the approved email templates")
        void menu() {
            EngagementEmailTemplateCatalog catalog = mock(EngagementEmailTemplateCatalog.class);
            when(catalog.findApprovedEmailTemplates("e1", INST)).thenReturn(List.of(
                    new EngagementBrainClient.TemplateOption("fees", "SUBJECT: Fees\n\nHi {{first_name}}", List.of("first_name"), "en")));
            ReflectionTestUtils.setField(service, "emailCatalog", catalog);
            EngagementEngine templated = engine("{\"actions\":[\"ADD_NOTE\"],\"EMAIL\":{\"enabled\":true,\"mode\":\"TEMPLATE\"}}");
            EngagementBrainClient.ActionMenu menu = service.menu(templated);
            assertEquals(List.of(EngagementActionTypes.ADD_NOTE), menu.actions());
            assertEquals(1, menu.emailTemplates().size());
            assertNull(service.menu(engine("{\"actions\":[\"ADD_NOTE\"]}")).emailTemplates(), "free-write email by default");
        }
    }

    // ── the brain contract and the decision ───────────────────────────────

    @Nested
    @DisplayName("Decision: a CRM proposal becomes an inbox task, never an auto-send")
    class Decision {
        private EngagementBrainClient brain;
        private EngagementActionRepository actions;
        private EngagementCrmActionService crm;
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
            actions = mock(EngagementActionRepository.class);
            crm = mock(EngagementCrmActionService.class);
            EngagementPromptVersionRepository prompts = mock(EngagementPromptVersionRepository.class);
            service = new EngagementDecisionService(registry, contacts, gate, brain, members, actions, prompts,
                    mock(EngagementTemplateProposalRepository.class));
            ReflectionTestUtils.setField(service, "crmActions", crm);
            ReflectionTestUtils.setField(service, "taskExpireHours", 72);
            ReflectionTestUtils.setField(service, "maxScheduleHours", 168);
            ReflectionTestUtils.setField(service, "defaultFirstN", 5);
            engine = engine("{\"EMAIL\":{\"enabled\":true,\"auto\":true},\"actions\":[\"UPDATE_STATUS\"]}");
            EngagementPromptVersion prompt = new EngagementPromptVersion();
            prompt.setId("p1");
            prompt.setCompiledText("Nurture.");
            when(prompts.findTopByEngineIdAndStatusOrderByVersionDesc("e1", "ACTIVE")).thenReturn(Optional.of(prompt));
            member = member();
            when(members.findById("m1")).thenAnswer(inv -> Optional.of(member));
            when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").build()));
            when(registry.hydrate(any(), anyList(), anyList())).thenReturn(new DataPointRegistry.CohortBundle(List.of(), Map.of()));
            when(gate.optedOutUserIds(anyString(), anyList())).thenReturn(Set.of());
            when(gate.preDecision(any(), any())).thenReturn(PolicyGate.Verdict.PROCEED);
            when(gate.clampToAllowedWindow(any(), any())).thenAnswer(inv -> inv.getArgument(1));
            when(crm.menu(any())).thenReturn(new EngagementBrainClient.ActionMenu(
                    List.of(EngagementActionTypes.UPDATE_STATUS), List.of(), null));
            when(crm.taskVariables(any())).thenReturn("{\"action\":{}}");
            when(crm.describe(any(), any(), any(), anyString(), any())).thenReturn("Move the lead to Lost: ...");
        }

        private void brainSays(String type, Map<String, String> params) {
            when(brain.decide(any(), anyString(), any(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", type, null, null, null, null, "they declined",
                            40, null, null, null, null, null, params));
        }

        @Test
        @DisplayName("a valid proposal is an OPEN inbox TASK with the action's text, never a SEND")
        void validProposalIsTask() {
            brainSays("UPDATE_STATUS", Map.of("statusKey", "LOST", "note", "Joined elsewhere"));
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "TASK".equals(a.getKind()) && "UPDATE_STATUS".equals(a.getActionType())
                    && "OPEN".equals(a.getStatus()) && a.getChannel() == null));
            verify(actions, never()).save(argThat(a -> "SEND".equals(a.getKind())));
            // B7: the new task is offered to autonomy, which decides whether it may run alone.
            verify(crm).tryAutonomous(argThat(a -> "UPDATE_STATUS".equals(a.getActionType())), eq(engine), any(),
                    any(), any(), eq(false), eq(false));
        }

        @Test
        @DisplayName("S4_rejectedProposalIsNoOp: a proposal the server rejects is a NO_OP with the reason, nothing to approve")
        void S4_rejectedProposalIsNoOp() {
            brainSays("SCHEDULE_AI_CALL", Map.of());
            when(crm.validateProposal(any(), any(), any(), eq("SCHEDULE_AI_CALL"), any()))
                    .thenReturn("SCHEDULE_AI_CALL is not allowed for this engine.");
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "NO_OP".equals(a.getKind()) && a.getRationale().contains("not allowed")));
            verify(actions, never()).save(argThat(a -> "TASK".equals(a.getKind())));
        }

        @Test
        @DisplayName("an engine that only messages keeps today's brain call (no action menu)")
        void messagesOnlyEngineUnchanged() {
            when(crm.menu(any())).thenReturn(EngagementBrainClient.ActionMenu.NONE);
            when(brain.decide(any(), anyString(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("NO_OP", null, null, null, null, null, "wait", 0, null, null, null, null));
            service.decideCohort(engine, List.of(member));
            verify(brain).decide(any(), anyString(), any(), any(), any(), any());
            verify(brain, never()).decide(any(), anyString(), any(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("template-only email: the chosen template is rendered and attached; a missing variable leaves it a task to fix")
        void templateEmail() {
            EngagementEmailTemplateCatalog catalog = mock(EngagementEmailTemplateCatalog.class);
            ReflectionTestUtils.setField(service, "emailCatalog", catalog);
            when(crm.menu(any())).thenReturn(new EngagementBrainClient.ActionMenu(List.of(), List.of(), List.of()));
            when(actions.countApprovedSendsForChannel("e1", "EMAIL")).thenReturn(9L);
            when(brain.decide(any(), anyString(), any(), any(), any(), any(), any())).thenReturn(
                    new EngagementBrainClient.Decision("ACT", "SEND_MESSAGE", "EMAIL", "ignored", "fees",
                            Map.of("first_name", "Ravi"), "fees asked", 50, 0, null, null, null, null, null));
            when(catalog.render("e1", INST, "fees", Map.of("first_name", "Ravi"))).thenReturn(Optional.of(
                    new EngagementEmailTemplateCatalog.RenderedEmail("tpl-1", "fees", 2, "Fees for 2027", "<p>Hi Ravi</p>",
                            "Hi Ravi", List.of(), List.of())));
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "SEND".equals(a.getKind()) && "fees".equals(a.getTemplateName())
                    && "Hi Ravi".equals(a.getDraftBody()) && a.getVariablesJson().contains("tpl-1")));

            when(catalog.render("e1", INST, "fees", Map.of("first_name", "Ravi"))).thenReturn(Optional.of(
                    new EngagementEmailTemplateCatalog.RenderedEmail("tpl-1", "fees", 2, "Fees", "<p>Hi </p>",
                            "Hi ", List.of("first_name"), List.of())));
            member.setLastDecidedAt(null);
            service.decideCohort(engine, List.of(member));
            verify(actions).save(argThat(a -> "TASK".equals(a.getKind()) && a.getTemplateName() == null
                    && a.getErrorMessage() != null && a.getErrorMessage().contains("first_name")));
        }

        @Test
        @DisplayName("the prompt lists only the allowed actions, the statuses without Converted, and the Lost note rule")
        void promptMenu() {
            String section = EngagementBrainClient.actionSection(new EngagementBrainClient.ActionMenu(
                    List.of(EngagementActionTypes.UPDATE_STATUS, EngagementActionTypes.ADD_NOTE),
                    List.of(new EngagementBrainClient.StatusOption("LOST", "Lost")), null));
            assertTrue(section.contains("UPDATE_STATUS"));
            assertTrue(section.contains("ADD_NOTE"));
            assertFalse(section.contains("SCHEDULE_AI_CALL"));
            assertTrue(section.contains("Never Converted"));
            assertTrue(section.contains("NOT_INTERESTED need a note"));
            assertEquals("", EngagementBrainClient.actionSection(EngagementBrainClient.ActionMenu.NONE));
        }
    }
}
