package vacademy.io.admin_core_service.features.engagement.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpcomingCallsDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpcomingCallsDao.FirstCallRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpcomingCallsService.Call;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpcomingCallsService.CallState;
import vacademy.io.admin_core_service.features.engagement.service.EngagementUpcomingCallsService.UpcomingCalls;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EngagementUpcomingCallsServiceTest {

    private static final Instant T = Instant.parse("2026-10-30T10:00:00Z");

    private static CallRow row(String id, String kind, String status, String queue) {
        return new CallRow(id, "m-" + id, kind, status, "why " + id, T, T.plusSeconds(3600), queue,
                null, "DIALED".equals(queue) ? T.minusSeconds(60) : null, "DIALED".equals(queue) ? "NO_ANSWER" : null);
    }

    @Test
    void eachCallLandsInTheStateAPersonWouldNameIt() {
        assertEquals(CallState.NEEDS_APPROVAL, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "OPEN", null)));
        assertEquals(CallState.NEEDS_APPROVAL, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "ACKED", null)));
        assertEquals(CallState.SCHEDULED, EngagementUpcomingCallsService.stateOf(row("a", "SEND", "OPEN", null)));
        assertEquals(CallState.IN_QUEUE, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "DONE", "QUEUED")));
        assertEquals(CallState.IN_QUEUE, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "DONE", "DISPATCHING")));
        assertEquals(CallState.PLACED, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "DONE", "DIALED")));
        // A failed dial whose task is open again needs a person, not the queue.
        assertEquals(CallState.NEEDS_APPROVAL, EngagementUpcomingCallsService.stateOf(row("a", "TASK", "OPEN", "FAILED")));
        assertNull(EngagementUpcomingCallsService.stateOf(row("a", "TASK", "DONE", "FAILED")));
    }

    @Test
    void oneEntryPerCallWithTheTimeThatMattersForItsState() {
        List<Call> calls = EngagementUpcomingCallsService.toCalls(List.of(
                row("a", "TASK", "OPEN", null),
                row("b", "SEND", "OPEN", null),
                row("c", "TASK", "DONE", "DIALED"),
                row("c", "TASK", "DONE", "FAILED")));

        assertEquals(3, calls.size());
        assertEquals(T, calls.get(0).at());
        assertEquals(T.plusSeconds(3600), calls.get(0).expiresAt());
        assertEquals(CallState.SCHEDULED, calls.get(1).state());
        Call placed = calls.get(2);
        assertEquals(CallState.PLACED, placed.state());
        assertEquals(T.minusSeconds(60), placed.at());
        assertEquals("NO_ANSWER", placed.callStatus());
        assertNull(placed.expiresAt());
    }

    @Test
    void firstCallsAreListedOnlyForALiveEngineThatMayCall() {
        EngagementUpcomingCallsDao dao = mock(EngagementUpcomingCallsDao.class);
        EngagementCrmActionService crm = mock(EngagementCrmActionService.class);
        EngagementEngine engine = new EngagementEngine();
        engine.setId("e1");
        engine.setInstituteId("i1");
        engine.setStatus("ACTIVE");
        when(crm.settings(engine)).thenReturn(List.of(new EngagementCrmActionService.ActionSetting(
                EngagementActionTypes.SCHEDULE_AI_CALL, true, true, 1, 5, false)));
        when(crm.aiCallChannelOn(engine)).thenReturn(true);
        when(dao.calls(anyString(), anyString(), any(), anyInt())).thenReturn(List.of());
        when(dao.firstCalls("i1", "e1", EngagementUpcomingCallsService.MAX_FIRST_CALLS))
                .thenReturn(List.of(new FirstCallRow("m1", T)));

        UpcomingCalls live = new EngagementUpcomingCallsService(dao, crm).upcoming(engine);
        assertTrue(live.callingOn());
        assertTrue(live.auto());
        assertFalse(live.graduated());
        assertEquals(1, live.approved());
        assertEquals(5, live.threshold());
        assertEquals(1, live.firstCallsTotal());
        verify(dao, never()).countFirstCalls(anyString(), anyString());

        engine.setStatus("PAUSED");
        UpcomingCalls paused = new EngagementUpcomingCallsService(dao, crm).upcoming(engine);
        assertFalse(paused.engineLive());
        assertTrue(paused.firstCalls().isEmpty());
    }

    @Test
    void theFilteredInboxPutsOpenAiCallsFirstUnlessADayIsAsked() {
        EngagementTaskQueryDao.Query plain = new EngagementTaskQueryDao.Query("i1", List.of("OPEN", "ACKED"),
                List.of("e1"), null, "CRM", null, null, null, null);
        String order = EngagementTaskQueryDao.orderBy(plain);
        assertTrue(order.startsWith(" ORDER BY " + EngagementTaskQueryDao.APPROVALS_FIRST));
        assertTrue(EngagementTaskQueryDao.APPROVALS_FIRST.contains("'SCHEDULE_AI_CALL' THEN 0"));
        // A lead's reply waits on a person as much as a call does: it is not pushed below the CRM actions.
        assertTrue(EngagementTaskQueryDao.APPROVALS_FIRST.contains("a.kind = 'REPLY' THEN 0"));
        assertTrue(order.contains("priority DESC"));
    }

    @Test
    void aDraftThatNeverReachedAnyoneIsNotAFirstTouch() {
        String touch = EngagementActionRepository.TOUCH_PREDICATE;
        assertTrue(touch.contains("status <> 'SIMULATED'"));
        // Only the engine's own messages and calls that never went out stop counting; a reply draft
        // (the lead wrote in) and the internal CRM tasks still count.
        assertTrue(touch.contains("status = 'EXPIRED' AND kind IN ('TASK', 'SEND')"));
        assertFalse(touch.contains("'REPLY'"));
        // A dismissed message draft is not a touch; a dismissed AI call is (no second proposal).
        assertTrue(touch.contains("status = 'DISMISSED' AND kind = 'TASK'"));
        assertTrue(touch.substring(touch.indexOf("'DISMISSED'")).contains("'SCHEDULE_AI_CALL'"));
    }
}
