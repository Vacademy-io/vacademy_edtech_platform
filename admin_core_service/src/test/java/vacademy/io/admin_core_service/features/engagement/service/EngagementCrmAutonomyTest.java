package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.engagement.actions.ScheduleAiCallActionHandler;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementAction;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
 * B7: autonomy per CRM action type — graduation per type (S7), the kill switch covers every
 * action (S6), holdout gets none (S10), credits hold an AI call but not a note (S5), the
 * counsellor hold, and undo of what the engine did on its own (S9).
 */
class EngagementCrmAutonomyTest {

    private static final String INST = "i1";

    private EngagementActionRepository actions;
    private EngagementMemberRepository members;
    private EngagementEngineRepository engines;
    private EngagementActionHandler note;
    private EngagementActionHandler status;
    private EngagementActionHandler followup;
    private ScheduleAiCallActionHandler call;
    private CreditClient credits;
    private EngagementCoordinationDao coordination;
    private EngagementCrmActionService service;
    private EngagementEngine engine;
    private EngagementMember member;

    private static EngagementEngine engine(String channels) {
        EngagementEngine e = new EngagementEngine();
        e.setId("e1");
        e.setInstituteId(INST);
        e.setStatus("ACTIVE");
        e.setCadenceHours(72);
        e.setChannels(channels);
        e.setAutoSendKilled(false);
        return e;
    }

    private EngagementAction task(String type) {
        EngagementAction a = new EngagementAction();
        a.setId("t-" + type);
        a.setEngineId("e1");
        a.setMemberId("m1");
        a.setInstituteId(INST);
        a.setKind("TASK");
        a.setStatus("OPEN");
        a.setActionType(type);
        a.setVariablesJson(service.taskVariables(Map.of("note", "x")));
        when(actions.claimCrmAction(eq(a.getId()), eq(INST), anyList(), any())).thenReturn(1);
        when(actions.findById(a.getId())).thenReturn(Optional.of(a));
        return a;
    }

    @BeforeEach
    void setUp() {
        actions = mock(EngagementActionRepository.class);
        members = mock(EngagementMemberRepository.class);
        engines = mock(EngagementEngineRepository.class);
        note = handler(EngagementActionTypes.ADD_NOTE);
        status = handler(EngagementActionTypes.UPDATE_STATUS);
        followup = handler(EngagementActionTypes.CREATE_FOLLOWUP);
        call = mock(ScheduleAiCallActionHandler.class);
        when(call.type()).thenReturn(EngagementActionTypes.SCHEDULE_AI_CALL);
        when(call.callAt(any(), anyMap())).thenAnswer(inv -> Instant.now());
        when(call.execute(any(), anyMap(), any())).thenReturn(Map.of("queueItemId", "q-1"));
        ContactResolver contacts = mock(ContactResolver.class);
        when(contacts.resolve(anyList())).thenReturn(List.of(Subject.builder().memberId("m1").phone("9876543210").build()));
        service = new EngagementCrmActionService(List.of(note, status, followup, call, handler(EngagementActionTypes.ESCALATE)),
                actions, members, engines, contacts);
        credits = mock(CreditClient.class);
        when(credits.readBalance(INST)).thenReturn(Optional.of(100.0));
        coordination = mock(EngagementCoordinationDao.class);
        ReflectionTestUtils.setField(service, "creditClient", credits);
        ReflectionTestUtils.setField(service, "coordinationDao", coordination);
        engine = engine("{\"actions\":[{\"type\":\"ADD_NOTE\",\"auto\":true},{\"type\":\"UPDATE_STATUS\",\"auto\":true},"
                + "{\"type\":\"CREATE_FOLLOWUP\",\"auto\":true},{\"type\":\"SCHEDULE_AI_CALL\",\"auto\":true},\"ESCALATE\"]}");
        when(engines.findById("e1")).thenReturn(Optional.of(engine));
        member = new EngagementMember();
        member.setId("m1");
        member.setEngineId("e1");
        member.setInstituteId(INST);
        member.setAudienceResponseId("ar1");
        member.setStatus("ACTIVE");
        when(members.findById("m1")).thenReturn(Optional.of(member));
        when(actions.save(any())).thenAnswer(inv -> inv.getArgument(0));
        // Graduated on every type unless a test says otherwise.
        when(actions.countApprovedCrmActions(eq("e1"), anyString())).thenReturn(5L);
    }

    private static EngagementActionHandler handler(String type) {
        EngagementActionHandler h = mock(EngagementActionHandler.class);
        when(h.type()).thenReturn(type);
        when(h.execute(any(), anyMap(), any())).thenReturn(Map.of("ref", "r-1"));
        when(h.describe(any(), anyMap())).thenReturn("did " + type);
        return h;
    }

    @Test
    @DisplayName("auto is per type: only types marked auto may run alone (ESCALATE here is allowed but not auto)")
    void autoIsPerType() {
        assertEquals(List.of(EngagementActionTypes.ADD_NOTE, EngagementActionTypes.CREATE_FOLLOWUP,
                EngagementActionTypes.UPDATE_STATUS, EngagementActionTypes.SCHEDULE_AI_CALL), service.autoActions(engine));
        assertTrue(service.allowedActions(engine).contains(EngagementActionTypes.ESCALATE));
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.ESCALATE, null, false, false));
    }

    @Test
    @DisplayName("S7_graduationPerType: 5 approved notes do not unlock status changes or AI calls")
    void S7_graduationPerType() {
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.ADD_NOTE)).thenReturn(5L);
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.UPDATE_STATUS)).thenReturn(0L);
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.SCHEDULE_AI_CALL)).thenReturn(4L);
        assertNull(service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE, null, false, false));
        assertTrue(service.autonomyBlock(engine, member, EngagementActionTypes.UPDATE_STATUS, null, false, false).contains("approved"));
        assertTrue(service.autonomyBlock(engine, member, EngagementActionTypes.SCHEDULE_AI_CALL, null, false, false).contains("approved"));
    }

    @Test
    @DisplayName("S6_killSwitchStopsEverything: notes, status changes and AI calls all stay in the inbox")
    void S6_killSwitchStopsEverything() {
        engine.setAutoSendKilled(true);
        for (String type : List.of(EngagementActionTypes.ADD_NOTE, EngagementActionTypes.UPDATE_STATUS,
                EngagementActionTypes.SCHEDULE_AI_CALL, EngagementActionTypes.CREATE_FOLLOWUP)) {
            assertEquals("the kill switch is on", service.autonomyBlock(engine, member, type, null, false, false), type);
        }
    }

    @Test
    @DisplayName("S6_killSwitchStopsAScheduledAutonomousCall: a call the engine scheduled itself goes back to a person")
    void S6_killSwitchStopsAScheduledAutonomousCall() {
        EngagementAction scheduled = task(EngagementActionTypes.SCHEDULE_AI_CALL);
        scheduled.setKind("SEND");
        scheduled.setVariablesJson("{\"action\":{},\"approvedBy\":\"ENGAGEMENT_ENGINE\"}");
        when(actions.claimForDispatch(eq(scheduled.getId()), eq(INST), any())).thenReturn(1);
        engine.setAutoSendKilled(true);
        assertFalse(service.runScheduled(scheduled, Instant.now()));
        assertEquals("TASK", scheduled.getKind());
        assertEquals("OPEN", scheduled.getStatus());
        verify(call, never()).execute(any(), anyMap(), any());
    }

    @Test
    @DisplayName("a call a person approved for later still goes when the kill switch is on (the switch stops autonomy)")
    void humanApprovedCallIgnoresKillSwitch() {
        EngagementAction scheduled = task(EngagementActionTypes.SCHEDULE_AI_CALL);
        scheduled.setKind("SEND");
        scheduled.setVariablesJson("{\"action\":{},\"approvedBy\":\"admin-1\"}");
        when(actions.claimForDispatch(eq(scheduled.getId()), eq(INST), any())).thenReturn(1);
        engine.setAutoSendKilled(true);
        assertTrue(service.runScheduled(scheduled, Instant.now()));
        assertEquals("ACCEPTED", scheduled.getOutcome());
    }

    @Test
    @DisplayName("S10_holdoutGetsNothing: no autonomous action, no approval, no scheduled call")
    void S10_holdoutGetsNothing() {
        member.setIsHoldout(true);
        assertEquals("holdout", service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE, null, false, false));
        EngagementAction t = task(EngagementActionTypes.ADD_NOTE);
        CustomUserDetails admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        org.junit.jupiter.api.Assertions.assertThrows(vacademy.io.common.exceptions.VacademyException.class,
                () -> service.approve(t.getId(), INST, admin));
        verify(note, never()).execute(any(), anyMap(), any());
    }

    @Test
    @DisplayName("S5_creditsHoldCallsNotNotes: out of credits an AI call waits for a person; notes and follow-ups go on")
    void S5_creditsHoldCallsNotNotes() {
        when(credits.readBalance(INST)).thenReturn(Optional.of(0.0));
        assertTrue(service.autonomyBlock(engine, member, EngagementActionTypes.SCHEDULE_AI_CALL, null, false, false).contains("credits"));
        assertNull(service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE, null, false, false));
        assertNull(service.autonomyBlock(engine, member, EngagementActionTypes.CREATE_FOLLOWUP, null, false, false));
        when(credits.readBalance(INST)).thenReturn(Optional.empty());
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.SCHEDULE_AI_CALL, null, false, false),
                "an unknown balance holds the call (C-6)");
    }

    @Test
    @DisplayName("counsellor hold: calls and status changes wait; notes and follow-ups for the counsellor still run")
    void counsellorHold() {
        String hold = EngagementCoordinationService.HOLD_HUMAN_TOUCH;
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.UPDATE_STATUS, hold, false, false));
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.SCHEDULE_AI_CALL, null, true, false));
        assertNull(service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE, hold, true, false));
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE,
                EngagementCoordinationService.HOLD_DO_NOT_AUTOMATE, false, false), "do-not-automate stops everything");
        assertNotNull(service.autonomyBlock(engine, member, EngagementActionTypes.ADD_NOTE, null, false, true), "dry run");
    }

    @Test
    @DisplayName("tryAutonomous runs a graduated auto action, marked AUTO (so it never counts toward graduation)")
    void runsAndMarksAuto() {
        EngagementAction t = task(EngagementActionTypes.ADD_NOTE);
        EngagementAction done = service.tryAutonomous(t, engine, member, null, null, false, false);
        verify(note).execute(any(), anyMap(), argThat(a -> a.userId() == null));
        assertEquals("DONE", done.getStatus());
        assertEquals(EngagementCrmActionService.OUTCOME_AUTO, done.getOutcome());
    }

    @Test
    @DisplayName("tryAutonomous leaves a blocked action as the inbox task it is")
    void blockedStaysATask() {
        when(actions.countApprovedCrmActions("e1", EngagementActionTypes.UPDATE_STATUS)).thenReturn(1L);
        EngagementAction t = task(EngagementActionTypes.UPDATE_STATUS);
        EngagementAction same = service.tryAutonomous(t, engine, member, null, null, false, false);
        assertEquals("OPEN", same.getStatus());
        verify(status, never()).execute(any(), anyMap(), any());
        verify(actions, never()).claimCrmAction(eq(t.getId()), any(), anyList(), any());
    }

    @Test
    @DisplayName("F5_autonomousFollowupNeedsAnOwner: owned by the lead's counsellor; none → left to a person")
    void F5_autonomousFollowupNeedsAnOwner() {
        EngagementAction t = task(EngagementActionTypes.CREATE_FOLLOWUP);
        when(coordination.leadOwnerUserId(INST, "ar1")).thenReturn(null);
        EngagementAction left = service.tryAutonomous(t, engine, member, null, null, false, false);
        assertEquals("OPEN", left.getStatus());
        assertTrue(left.getErrorMessage().contains("no counsellor"));

        EngagementAction t2 = task(EngagementActionTypes.CREATE_FOLLOWUP);
        t2.setId("t-2");
        when(actions.claimCrmAction(eq("t-2"), eq(INST), anyList(), any())).thenReturn(1);
        when(coordination.leadOwnerUserId(INST, "ar1")).thenReturn("counsellor-7");
        service.tryAutonomous(t2, engine, member, null, null, false, false);
        verify(followup).execute(any(), anyMap(), argThat(a -> "counsellor-7".equals(a.userId()) && a.user() != null));
    }

    @Test
    @DisplayName("an autonomous call for later is held as a scheduled row the engine owns")
    void autonomousCallForLater() {
        when(call.callAt(any(), anyMap())).thenReturn(Instant.now().plus(Duration.ofHours(20)));
        EngagementAction t = task(EngagementActionTypes.SCHEDULE_AI_CALL);
        EngagementAction held = service.tryAutonomous(t, engine, member, "9876543210", null, false, false);
        assertEquals("SEND", held.getKind());
        assertTrue(held.getVariablesJson().contains("\"approvedBy\":\"ENGAGEMENT_ENGINE\""));
        verify(call, never()).execute(any(), anyMap(), any());
    }

    @Test
    @DisplayName("S9_undoAutonomous: what the engine did on its own can be undone like an approved action")
    void S9_undoAutonomous() {
        EngagementAction t = task(EngagementActionTypes.ADD_NOTE);
        t.setStatus("DONE");
        t.setOutcome(EngagementCrmActionService.OUTCOME_AUTO);
        t.setVariablesJson("{\"action\":{\"note\":\"x\"},\"result\":{\"ref\":\"r-1\"}}");
        when(actions.claimCrmUndo(eq(t.getId()), eq(INST), anyList(), any())).thenReturn(1);
        CustomUserDetails admin = mock(CustomUserDetails.class);
        when(admin.getUserId()).thenReturn("admin-1");
        when(admin.getUsername()).thenReturn("Asha");
        assertEquals(EngagementCrmActionService.OUTCOME_UNDONE, service.undo(t.getId(), INST, admin).getOutcome());
        verify(note).undo(any(), anyMap(), eq(Map.of("ref", "r-1")), any());
    }

    @Test
    @DisplayName("B8 settings: saving the panel rewrites only channels.actions; other channel settings survive")
    void settingsSaveKeepsChannels() throws Exception {
        engine.setChannels("{\"EMAIL\":{\"enabled\":true,\"auto\":true,\"mode\":\"TEMPLATE\"},\"actions\":[\"ESCALATE\"]}");
        when(engines.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service.saveSettings(engine, List.of(
                new EngagementCrmActionService.ActionSetting("ADD_NOTE", true, true, 0, 5, false),
                new EngagementCrmActionService.ActionSetting("UPDATE_STATUS", true, false, 0, 5, false),
                new EngagementCrmActionService.ActionSetting("SCHEDULE_AI_CALL", false, true, 0, 5, false),
                new EngagementCrmActionService.ActionSetting("NOT_A_TYPE", true, true, 0, 5, false)));
        com.fasterxml.jackson.databind.JsonNode ch = new com.fasterxml.jackson.databind.ObjectMapper().readTree(engine.getChannels());
        assertEquals("TEMPLATE", ch.path("EMAIL").path("mode").asText());
        assertEquals(List.of("ADD_NOTE", "UPDATE_STATUS"), service.allowedActions(engine));
        assertEquals(List.of("ADD_NOTE"), service.autoActions(engine));

        when(actions.countApprovedCrmActions("e1", "ADD_NOTE")).thenReturn(5L);
        when(actions.countApprovedCrmActions("e1", "UPDATE_STATUS")).thenReturn(2L);
        List<EngagementCrmActionService.ActionSetting> shown = service.settings(engine);
        EngagementCrmActionService.ActionSetting note = shown.stream().filter(x -> x.type().equals("ADD_NOTE")).findFirst().orElseThrow();
        EngagementCrmActionService.ActionSetting status = shown.stream().filter(x -> x.type().equals("UPDATE_STATUS")).findFirst().orElseThrow();
        assertTrue(note.graduated() && note.auto());
        assertFalse(status.graduated());
        assertEquals(2, status.approved());
    }
}
