package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class AiCallingApiViewsTest {

    private AiCallQueueItemRepository queue;
    private TelephonyCallLogRepository logs;
    private AiCallResultRepository results;
    private AiCallApiCallRepository calls;
    private AiCallingApiViews views;

    @BeforeEach
    void setUp() {
        queue = mock(AiCallQueueItemRepository.class);
        logs = mock(TelephonyCallLogRepository.class);
        results = mock(AiCallResultRepository.class);
        calls = mock(AiCallApiCallRepository.class);
        views = new AiCallingApiViews(calls, queue, logs, results, mock(MediaService.class),
                mock(AiCallingUsageService.class));
        when(results.findByCallLogIdIn(any())).thenReturn(List.of());
    }

    private static AiCallApiCall call(String queueId, String logId) {
        return AiCallApiCall.builder().id("call_1").instituteId("inst-1").agentId("a").phoneNumber("+919876543210")
                .queueItemId(queueId).callLogId(logId).createdAt(Instant.now()).build();
    }

    private void queueItem(String status, Instant notBefore, String reason) {
        AiCallQueueItem q = AiCallQueueItem.builder().id("q1").status(status).notBefore(notBefore)
                .statusReason(reason).build();
        when(queue.findById("q1")).thenReturn(Optional.of(q));
    }

    private void callLog(String status, Instant created) {
        callLog(status, created, null);
    }

    private void callLog(String status, Instant created, String recordingKey) {
        TelephonyCallLog l = TelephonyCallLog.builder().id("l1").status(status)
                .createdAt(Timestamp.from(created)).updatedAt(Timestamp.from(created))
                .recordingStorageKey(recordingKey).build();
        when(logs.findById("l1")).thenReturn(Optional.of(l));
    }

    private static AiCallApiCall endedAgo(Duration ago) {
        AiCallApiCall c = call(null, "l1");
        c.setTerminalSeenAt(Instant.now().minus(ago));
        return c;
    }

    @Test
    void aWaitingCallOutsideHoursShowsWhenItWillGo() {
        Instant later = Instant.now().plus(Duration.ofHours(10));
        queueItem("QUEUED", later, "Outside calling hours.");
        AiCallingApiViews.State s = views.state(call("q1", null));
        assertEquals("queued", s.status());
        assertFalse(s.isFinal());
        assertEquals(later, s.scheduledFor());
        assertEquals("Outside calling hours.", s.reason());
    }

    @Test
    void queueOutcomesBeforeAnyDial() {
        queueItem("DISPATCHING", null, null);
        assertEquals("dialing", views.state(call("q1", null)).status());
        queueItem("CANCELLED", null, "Already called the maximum number of times today.");
        AiCallingApiViews.State c = views.state(call("q1", null));
        assertEquals("canceled", c.status());
        assertTrue(c.isFinal());
        queueItem("EXPIRED", null, null);
        assertEquals("expired", views.state(call("q1", null)).status());
        queueItem("FAILED", null, "Could not be placed after 3 attempts.");
        assertEquals("failed", views.state(call("q1", null)).status());
    }

    @Test
    void unansweredCallsAreFinalAtOnce() {
        callLog("NO_ANSWER", Instant.now());
        AiCallingApiViews.State s = views.state(call(null, "l1"));
        assertEquals("no_answer", s.status());
        assertTrue(s.isFinal());
        callLog("BUSY", Instant.now());
        assertEquals("busy", views.state(call(null, "l1")).status());
    }

    @Test
    void aConnectedCallWaitsForItsOutcomeAndRecording() {
        callLog("COMPLETED", Instant.now());
        AiCallingApiViews.State waiting = views.state(call(null, "l1"));
        assertEquals("completed", waiting.status());
        assertFalse(waiting.isFinal());

        AiCallResult r = AiCallResult.builder().id("r1").callLogId("l1").processingStatus("PROCESSED")
                .disposition("Interested").transcript("assistant: Hello\nuser: Hi").build();
        when(results.findByCallLogIdIn(any())).thenReturn(List.of(r));
        // Outcome in, recording not yet copied: still waiting (the webhook would carry no link).
        assertFalse(views.state(call(null, "l1")).isFinal());

        callLog("COMPLETED", Instant.now(), "media-1");
        AiCallingApiViews.State done = views.state(call(null, "l1"));
        assertTrue(done.isFinal());
        Map<String, Object> view = views.call(call(null, "l1"), done, false);
        @SuppressWarnings("unchecked")
        Map<String, Object> outcome = (Map<String, Object>) view.get("outcome");
        assertEquals("Interested", outcome.get("disposition"));
        assertEquals("ok", outcome.get("call_quality"));
    }

    @Test
    void theOutcomeWaitCountsFromTheEndNotTheDial() {
        // Dialled 30 minutes ago (a long call), only just ended: not final yet.
        callLog("COMPLETED", Instant.now().minus(Duration.ofMinutes(30)));
        assertFalse(views.state(endedAgo(Duration.ofSeconds(5))).isFinal());
        // Ended 11 minutes ago with no outcome: finalised without one.
        AiCallingApiViews.State s = views.state(endedAgo(Duration.ofMinutes(11)));
        assertTrue(s.isFinal());
        assertNull(views.call(endedAgo(Duration.ofMinutes(11)), s, false).get("outcome"));
    }

    @Test
    void aTestCallIsFinalOnceItsOutcomeIsIn() {
        callLog("COMPLETED", Instant.now());
        when(results.findByCallLogIdIn(any())).thenReturn(List.of(AiCallResult.builder().id("r1").callLogId("l1")
                .processingStatus("PROCESSED").disposition("Completed").build()));
        AiCallApiCall c = call(null, "l1");
        c.setTestMode(true);
        assertTrue(views.state(c).isFinal());
    }

    @Test
    void aCallOurBotBrokeIsNotReportedAsTheContactsVerdict() {
        callLog("COMPLETED", Instant.now(), "media-1");
        when(results.findByCallLogIdIn(any())).thenReturn(List.of(AiCallResult.builder().id("r1").callLogId("l1")
                .processingStatus("PROCESSED").disposition("Not_Interested").leadRating(2)
                .diagHealth("RED").diagFaults("BOT_SILENT").build()));
        AiCallApiCall c = call(null, "l1");
        Map<String, Object> view = views.call(c, false);
        @SuppressWarnings("unchecked")
        Map<String, Object> outcome = (Map<String, Object>) view.get("outcome");
        assertEquals("failed", outcome.get("call_quality"));
        assertEquals("Incomplete", outcome.get("disposition"));
        assertNull(outcome.get("lead_rating"));
    }

    @Test
    void aRowStillBeingCreatedIsNotFinalButAnOldOrphanFails() {
        AiCallingApiViews.State fresh = views.state(call(null, null));
        assertEquals("queued", fresh.status());
        assertFalse(fresh.isFinal());
        AiCallApiCall old = call(null, null);
        old.setCreatedAt(Instant.now().minus(Duration.ofMinutes(10)));
        AiCallingApiViews.State s = views.state(old);
        assertEquals("failed", s.status());
        assertTrue(s.isFinal());
    }

    @Test
    void aCallThatNeverReportsAnEndFailsAfterTheBound() {
        callLog("IN_PROGRESS", Instant.now().minus(Duration.ofMinutes(5)));
        AiCallingApiViews.State live = views.state(call(null, "l1"));
        assertEquals("in_progress", live.status());
        assertFalse(live.isFinal());
        callLog("IN_PROGRESS", Instant.now().minus(Duration.ofHours(3)));
        AiCallingApiViews.State lost = views.state(call(null, "l1"));
        assertEquals("failed", lost.status());
        assertTrue(lost.isFinal());
    }

    @Test
    void endedAtPrefersTheCarriersEndTime() {
        Instant end = Instant.parse("2026-10-14T05:00:00Z");
        TelephonyCallLog l = TelephonyCallLog.builder().id("l1").endTime(Timestamp.from(end)).build();
        assertEquals(end, AiCallingApiViews.endedAt(call(null, "l1"), null, l, null, null, 90, null));
        TelephonyCallLog noEnd = TelephonyCallLog.builder().id("l1").build();
        Instant dialed = Instant.parse("2026-10-14T04:58:00Z");
        assertEquals(dialed.plusSeconds(90), AiCallingApiViews.endedAt(call(null, "l1"), null, noEnd, null, dialed, 90, null));
    }

    @Test
    void endedAtIsNeverInTheFuture() {
        // A test call: dialed now with a made-up 90 s duration, already final.
        Instant dialed = Instant.now();
        TelephonyCallLog noEnd = TelephonyCallLog.builder().id("l1").build();
        assertEquals(dialed, AiCallingApiViews.endedAt(call(null, "l1"), dialed, noEnd, null, dialed, 90, null));
    }

    @Test
    void canceledBeforeDialingEndsWhenItsQueueItemChanged() {
        Instant canceled = Instant.parse("2026-10-14T05:10:00Z");
        AiCallQueueItem item = new AiCallQueueItem();
        item.setUpdatedAt(canceled);
        assertEquals(canceled, AiCallingApiViews.endedAt(call(null, null), null, null, null, null, null, item));
    }

    @Test
    void readingACallNeverChangesTheEntity() {
        // Under open-session-in-view a GET's row is managed: a setter here was flushed as a
        // whole-row UPDATE over the finaliser's columns. Derived values travel in State.
        AiCallQueueItem q = AiCallQueueItem.builder().id("q1").status("DIALED").callLogId("l1").build();
        when(queue.findById("q1")).thenReturn(Optional.of(q));
        callLog("NO_ANSWER", Instant.now());
        AiCallApiCall c = call("q1", null);
        AiCallingApiViews.State s = views.state(c);
        assertEquals("no_answer", s.status());
        assertNotNull(s.terminalSeenAt());
        assertNull(c.getCallLogId(), "call_log_id is filled by a targeted UPDATE only");
        assertNull(c.getTerminalSeenAt(), "terminal_seen_at is filled by a targeted UPDATE only");
        verify(calls).setCallLogIdIfNull("call_1", "l1");
        verify(calls).setTerminalSeenAtIfNull(eq("call_1"), any(Instant.class));
        assertEquals(s.terminalSeenAt().toString(), views.call(c, s, false).get("ended_at"));
    }

    @Test
    void transcriptLinesBecomeTurns() {
        List<Map<String, String>> t = AiCallingApiViews.transcript(
                "assistant: Namaste, main Riya\nuser: Haan boliye\nkaun?\nassistant: Tutezy se\n\nuser:   ");
        assertEquals(3, t.size());
        assertEquals(Map.of("speaker", "agent", "text", "Namaste, main Riya"), t.get(0));
        assertEquals(Map.of("speaker", "contact", "text", "Haan boliye kaun?"), t.get(1));
        assertEquals("agent", t.get(2).get("speaker"));
        assertTrue(AiCallingApiViews.transcript(null).isEmpty());
    }

    @Test
    void meetingComesFromTheReportPayload() {
        Map<String, Object> m = AiCallingApiViews.meeting(
                "{\"meetingRequested\":true,\"meetingDatetimeIso\":\"2026-10-14T18:00:00+05:30\","
                        + "\"meetingDatetimeText\":\"tomorrow 6 pm\",\"meetingType\":\"demo\"}");
        assertEquals(true, m.get("requested"));
        assertEquals("2026-10-14T18:00:00+05:30", m.get("at"));
        assertEquals("tomorrow 6 pm", m.get("time_text"));
        assertEquals("demo", m.get("type"));

        Map<String, Object> none = AiCallingApiViews.meeting("{\"mock\":true}");
        assertEquals(false, none.get("requested"));
        assertNull(none.get("at"));
        assertEquals(false, AiCallingApiViews.meeting("not json").get("requested"));
        assertEquals(false, AiCallingApiViews.meeting(null).get("requested"));
    }
}
