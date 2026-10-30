package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService.ActionOutcome;
import vacademy.io.admin_core_service.features.engagement.report.EngagementActionOutcomeService.CallOutcome;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.service.EngagementTaskQueryDao.TaskRow;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Per-row outcomes and the inbox's outcome filter, by the daily report's definitions. */
class EngagementActionOutcomeRulesTest {

    private static final Set<String> CONNECTED = Set.of("COMPLETED");

    private static TaskRow row(String id, String kind, String actionType, String channel, String status) {
        return new TaskRow(id, "eng-1", "mem-" + id, kind, actionType, channel, status);
    }

    private static TaskRow send(String id, String channel) {
        return row(id, "SEND", "SEND_MESSAGE", channel, "SENT");
    }

    private static Signal email(boolean delivered, boolean opened, boolean clicked, boolean bounced, boolean tracked,
                                Long replyAt) {
        return new Signal("EMAIL", "a@b.com", 1L, "Hi", "SENT", null, "SES", null, null, null,
                null, null, null, null, delivered, opened, clicked, bounced, false, tracked, replyAt);
    }

    private static Signal whatsapp(String phone, long sentAt, String status, String provider, Long replyAt) {
        return new Signal("WHATSAPP", phone, sentAt, null, status, "FAILED".equals(status) ? "131026" : null, provider,
                "tpl", "en", "MARKETING", "regular", null, true, null,
                false, false, false, false, false, false, replyAt);
    }

    private static ActionOutcome built(TaskRow r, Signal g, Long reply, CallOutcome call) {
        return EngagementActionOutcomeService.build(r, g, reply, call);
    }

    private static CallOutcome call(String queueStatus, String logId, String callStatus) {
        return EngagementActionOutcomeService.callOutcome(
                new CallRow("x", queueStatus, logId, callStatus, logId == null ? null : 81), CONNECTED);
    }

    @Nested
    class Build {

        @Test
        void emailCarriesItsEventsAndAnOpenCountsAsDelivered() {
            ActionOutcome o = built(send("e1", "EMAIL"), email(false, true, false, false, true, 5_000L), 5_000L, null);

            assertTrue(o.tracked());
            assertTrue(o.delivered());
            assertTrue(o.opened());
            assertEquals("SENT", o.deliveryStatus());
            assertEquals("1970-01-01T00:00:05Z", o.repliedAt());
            assertNull(o.call());
        }

        @Test
        void whatsappThroughWatiIsNotTrackedAndPricingIsLowerCase() {
            ActionOutcome o = built(send("w1", "WHATSAPP"), whatsapp("919800000001", 1, "read", "WATI", null),
                    null, null);

            assertFalse(o.tracked());
            assertEquals("READ", o.deliveryStatus());
            assertTrue(o.delivered());
            assertEquals("marketing", o.pricingCategory());
            assertFalse(o.opened());
        }

        @Test
        void inAppIsUntrackedButDeliveredOnceSent() {
            ActionOutcome o = built(send("i1", "IN_APP"), null, null, null);

            assertFalse(o.tracked());
            assertTrue(o.delivered());
            assertNull(o.deliveryStatus());
        }

        @Test
        void aMessageThatFailedGoingOutReadsFailedWithoutASignal() {
            ActionOutcome o = built(row("f1", "SEND", null, "EMAIL", "FAILED"), null, null, null);

            assertEquals("FAILED", o.deliveryStatus());
            assertFalse(o.delivered());
            assertFalse(o.tracked());
        }

        @Test
        void anAiCallCarriesTheCallAndNeverEmailFlags() {
            // Even if a stray notification row came back for it.
            ActionOutcome o = built(row("c1", "SEND", "CALL", "AI_CALL", "SENT"),
                    email(true, true, true, true, true, 9L), 9L, call("DIALED", "log-1", "COMPLETED"));

            assertEquals("AI_CALL", o.channel());
            assertTrue(o.tracked());
            assertTrue(o.delivered());
            assertFalse(o.opened() || o.clicked() || o.bounced() || o.complained());
            assertNull(o.repliedAt());
            assertEquals("COMPLETED", o.call().status());
            assertEquals(81, o.call().durationSeconds());
        }

        @Test
        void aScheduleAiCallTaskIsACallRowWhateverItsChannel() {
            ActionOutcome o = built(row("s1", "TASK", "SCHEDULE_AI_CALL", "WHATSAPP", "DONE"), null, null,
                    call("QUEUED", null, null));

            assertEquals("AI_CALL", o.channel());
            assertEquals("QUEUED", o.call().status());
        }

        @Test
        void callStatusFromTheQueueUntilThereIsACallLog() {
            assertEquals("NOT_DIALLED", call("EXPIRED", null, null).status());
            assertEquals("NOT_DIALLED", call("CANCELLED", null, null).status());
            assertEquals("QUEUED", call("DISPATCHING", null, null).status());
            assertEquals("INITIATED", call("DIALED", null, null).status());
            assertEquals("INITIATED", call("DIALED", "log-1", null).status());
            assertEquals("BUSY", call("DIALED", "log-1", "BUSY").status());
        }

        @Test
        void aConnectedRetryWinsOverANewerUnansweredCall() {
            Map<String, CallOutcome> calls = EngagementActionOutcomeService.pickCalls(List.of(
                    new CallRow("a", "DIALED", "log-2", "NO_ANSWER", 0),       // newest first
                    new CallRow("a", "DIALED", "log-1", "COMPLETED", 60),
                    new CallRow("b", "DIALED", "log-4", "BUSY", 0),
                    new CallRow("b", "DIALED", "log-3", "NO_ANSWER", 0)), CONNECTED);

            assertEquals("log-1", calls.get("a").callLogId());
            assertTrue(calls.get("a").connected());
            assertEquals("BUSY", calls.get("b").status());
        }
    }

    @Nested
    class Matches {

        private boolean matches(String outcome, TaskRow r, ActionOutcome o) {
            return EngagementActionOutcomeService.matches(outcome, r, o);
        }

        @Test
        void deliveredIsTheFunnelsDeliveredOnEveryChannel() {
            TaskRow e = send("e", "EMAIL"), w = send("w", "WHATSAPP"), i = send("i", "IN_APP");
            TaskRow c = row("c", "SEND", "CALL", "AI_CALL", "SENT");

            assertTrue(matches("delivered", e, built(e, email(false, false, true, false, true, null), null, null)));
            assertTrue(matches("delivered", w, built(w, whatsapp("91", 1, "DELIVERED", "META", null), null, null)));
            assertTrue(matches("delivered", i, built(i, null, null, null)));
            assertTrue(matches("delivered", c, built(c, null, null, call("DIALED", "l", "COMPLETED"))));
            assertFalse(matches("delivered", c, built(c, null, null, call("DIALED", "l", "NO_ANSWER"))));
            assertFalse(matches("delivered", w, built(w, whatsapp("91", 1, "SENT", "META", null), null, null)));
        }

        @Test
        void notDeliveredIsContactedMinusDelivered() {
            TaskRow w = send("w", "WHATSAPP"), i = send("i", "IN_APP");
            TaskRow c = row("c", "SEND", "CALL", "AI_CALL", "SENT");

            assertTrue(matches("not_delivered", w, built(w, whatsapp("91", 1, "SENT", "META", null), null, null)));
            assertTrue(matches("not_delivered", c, built(c, null, null, call("QUEUED", null, null))));
            assertFalse(matches("not_delivered", i, built(i, null, null, null)));   // in-app is delivered
        }

        @Test
        void readIsAnEmailOpenOrAWhatsAppRead() {
            TaskRow e = send("e", "EMAIL"), w = send("w", "WHATSAPP");

            assertTrue(matches("read", e, built(e, email(true, true, false, false, true, null), null, null)));
            assertTrue(matches("read", w, built(w, whatsapp("91", 1, "READ", "META", null), null, null)));
            assertFalse(matches("read", w, built(w, whatsapp("91", 1, "DELIVERED", "META", null), null, null)));
            assertFalse(matches("opened", w, built(w, whatsapp("91", 1, "READ", "META", null), null, null)));
        }

        @Test
        void emailOnlyOutcomesNeverMatchAnotherChannel() {
            TaskRow c = row("c", "SEND", "CALL", "AI_CALL", "SENT");
            ActionOutcome o = new ActionOutcome("c", "AI_CALL", true, null, true, true, true, true, true, null,
                    null, null, call("DIALED", "l", "COMPLETED"));

            for (String outcome : List.of("opened", "clicked", "bounced", "complained", "read", "replied")) {
                assertFalse(matches(outcome, c, o), outcome);
            }
        }

        @Test
        void crmWorkAndRepliesAreNotTheReportsMessages() {
            // A CRM task on an email channel and the engine's answer to an inbound are not counted
            // in the report's channels, so its outcomes never open them.
            TaskRow crm = row("n", "TASK", "ADD_NOTE", "EMAIL", "SENT");
            TaskRow reply = row("r", "REPLY", null, "WHATSAPP", "SENT");
            Signal delivered = email(true, true, false, false, true, 5L);

            assertFalse(matches("delivered", crm, built(crm, delivered, 5L, null)));
            assertFalse(matches("replied", crm, built(crm, delivered, 5L, null)));
            assertFalse(matches("delivered", reply,
                    built(reply, whatsapp("91", 1, "DELIVERED", "META", null), null, null)));
        }

        @Test
        void failedIsAFailedSendMetasFailureOrACallThatNeverConnected() {
            TaskRow dispatchFailed = row("f", "SEND", null, "EMAIL", "FAILED");
            TaskRow w = send("w", "WHATSAPP");
            TaskRow c = row("c", "SEND", "CALL", "AI_CALL", "SENT");

            assertTrue(matches("failed", dispatchFailed, built(dispatchFailed, null, null, null)));
            assertTrue(matches("failed", w, built(w, whatsapp("91", 1, "FAILED", "META", null), null, null)));
            assertTrue(matches("failed", c, built(c, null, null, call("DIALED", "l", "FAILED"))));
            assertTrue(matches("failed", c, built(c, null, null, call("EXPIRED", null, null))));
            assertFalse(matches("failed", c, built(c, null, null, call("DIALED", "l", "NO_ANSWER"))));
            assertEquals("131026", built(w, whatsapp("91", 1, "FAILED", "META", null), null, null).errorCode());
        }

        @Test
        void callOutcomesFollowTheReportsCallsTable() {
            TaskRow c = row("c", "TASK", "SCHEDULE_AI_CALL", null, "DONE");

            assertTrue(matches("connected", c, built(c, null, null, call("DIALED", "l", "COMPLETED"))));
            assertTrue(matches("no_answer", c, built(c, null, null, call("DIALED", "l", "NO_ANSWER"))));
            assertTrue(matches("busy", c, built(c, null, null, call("DIALED", "l", "BUSY"))));
            assertTrue(matches("call_failed", c, built(c, null, null, call("DIALED", "l", "FAILED"))));
            // Not dialled is a failure, but not a failed call (the calls table counts call logs).
            assertFalse(matches("call_failed", c, built(c, null, null, call("FAILED", null, null))));
            // A status the institute counts as connected is never also "no answer".
            CallOutcome custom = EngagementActionOutcomeService.callOutcome(
                    new CallRow("c", "DIALED", "l", "NO_ANSWER", 3), Set.of("COMPLETED", "NO_ANSWER"));
            assertTrue(matches("connected", c, built(c, null, null, custom)));
            assertFalse(matches("no_answer", c, built(c, null, null, custom)));
        }

        @Test
        void noOutcomeMatchesNothing() {
            assertFalse(matches("delivered", send("x", "IN_APP"), null));
        }

        @Test
        void outcomesNarrowTheChannelsRead() {
            assertEquals(Set.of("EMAIL"), EngagementActionOutcomeService.channelsFor("bounced"));
            assertEquals(Set.of("AI_CALL"), EngagementActionOutcomeService.channelsFor("busy"));
            assertEquals(Set.of("EMAIL", "WHATSAPP"), EngagementActionOutcomeService.channelsFor("replied"));
            assertEquals(4, EngagementActionOutcomeService.channelsFor("failed").size());
        }
    }

    @Nested
    class Outcomes {

        private final EngagementTaskQueryDao dao = mock(EngagementTaskQueryDao.class);
        private final EngagementReportSignalsClient signals = mock(EngagementReportSignalsClient.class);
        private final LeadReportSettingService settings = mock(LeadReportSettingService.class);
        private final InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        private final EngagementActionOutcomeService service =
                new EngagementActionOutcomeService(dao, signals, settings, tz);

        {
            when(tz.getTimezoneId("inst")).thenReturn("Asia/Kolkata");
        }

        @Test
        void aReplyAfterTheNextSameDaySendBelongsToThatSend() {
            // mon1 is on the page; mon2 went to the same person later that day and is not. The reply
            // after mon2 is mon2's, so mon1 shows no reply (the report credits it the same way).
            TaskRow mon1 = send("mon1", "WHATSAPP");
            when(dao.laterSendsSameDay(eq("inst"), eq(List.of("mon1")), eq("Asia/Kolkata")))
                    .thenReturn(List.of("mon2"));
            when(signals.fetch(eq("inst"), eq(List.of("mon1", "mon2")), anyInt())).thenReturn(new Signals(false, Map.of(
                    "mon1", whatsapp("919800000001", 1_000, "READ", "META", 5_000L),
                    "mon2", whatsapp("919800000001", 4_000, "READ", "META", 5_000L))));

            ActionOutcome o = service.outcomes("inst", List.of(mon1)).get("mon1");

            assertNull(o.repliedAt());
            assertEquals(1, service.outcomes("inst", List.of(mon1)).size());
        }

        @Test
        void aReplyBeforeTheNextSendStaysWithTheRow() {
            TaskRow mon1 = send("mon1", "WHATSAPP");
            when(dao.laterSendsSameDay(anyString(), anyList(), anyString())).thenReturn(List.of("mon2"));
            when(signals.fetch(eq("inst"), anyList(), anyInt())).thenReturn(new Signals(false, Map.of(
                    "mon1", whatsapp("919800000001", 1_000, "READ", "META", 2_000L),
                    "mon2", whatsapp("919800000001", 4_000, "DELIVERED", "META", null))));

            assertEquals("1970-01-01T00:00:02Z", service.outcomes("inst", List.of(mon1)).get("mon1").repliedAt());
        }

        @Test
        void tasksThatNeverWentOutAskNotificationServiceNothing() {
            TaskRow open = row("t", "TASK", "SEND_MESSAGE", "EMAIL", "OPEN");
            TaskRow noop = row("n", "NO_OP", null, null, "DONE");

            Map<String, ActionOutcome> out = service.outcomes("inst", List.of(open, noop));

            verify(signals, never()).fetch(anyString(), anyList(), anyInt());
            verify(dao, never()).calls(anyString(), anyList());
            assertFalse(out.get("t").tracked());
            assertNull(out.get("n").channel());
        }

        @Test
        void callsComeFromTheQueueWithTheInstitutesConnectedStatuses() {
            TaskRow c = row("c", "SEND", "CALL", "AI_CALL", "SENT");
            when(settings.get("inst")).thenReturn(null);
            when(dao.calls("inst", List.of("c")))
                    .thenReturn(List.of(new CallRow("c", "DIALED", "log", "COMPLETED", 42)));

            ActionOutcome o = service.outcomes("inst", List.of(c)).get("c");

            assertNotNull(o.call());
            assertTrue(o.call().connected());
            verify(signals, never()).fetch(anyString(), anyList(), anyInt());
        }

        @Test
        void unavailableSignalsAre503NotZero() {
            when(dao.laterSendsSameDay(anyString(), anyList(), anyString())).thenReturn(List.of());
            when(signals.fetch(anyString(), anyList(), anyInt())).thenThrow(new IllegalStateException("down"));

            VacademyException e = assertThrows(VacademyException.class,
                    () -> service.outcomes("inst", List.of(send("e", "EMAIL"))));
            assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatus());
        }
    }
}
