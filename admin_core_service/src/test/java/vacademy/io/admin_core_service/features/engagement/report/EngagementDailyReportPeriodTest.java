package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.Previous;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.TrendDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Booking;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Engine;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.MembersAdded;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.MessageCredit;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.PreviousTotals;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.Send;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.StatusChangeRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportService.Window;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportDay.Period;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The report over a period of days (design v3): the request rules, the window around the period
 * (trend, previous period, reply lookback) and the period's totals, trend and previous totals.
 */
class EngagementDailyReportPeriodTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 30);

    private static LocalDate d(int day) {
        return LocalDate.of(2026, 10, day);
    }

    /** The request rules: from + to win, date is one day, 90 days back at most, 400 otherwise. */
    @Nested
    class Rules {

        @Test
        void dateIsOneDayAndFromToWin() {
            assertEquals(new Period(d(28), d(28)), EngagementReportDay.period("2026-10-28", null, null, TODAY));
            assertEquals(new Period(d(20), d(29)),
                    EngagementReportDay.period("not-a-date", " 2026-10-20 ", "2026-10-29", TODAY));
            assertEquals(new Period(d(29), d(29)), EngagementReportDay.period(" ", "2026-10-29", "2026-10-29", TODAY));
            assertNull(EngagementReportDay.period(null, "", " ", TODAY));
        }

        @Test
        void theWindowIsTodayAndTheEightyNineDaysBefore() {
            Period longest = EngagementReportDay.period(null, "2026-08-02", "2026-10-30", TODAY);

            assertEquals(TODAY.minusDays(89), longest.from());
            assertEquals(90, longest.days());
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period(null, "2026-08-01", "2026-10-30", TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period("2026-08-01", null, null, TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period(null, "2026-10-29", "2026-10-31", TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period("2026-10-31", null, null, TODAY));
        }

        @Test
        void badFormatsOrderAndHalfAPeriodAre400() {
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period(null, "2026-10-20", null, TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period("2026-10-28", null, "2026-10-29", TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period(null, "20/10/2026", "2026-10-29", TODAY));
            assertThrows(InvalidRequestException.class,
                    () -> EngagementReportDay.period(null, "2026-10-29", "2026-10-28", TODAY));
            assertThrows(InvalidRequestException.class, () -> EngagementReportDay.period("28-10", null, null, TODAY));
        }

        @Test
        void aPeriodsDaysAndBounds() {
            Period p = new Period(d(27), d(29));
            EngagementReportDay.Bounds b = EngagementReportDay.bounds(p, IST);

            assertEquals(3, p.days());
            assertTrue(p.contains(d(27)) && p.contains(d(29)));
            assertFalse(p.contains(d(26)) || p.contains(d(30)) || p.contains(null));
            assertEquals(LocalDateTime.of(2026, 10, 26, 18, 30), b.from());
            assertEquals(LocalDateTime.of(2026, 10, 29, 18, 30), b.to());
            assertEquals(LocalDateTime.of(2026, 10, 11, 18, 30), b.scanFrom());
        }
    }

    /** The window around the period: trend, previous period, reply lookback, all in naive UTC. */
    @Nested
    class Windows {

        @Test
        void aSingleDayReadsAsBefore() {
            Window w = EngagementDailyReportService.window(d(28), d(28), TODAY, IST);

            assertEquals(1, w.days());
            assertEquals(LocalDateTime.of(2026, 10, 27, 18, 30), w.from());
            assertEquals(LocalDateTime.of(2026, 10, 28, 18, 30), w.to());
            assertEquals(d(22), w.trendFromDay());               // the 7 days ending the day
            assertEquals(d(27), w.prevFromDay());
            assertEquals(d(27), w.prevToDay());
            assertEquals(d(22), w.dataFromDay());                // the previous day is inside the trend
            assertFalse(w.previousBeforeTrend());
            // start of the trend minus the 72h reply window
            assertEquals(LocalDateTime.of(2026, 10, 18, 18, 30), w.signalsFrom());
            assertEquals(w.signalsFrom(), w.sendsFrom());
            assertEquals(LocalDateTime.of(2026, 8, 1, 18, 30), w.trackedLookback());   // start of today - 89
        }

        @Test
        void aShortPeriodKeepsASevenDayTrendThatHoldsThePreviousPeriod() {
            Window w = EngagementDailyReportService.window(d(27), d(29), TODAY, IST);

            assertEquals(3, w.days());
            assertEquals(d(23), w.trendFromDay());
            assertEquals(d(24), w.prevFromDay());
            assertEquals(d(26), w.prevToDay());
            assertEquals(d(23), w.dataFromDay());
            assertFalse(w.previousBeforeTrend());
            assertTrue(w.inPeriod(d(27)) && w.inPeriod(d(29)) && !w.inPeriod(d(26)));
            assertTrue(w.inPrevious(d(24)) && w.inPrevious(d(26)) && !w.inPrevious(d(27)) && !w.inPrevious(d(23)));
        }

        @Test
        void fromFourDaysOnThePreviousPeriodStartsBeforeTheTrend() {
            Window w = EngagementDailyReportService.window(d(26), d(29), TODAY, IST);

            assertEquals(d(23), w.trendFromDay());
            assertEquals(d(22), w.prevFromDay());
            assertEquals(d(22), w.dataFromDay());
            assertTrue(w.previousBeforeTrend());
        }

        @Test
        void aLongPeriodIsItsOwnTrendAndReadsTheEqualPeriodBefore() {
            Window w = EngagementDailyReportService.window(d(23), d(29), TODAY, IST);

            assertEquals(7, w.days());
            assertEquals(d(23), w.trendFromDay());
            assertEquals(d(16), w.prevFromDay());
            assertEquals(d(22), w.prevToDay());
            assertEquals(d(16), w.dataFromDay());
            assertEquals(LocalDateTime.of(2026, 10, 15, 18, 30), w.prevFrom());
            assertEquals(LocalDateTime.of(2026, 10, 15, 18, 30), w.dataFrom());
            assertEquals(LocalDateTime.of(2026, 10, 19, 18, 30), w.signalsFrom());   // 23rd 00:00 IST - 72h
            assertEquals(LocalDateTime.of(2026, 10, 12, 18, 30), w.sendsFrom());     // 16th 00:00 IST - 72h

            Window ninety = EngagementDailyReportService.window(TODAY.minusDays(89), TODAY, TODAY, IST);
            assertEquals(90, ninety.days());
            assertEquals(TODAY.minusDays(179), ninety.prevFromDay());
            assertEquals(TODAY.minusDays(90), ninety.prevToDay());
        }
    }

    /** The period's totals, trend and previous totals, through the service with the reads mocked. */
    @Nested
    class Report {

        private static final String INST = "inst-1";
        private static final String ENGINE = "e1";

        private EngagementDailyReportDao dao;
        private EngagementReportSignalsClient signals;
        private EngagementDailyReportService service;
        private final LocalDate today = LocalDate.now(IST);

        @BeforeEach
        void setUp() {
            dao = mock(EngagementDailyReportDao.class);
            signals = mock(EngagementReportSignalsClient.class);
            NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
            when(jdbc.getJdbcTemplate()).thenReturn(mock(JdbcTemplate.class));
            InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
            when(tz.getTimezoneId(INST)).thenReturn("Asia/Kolkata");
            when(dao.engines(INST)).thenReturn(List.of(new Engine(ENGINE, "Outreach", "ACTIVE", "u1")));
            when(dao.membersAdded(any())).thenReturn(MembersAdded.NONE);
            when(dao.previous(any())).thenReturn(new PreviousTotals(7, 2));
            service = new EngagementDailyReportService(dao, jdbc, mock(PlatformTransactionManager.class), tz,
                    mock(LeadReportSettingService.class), signals, mock(WhatsAppRateCardService.class));
        }

        private LocalDate ago(int n) {
            return today.minusDays(n);
        }

        /** An email sent at noon IST on the day. */
        private Send email(String id, LocalDate day) {
            LocalDateTime noonUtc = day.atTime(12, 0).atZone(IST).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
            return new Send(id, ENGINE, "SEND", "EMAIL", "SENT", null, "Hello", null, null, noonUtc);
        }

        private static Signal emailSignal(Long replyAt) {
            return new Signal("EMAIL", "a@b.com", 1L, "Hello", "DELIVERED", null, "SES", null, null, null,
                    null, null, null, null, true, false, false, false, false, true, replyAt);
        }

        private long evening(LocalDate day) {
            return day.atTime(18, 0).atZone(IST).toInstant().toEpochMilli();
        }

        @Test
        void aTenDayPeriodSumsItsDaysAndComparesWithTheTenBefore() {
            Window w = EngagementDailyReportService.window(ago(10), ago(1), today, IST);
            // The period's sends: two a day. One more on ago(11) (the previous period, in the reply
            // lookback, so in the first read) and three on ago(15) (the previous period's own read).
            List<Send> current = new ArrayList<>();
            for (int i = 1; i <= 10; i++) {
                current.add(email("p" + i + "a", ago(i)));
                current.add(email("p" + i + "b", ago(i)));
            }
            current.add(email("lookback", ago(11)));
            List<Send> before = List.of(email("old1", ago(15)), email("old2", ago(15)), email("old3", ago(15)));
            when(dao.sends(any(), eq(w.signalsFrom()), eq(w.to()))).thenReturn(current);
            when(dao.sends(any(), eq(w.sendsFrom()), eq(w.signalsFrom()))).thenReturn(before);
            // Replies: to a period send on its own day, to the lookback send inside the period, and
            // to a previous-period send in the previous period.
            Map<String, Signal> byId = new HashMap<>();
            current.forEach(s -> byId.put(s.id(), emailSignal(null)));
            before.forEach(s -> byId.put(s.id(), emailSignal(null)));
            byId.put("p1a", emailSignal(evening(ago(1))));
            byId.put("lookback", emailSignal(evening(ago(10))));
            byId.put("old1", emailSignal(evening(ago(15))));
            when(signals.fetch(eq(INST), anyList(), anyInt())).thenReturn(new Signals(false, byId));
            // Credits a day in the period, and 2.5 in the previous one; a status move and a demo in each.
            List<MessageCredit> credits = new ArrayList<>();
            for (int i = 1; i <= 10; i++) credits.add(new MessageCredit(ENGINE, "EMAIL", ago(i), 1.0));
            credits.add(new MessageCredit(ENGINE, "EMAIL", ago(12), 2.5));
            when(dao.messageCredits(any())).thenReturn(credits);
            when(dao.statusChanges(any())).thenReturn(List.of(
                    new StatusChangeRow(ago(10), "New", "Interested", 1, 0, 0),
                    new StatusChangeRow(ago(20), "New", "Interested", 0, 1, 0)));
            when(dao.bookings(any())).thenReturn(List.of(
                    new Booking(ENGINE, "b1", ago(5), true, "COMPLETED"),
                    new Booking(ENGINE, "b2", ago(14), false, null)));

            EngagementDailyReport r = service.daily(INST, null, null, ago(10).toString(), ago(1).toString(), false);

            assertEquals(ago(10).toString(), r.from());
            assertEquals(ago(1).toString(), r.to());
            assertEquals(ago(1).toString(), r.date());
            assertEquals(10, r.days());
            assertTrue(r.errors().isEmpty(), r.errors().toString());
            // Period totals
            assertEquals(20, r.summary().emailsSent());
            assertEquals(2, r.summary().replies());                // ago(1) and the lookback send's on ago(10)
            assertEquals(10.0, r.summary().creditsSpent());
            assertEquals(1, r.summary().statusChanges());
            assertEquals(1, r.summary().demosBooked());
            assertEquals(1, r.summary().demosDone());
            assertEquals(20, r.channels().get(0).sent());          // EMAIL row: the period's, not one day's
            assertEquals(1, r.channels().get(0).replied());        // cohort: replies to the period's sends
            // Trend: one entry per day of the period, oldest first, adding up to the period.
            List<TrendDay> trend = r.trend();
            assertEquals(10, trend.size());
            assertEquals(ago(10).toString(), trend.get(0).date());
            assertEquals(ago(1).toString(), trend.get(9).date());
            assertEquals(20, trend.stream().mapToLong(TrendDay::sent).sum());
            assertEquals(2, trend.stream().mapToLong(TrendDay::replies).sum());
            assertEquals(10.0, trend.stream().mapToDouble(TrendDay::credits).sum(), 1e-9);
            // Previous period ago(20)..ago(11)
            Previous prev = r.previous();
            assertEquals(ago(20).toString(), prev.from());
            assertEquals(ago(11).toString(), prev.to());
            assertEquals(7, prev.leadsAdded());
            assertEquals(4, prev.sent());
            assertEquals(1, prev.replies());
            assertEquals(1, prev.demosBooked());
            assertEquals(2, prev.conversions());
            assertEquals(2.5, prev.credits());
            assertEquals(1, prev.statusChanges());
            // Both reads' messages in one signals call, in send order (each chunk a short stretch).
            @SuppressWarnings("unchecked")
            ArgumentCaptor<List<String>> ids = ArgumentCaptor.forClass(List.class);
            verify(signals).fetch(eq(INST), ids.capture(), eq(EngagementDailyReportService.REPLY_WINDOW_HOURS));
            assertEquals(24, ids.getValue().size());
            assertEquals(List.of("old1", "old2", "old3", "lookback", "p10a", "p10b"), ids.getValue().subList(0, 6));
            assertEquals(List.of("p1a", "p1b"), ids.getValue().subList(22, 24));
        }

        @Test
        void noPeriodIsTodayWithTheSevenDayTrendAndYesterdayBefore() {
            EngagementDailyReport r = service.daily(INST, null, null, null, null, false);

            assertEquals(today.toString(), r.from());
            assertEquals(today.toString(), r.to());
            assertEquals(today.toString(), r.date());
            assertEquals(1, r.days());
            assertEquals(7, r.trend().size());
            assertEquals(ago(6).toString(), r.trend().get(0).date());
            assertEquals(ago(1).toString(), r.previous().from());
            assertEquals(ago(1).toString(), r.previous().to());
            assertEquals(0, r.previous().sent());
            assertEquals(0, r.previous().replies());
            // A single day reads its sends once: the previous day is inside the trend.
            verify(dao, times(1)).sends(any(), any(), any());
        }

        @Test
        void aShortPeriodReadsTheSevenDayTrendEndingTo() {
            EngagementDailyReport r = service.daily(INST, ENGINE, "ignored", ago(3).toString(), ago(1).toString(),
                    false);

            assertEquals(3, r.days());
            assertEquals(7, r.trend().size());
            assertEquals(ago(7).toString(), r.trend().get(0).date());
            assertEquals(ago(1).toString(), r.trend().get(6).date());
            assertEquals(ago(6).toString(), r.previous().from());
            assertEquals(ago(4).toString(), r.previous().to());
        }

        @Test
        void halfAPeriodIs400() {
            assertThrows(InvalidRequestException.class,
                    () -> service.daily(INST, null, null, ago(3).toString(), null, false));
            assertThrows(InvalidRequestException.class,
                    () -> service.daily(INST, null, null, ago(90).toString(), today.toString(), false));
            verify(dao, never()).engines(anyString());
        }

        @Test
        void tooManyMessagesSkipsDeliveryInsteadOfTimingOutAndIsCached() {
            List<Send> many = new ArrayList<>();
            for (int i = 0; i <= EngagementDailyReportService.MAX_SIGNAL_ACTIONS; i++) {
                many.add(email("m" + i, ago(1 + i % 20)));
            }
            Window w = EngagementDailyReportService.window(ago(29), today, today, IST);
            when(dao.sends(any(), eq(w.signalsFrom()), eq(w.to()))).thenReturn(many);
            String from = ago(29).toString(), to = today.toString();

            EngagementDailyReport r = service.daily(INST, null, null, from, to, false);
            EngagementDailyReport again = service.daily(INST, null, null, from, to, false);

            assertEquals(EngagementDailyReportService.TOO_MANY, r.errors().get("delivery"));
            assertEquals(EngagementDailyReportService.TOO_MANY, r.errors().get("replies"));
            assertEquals(EngagementDailyReportService.MAX_SIGNAL_ACTIONS + 1, r.summary().emailsSent());
            assertNull(r.previous().replies());                   // unknown, not 0
            assertEquals(0, r.previous().sent());
            verify(signals, never()).fetch(anyString(), anyList(), anyInt());
            assertEquals(r, again);
            verify(dao, times(1)).engines(INST);                  // the second call came from the cache
        }

        @Test
        void thePreviousPeriodsDeliveryIsSkippedWhenItWouldPassTheCap() {
            Window w = EngagementDailyReportService.window(ago(9), today, today, IST);
            List<Send> current = new ArrayList<>(), before = new ArrayList<>();
            for (int i = 0; i < 15_000; i++) current.add(email("c" + i, ago(i % 10)));
            for (int i = 0; i < 6_000; i++) before.add(email("b" + i, ago(15)));
            when(dao.sends(any(), eq(w.signalsFrom()), eq(w.to()))).thenReturn(current);
            when(dao.sends(any(), eq(w.sendsFrom()), eq(w.signalsFrom()))).thenReturn(before);
            when(signals.fetch(eq(INST), anyList(), anyInt())).thenReturn(new Signals(false, Map.of()));

            EngagementDailyReport r = service.daily(INST, null, null, ago(9).toString(), today.toString(), false);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<List<String>> ids = ArgumentCaptor.forClass(List.class);
            verify(signals).fetch(eq(INST), ids.capture(), anyInt());
            assertEquals(15_000, ids.getValue().size());          // the period's only
            assertTrue(r.errors().isEmpty());
            assertEquals(6_000, r.previous().sent());
            assertNull(r.previous().replies());
        }

        @Test
        void aFailedPreviousReadNullsOnlyTheDeltasItFeeds() {
            when(dao.previous(any())).thenThrow(new IllegalStateException("canceling statement due to timeout"));

            EngagementDailyReport r = service.daily(INST, null, null, ago(13).toString(), today.toString(), false);

            assertEquals("unavailable", r.errors().get(EngagementDailyReportService.PREVIOUS));
            assertNull(r.previous().leadsAdded());
            assertNull(r.previous().conversions());
            assertNull(r.previous().sent());                      // its sends are in the failed read
            assertEquals(0, r.previous().statusChanges());
            assertEquals(14, r.trend().size());
        }
    }

    @Test
    void onlyTooManyIsCacheable() {
        assertTrue(EngagementDailyReportService.cacheable(Map.of()));
        assertTrue(EngagementDailyReportService.cacheable(Map.of("delivery", "too_many", "replies", "too_many")));
        assertFalse(EngagementDailyReportService.cacheable(Map.of("delivery", "too_many", "calls", "unavailable")));
    }

    @Test
    void signalIdsAreTheSentMessagesInSendOrder() {
        LocalDateTime t = LocalDateTime.of(2026, 10, 28, 6, 0);
        List<Send> sends = List.of(
                new Send("late", "e", "SEND", "WHATSAPP", "SENT", "tpl", null, null, null, t.plusHours(2)),
                new Send("failed", "e", "SEND", "EMAIL", "FAILED", null, "s", null, null, t),
                new Send("inapp", "e", "SEND", "IN_APP", "SENT", null, null, null, null, t),
                new Send("early", "e", "TASK", "EMAIL", "SENT", null, "s", null, null, t.minusHours(1)));

        assertEquals(List.of("early", "late"), EngagementDailyReportService.signalIds(sends));
    }
}
