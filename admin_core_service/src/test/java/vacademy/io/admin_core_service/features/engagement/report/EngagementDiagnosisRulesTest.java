package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.TemplateRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportDao.AgentDay;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReportService.Window;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.BreakdownRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallHourRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallInsights;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.CallLengths;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.DataGap;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.EmailSubjectRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.LeadSourceRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.ObjectionCount;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.Problem;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.PromptChangeRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.StageStatus;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppFailureRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.WhatsAppTemplateRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.ActionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.AgentRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.BookingRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.CallRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.LeadRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.PromptVersionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.AgentFact;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallDetails;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.CallFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.ContactCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.DoubleContact;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EmailSubjects;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.EngineFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.Facts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.LeadFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.Outcome;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.RunCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.WhatsAppCounts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.WhatsAppFacts;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.DAILY;
import static vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisRules.WEEKLY;

/** Every diagnosis rule just under and just at its threshold, the ranking, the stages and the verdicts. */
class EngagementDiagnosisRulesTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 4);
    private static final Window DAY = EngagementDailyReportService.window(TODAY, TODAY, TODAY, IST);
    /** After every lead agent's window on TODAY has closed. */
    private static final Instant LATE = TODAY.plusDays(1).atStartOfDay(IST).toInstant();
    private static final Window WEEK = EngagementDailyReportService.window(TODAY.minusDays(6), TODAY, TODAY, IST);

    // ── fact builders: all quiet unless a test says otherwise ──

    private static final CallDetails NO_CALL_DETAILS = new CallDetails(new CallLengths(0, 0, 0, 0), List.of(),
            new CallInsights(0, Map.of(), List.of(), 0, List.of()));

    private static LeadFacts quietLeads() {
        return new LeadFacts(new ContactCounts(0, 0, 0, 0), List.of(), List.of());
    }

    private static CallFacts quietCalls() {
        return new CallFacts(new CallCounts(0, 0, 0, 0), null, NO_CALL_DETAILS);
    }

    private static WhatsAppFacts quietWhatsApp() {
        return new WhatsAppFacts(new WhatsAppCounts(0, 0, List.of()), List.of(), null);
    }

    private static EmailFacts quietEmail() {
        return new EmailFacts(new EmailCounts(0, 0, 0, 0, true), List.of(), null);
    }

    private static EngineFacts quietEngine() {
        return new EngineFacts(new RunCounts(0, 0, List.of()), new DoubleContact(0, 0), 0L, null, 0L);
    }

    private static Facts facts(LeadFacts l) {
        return new Facts(l, quietCalls(), quietWhatsApp(), quietEmail(), quietEngine());
    }

    private static Facts facts(CallFacts c) {
        return new Facts(quietLeads(), c, quietWhatsApp(), quietEmail(), quietEngine());
    }

    private static Facts facts(WhatsAppFacts w) {
        return new Facts(quietLeads(), quietCalls(), w, quietEmail(), quietEngine());
    }

    private static Facts facts(EmailFacts e) {
        return new Facts(quietLeads(), quietCalls(), quietWhatsApp(), e, quietEngine());
    }

    private static Facts facts(EngineFacts e) {
        return new Facts(quietLeads(), quietCalls(), quietWhatsApp(), quietEmail(), e);
    }

    private static Outcome eval(String view, Facts f) {
        return EngagementDiagnosisRules.evaluate(view, f, Set.of());
    }

    /** The one problem with this code, or null; fails on two. */
    private static Problem only(String code, String view, Facts f) {
        List<Problem> found = eval(view, f).problems().stream().filter(p -> code.equals(p.code())).toList();
        assertTrue(found.size() <= 1, found.toString());
        return found.isEmpty() ? null : found.get(0);
    }

    private static String status(Outcome o, String stage) {
        return o.stages().stream().filter(s -> stage.equals(s.stage())).findFirst().orElseThrow().status();
    }

    // ── rows ──

    private static LocalDateTime utc(LocalDate day, int hour) {
        return day.atTime(hour, 0).atZone(IST).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    private static long epoch(LocalDate day, int hour) {
        return day.atTime(hour, 0).atZone(IST).toInstant().toEpochMilli();
    }

    private static ActionRow action(String id, String kind, String channel, String status, LocalDate day, int hour,
                                    String user) {
        return new ActionRow(id, "e1", kind, channel, status, null, null, null, null, null, utc(day, hour), user, null);
    }

    private static ActionRow send(String id, String channel, LocalDate day, int hour, String user) {
        return action(id, "SEND", channel, "SENT", day, hour, user);
    }

    private static Signal replied(Long replyAt) {
        return new Signal("WHATSAPP", "919876500001", 1L, null, "READ", null, "META", "tpl", "en", "UTILITY",
                null, null, null, null, false, false, false, false, false, false, replyAt);
    }

    private static Signal failedOnMeta(String code) {
        return new Signal("WHATSAPP", "919876500001", 1L, null, "FAILED", code, "META", "tpl", "en", "UTILITY",
                null, null, null, null, false, false, false, false, false, false, null);
    }

    private static Signal email(String subject, String sender, boolean tracked, boolean clicked) {
        return new Signal("EMAIL", "a@b.com", 1L, subject, null, null, null, null, null, null,
                null, null, null, null, tracked, false, clicked, false, false, tracked, null, sender);
    }

    // ── LEADS ──

    @Nested
    class Leads {

        private Facts contacts(long added, long noPhone, long noEmail, long neither) {
            return facts(new LeadFacts(new ContactCounts(added, noPhone, noEmail, neither), List.of(), List.of()));
        }

        @Test
        void missingContactNeedsTenLeads() {
            assertNull(only("LEADS_MISSING_CONTACT", DAILY, contacts(9, 9, 9, 9)));
            assertNotNull(only("LEADS_MISSING_CONTACT", DAILY, contacts(10, 10, 10, 10)));
        }

        @Test
        void neitherIsCriticalFromTenPercent() {
            assertNull(only("LEADS_MISSING_CONTACT", DAILY, contacts(11, 1, 1, 1)));   // 9.09%
            Problem p = only("LEADS_MISSING_CONTACT", DAILY, contacts(10, 2, 2, 1));
            assertEquals("critical", p.severity());
            assertEquals(1, p.affected());
            assertEquals(Map.of("added", 10L, "noPhone", 2L, "noEmail", 2L, "neither", 1L), p.numbers());
            assertEquals("ITEMS", p.link().target());
            assertEquals("LEADS_ADDED", p.link().kind());
        }

        @Test
        void noPhoneIsAWarningFromThirtyPercent() {
            assertNull(only("LEADS_MISSING_CONTACT", DAILY, contacts(100, 29, 0, 0)));
            Problem p = only("LEADS_MISSING_CONTACT", DAILY, contacts(100, 30, 0, 0));
            assertEquals("warning", p.severity());
            assertEquals(30, p.affected());
        }

        @Test
        void agentsNotDeliveringAreOneProblemNamingThem() {
            List<AgentFact> agents = List.of(
                    new AgentFact("Zed", "ACTIVE", 5, 3, 2, 0),
                    new AgentFact("Asha", "ACTIVE", 1, 1, 0, 0),
                    new AgentFact("Delivers", "ACTIVE", 9, 0, 0, 1),
                    new AgentFact("Paused", "PAUSED", 0, 0, 0, 0));
            Problem p = only("LEAD_AGENT_NOT_DELIVERING", DAILY,
                    facts(new LeadFacts(new ContactCounts(0, 0, 0, 0), agents, List.of())));

            assertEquals("warning", p.severity());
            assertEquals(2, p.affected());
            assertEquals(List.of("Asha", "Zed"), p.names());
            assertEquals(Map.of("discovered", 6L, "rejected", 4L, "review", 2L), p.numbers());
            assertNull(p.link());
        }

        private LeadSourceRow source(String name, long leads, long responded) {
            return new LeadSourceRow(name, leads, leads, responded, 0L, 1.0, EngagementDiagnosisRules.rate(responded, leads),
                    leads >= EngagementDiagnosisRules.MIN_LEADS_PER_SOURCE);
        }

        private Facts sources(LeadSourceRow... rows) {
            return facts(new LeadFacts(new ContactCounts(0, 0, 0, 0), List.of(), List.of(rows)));
        }

        @Test
        void aSourceIsWeakBelowHalfTheOverallRate() {
            // Overall 20%: 10% is exactly half, not below it.
            assertNull(only("LEAD_SOURCE_WEAK", WEEKLY, sources(source("maps", 100, 10), source("hiring", 100, 30))));
            // Overall 19.5%: 9% is below half of it.
            Problem p = only("LEAD_SOURCE_WEAK", WEEKLY, sources(source("maps", 100, 9), source("hiring", 100, 30)));
            assertEquals(100, p.affected());
            assertEquals(List.of("maps"), p.names());
            assertEquals(0.09, p.numbers().get("responseRate"));
            assertEquals(0.195, p.numbers().get("overallRate"));
        }

        @Test
        void aSourceNeedsEnoughLeadsAndTheWeeklyView() {
            assertNull(only("LEAD_SOURCE_WEAK", WEEKLY, sources(source("maps", 29, 0), source("hiring", 100, 30))));
            assertNotNull(only("LEAD_SOURCE_WEAK", WEEKLY, sources(source("maps", 30, 0), source("hiring", 100, 30))));
            assertNull(only("LEAD_SOURCE_WEAK", DAILY, sources(source("maps", 30, 0), source("hiring", 100, 30))));
        }

        @Test
        void unknownRepliesJudgeNoSource() {
            LeadSourceRow unknown = new LeadSourceRow("maps", 100, 100L, null, 0L, 1.0, null, true);
            assertNull(only("LEAD_SOURCE_WEAK", WEEKLY, sources(unknown, source("hiring", 100, 30))));
        }
    }

    // ── CALLING ──

    @Nested
    class Calling {

        private Facts calls(CallCounts counts, CallCounts baseline) {
            return facts(new CallFacts(counts, baseline, NO_CALL_DETAILS));
        }

        private Facts details(CallLengths lengths, List<CallHourRow> hours, CallInsights insights) {
            return facts(new CallFacts(new CallCounts(0, 0, 0, 0), null, new CallDetails(lengths, hours, insights)));
        }

        @Test
        void notDialledNeedsFive() {
            assertNull(only("CALLS_NOT_GOING_OUT", DAILY, calls(new CallCounts(4, 4, 0, 0), null)));
        }

        @Test
        void notDialledIsOverEveryRowQueued() {
            // The report's placed counts the not-dialled rows too: 26 queued, 5 given up = 19.2%.
            assertNull(only("CALLS_NOT_GOING_OUT", DAILY, calls(new CallCounts(26, 5, 0, 0), null)));
            Problem p = only("CALLS_NOT_GOING_OUT", DAILY, calls(new CallCounts(25, 5, 0, 0), null));
            assertEquals("warning", p.severity());
            assertEquals(5, p.affected());
            assertEquals(Map.of("placed", 20L, "notDialled", 5L), p.numbers());
            assertNull(p.link());
        }

        @Test
        void nothingDialledIsCritical() {
            Problem p = only("CALLS_NOT_GOING_OUT", DAILY, calls(new CallCounts(5, 5, 0, 0), null));
            assertEquals("critical", p.severity());
            assertEquals(0L, p.numbers().get("placed"));
        }

        @Test
        void connectRateNeedsTwentyCallsAndAFiftyCallBaseline() {
            CallCounts low = new CallCounts(20, 0, 0, 1);
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(new CallCounts(19, 0, 0, 0), new CallCounts(50, 0, 0, 25))));
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(low, new CallCounts(49, 0, 0, 25))));
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(low, null)));
            assertNotNull(only("CONNECT_RATE_LOW", DAILY, calls(low, new CallCounts(50, 0, 0, 25))));
        }

        @Test
        void connectRateIsLowBelowHalfTheBaseline() {
            CallCounts base = new CallCounts(50, 0, 0, 25);    // 50%
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(new CallCounts(20, 0, 0, 5), base)));    // 25%: exactly half
            Problem p = only("CONNECT_RATE_LOW", DAILY, calls(new CallCounts(20, 0, 0, 4), base));    // 20%
            assertEquals("warning", p.severity());
            assertEquals(16, p.affected());
            assertEquals(0.2, p.numbers().get("rate"));
            assertEquals(0.5, p.numbers().get("baselineRate"));
            assertEquals("OUTCOMES", p.link().target());
            assertEquals("AI_CALL", p.link().channel());
            assertEquals("no_answer", p.link().outcome());
        }

        @Test
        void callsStillInProgressAreNotMissedConnections() {
            CallCounts base = new CallCounts(50, 0, 0, 25);
            // 60 queued, 40 waiting for a slot: 5 of the 20 finished connected (25%), not 5 of 60.
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(new CallCounts(60, 0, 40, 5), base)));
            // Not dialled rows are CALLS_NOT_GOING_OUT's, not this rule's.
            assertNull(only("CONNECT_RATE_LOW", DAILY, calls(new CallCounts(60, 40, 0, 5), base)));
        }

        @Test
        void shortCallsFromFortyPercentOfTwentyConnected() {
            assertNull(only("SHORT_CALLS", DAILY, details(new CallLengths(19, 19, 0, 0), List.of(), NO_CALL_DETAILS.insights())));
            assertNull(only("SHORT_CALLS", DAILY, details(new CallLengths(20, 7, 13, 0), List.of(), NO_CALL_DETAILS.insights())));
            Problem p = only("SHORT_CALLS", DAILY, details(new CallLengths(20, 8, 12, 0), List.of(), NO_CALL_DETAILS.insights()));
            assertEquals(8, p.affected());
            assertEquals(0.4, p.numbers().get("share"));
            assertEquals("connected", p.link().outcome());
        }

        private CallHourRow hour(int h, long placed, long connected) {
            return new CallHourRow(h, placed, connected, EngagementDiagnosisRules.rate(connected, placed),
                    placed >= EngagementDiagnosisRules.MIN_CALLS_PER_HOUR);
        }

        @Test
        void anHourIsWeakBelowHalfTheOverallRate() {
            // Overall 50%: 25% is exactly half.
            assertNull(only("CALL_HOUR_WEAK", WEEKLY,
                    details(new CallLengths(0, 0, 0, 0), List.of(hour(10, 20, 5), hour(14, 20, 15)), NO_CALL_DETAILS.insights())));
            Problem p = only("CALL_HOUR_WEAK", WEEKLY,
                    details(new CallLengths(0, 0, 0, 0), List.of(hour(10, 20, 4), hour(14, 20, 16)), NO_CALL_DETAILS.insights()));
            assertEquals(20, p.affected());
            assertEquals(10, p.numbers().get("hour"));
            assertEquals(0.2, p.numbers().get("connectRate"));
            assertEquals(0.5, p.numbers().get("overallRate"));
            assertEquals(14, p.numbers().get("bestHour"));
            assertEquals(0.8, p.numbers().get("bestRate"));
        }

        @Test
        void anHourNeedsEnoughCallsAndTheWeeklyView() {
            Facts fewCalls = details(new CallLengths(0, 0, 0, 0), List.of(hour(10, 19, 0), hour(14, 40, 40)), NO_CALL_DETAILS.insights());
            assertNull(only("CALL_HOUR_WEAK", WEEKLY, fewCalls));
            Facts enough = details(new CallLengths(0, 0, 0, 0), List.of(hour(10, 20, 0), hour(14, 40, 40)), NO_CALL_DETAILS.insights());
            assertNotNull(only("CALL_HOUR_WEAK", WEEKLY, enough));
            assertNull(only("CALL_HOUR_WEAK", DAILY, enough));
        }

        private CallInsights insights(long analysed, long topCount) {
            return new CallInsights(analysed, Map.of(), List.of(), 0, List.of(new ObjectionCount("too costly", topCount)));
        }

        @Test
        void anObjectionRecursFromTwentyPercentOfTenAnalysed() {
            CallLengths none = new CallLengths(0, 0, 0, 0);
            assertNull(only("OBJECTION_RECURRING", WEEKLY, details(none, List.of(), insights(9, 9))));
            assertNull(only("OBJECTION_RECURRING", WEEKLY, details(none, List.of(), insights(10, 1))));
            Problem p = only("OBJECTION_RECURRING", WEEKLY, details(none, List.of(), insights(10, 2)));
            assertEquals(2, p.affected());
            assertEquals(List.of("too costly"), p.names());
            assertEquals(Map.of("analysed", 10L, "count", 2L), p.numbers());
            assertNull(only("OBJECTION_RECURRING", DAILY, details(none, List.of(), insights(10, 2))));
        }
    }

    // ── WHATSAPP ──

    @Nested
    class WhatsApp {

        private Facts counts(long tried, long failed) {
            return facts(new WhatsAppFacts(new WhatsAppCounts(tried, failed,
                    List.of(new BreakdownRow("NOT_ON_WHATSAPP", failed))), List.of(), null));
        }

        @Test
        void failedNeedsTwentyTried() {
            assertNull(only("WHATSAPP_FAILED_HIGH", DAILY, counts(19, 19)));
            assertNotNull(only("WHATSAPP_FAILED_HIGH", DAILY, counts(20, 19)));
        }

        @Test
        void failedIsAWarningFromTenPercentAndCriticalFromThirty() {
            assertNull(only("WHATSAPP_FAILED_HIGH", DAILY, counts(100, 9)));
            assertEquals("warning", only("WHATSAPP_FAILED_HIGH", DAILY, counts(100, 10)).severity());
            assertEquals("warning", only("WHATSAPP_FAILED_HIGH", DAILY, counts(100, 29)).severity());
            Problem p = only("WHATSAPP_FAILED_HIGH", DAILY, counts(100, 30));
            assertEquals("critical", p.severity());
            assertEquals(30, p.affected());
            assertEquals(Map.of("failed", 30L, "tried", 100L, "rate", 0.3), p.numbers());
            assertEquals(List.of(new BreakdownRow("NOT_ON_WHATSAPP", 30)), p.breakdown());
            assertEquals("WHATSAPP", p.link().channel());
            assertEquals("failed", p.link().outcome());
        }

        @Test
        void theRateNeverPassesOneHundredPercent() {
            assertEquals(1.0, EngagementDiagnosisRules.whatsappFailRate(25, 20));
            assertNull(EngagementDiagnosisRules.whatsappFailRate(0, 0));
        }

        @Test
        void everyMetaCodeHasItsReason() {
            assertEquals("NOT_ON_WHATSAPP", EngagementDiagnosisRules.whatsappFailureReason("131026"));
            assertEquals("MARKETING_LIMIT", EngagementDiagnosisRules.whatsappFailureReason("131049"));
            assertEquals("USER_STOPPED_MARKETING", EngagementDiagnosisRules.whatsappFailureReason("131050"));
            assertEquals("OUTSIDE_24H_WINDOW", EngagementDiagnosisRules.whatsappFailureReason("131047"));
            assertEquals("TEMPLATE_PROBLEM", EngagementDiagnosisRules.whatsappFailureReason("132000"));
            assertEquals("TEMPLATE_PROBLEM", EngagementDiagnosisRules.whatsappFailureReason("132999"));
            assertEquals("OTHER", EngagementDiagnosisRules.whatsappFailureReason("133000"));
            assertEquals("OTHER", EngagementDiagnosisRules.whatsappFailureReason("131999"));
            assertEquals("PAYMENT_ISSUE", EngagementDiagnosisRules.whatsappFailureReason("131042"));
            assertEquals("RATE_LIMITED", EngagementDiagnosisRules.whatsappFailureReason("130429"));
            assertEquals("RATE_LIMITED", EngagementDiagnosisRules.whatsappFailureReason("131048"));
            assertEquals("RATE_LIMITED", EngagementDiagnosisRules.whatsappFailureReason(" 131056 "));
            assertEquals("REJECTED_AT_SEND", EngagementDiagnosisRules.whatsappFailureReason(null));
            assertEquals("REJECTED_AT_SEND", EngagementDiagnosisRules.whatsappFailureReason(" "));
            assertEquals("OTHER", EngagementDiagnosisRules.whatsappFailureReason("not-a-code"));
        }

        @Test
        void failureRowsKeepTheRawCodeAndGroupByReason() {
            List<ActionRow> actions = List.of(
                    action("rejected", "SEND", "WHATSAPP", "FAILED", TODAY, 10, "u1"),
                    action("rejected2", "TASK", "WHATSAPP", "FAILED", TODAY, 10, "u2"),
                    send("meta1", "WHATSAPP", TODAY, 10, "u3"),
                    send("meta2", "WHATSAPP", TODAY, 11, "u4"),
                    send("meta3", "WHATSAPP", TODAY, 11, "u5"),
                    send("fine", "WHATSAPP", TODAY, 11, "u6"),
                    action("oldRejected", "SEND", "WHATSAPP", "FAILED", TODAY.minusDays(3), 10, "u7"),
                    action("anEmail", "SEND", "EMAIL", "FAILED", TODAY, 10, "u8"));
            Map<String, Signal> signals = Map.of(
                    "meta1", failedOnMeta("131026"),
                    "meta2", failedOnMeta("131026"),
                    "meta3", failedOnMeta("132001"),
                    "fine", replied(null));

            List<WhatsAppFailureRow> rows = EngagementDiagnosisRules.whatsappFailures(actions, signals, DAY);

            assertEquals(List.of(
                    new WhatsAppFailureRow("NOT_ON_WHATSAPP", "131026", 2),
                    new WhatsAppFailureRow("REJECTED_AT_SEND", null, 2),
                    new WhatsAppFailureRow("TEMPLATE_PROBLEM", "132001", 1)), rows);
            assertEquals(2, EngagementDiagnosisRules.whatsappRejected(actions, DAY));
            assertEquals(new BreakdownRow("NOT_ON_WHATSAPP", 2), EngagementDiagnosisRules.failureReasons(rows).get(0));
        }

        private WhatsAppTemplateRow template(String name, long sent, double rate) {
            return EngagementDiagnosisRules.whatsappTemplates(List.of(
                    new TemplateRow("WHATSAPP", name, sent, 0, 0, Math.round(sent * rate), rate, 0, 0, "INR"),
                    new TemplateRow("WHATSAPP", "other_row", sent, 0, 0, sent, 1.0, 0, 0, "INR"))).stream()
                    .filter(t -> name.equals(t.name())).findFirst().orElseThrow();
        }

        @Test
        void aTemplateUnderperformsBelowHalfTheChannelRate() {
            Facts at = facts(new WhatsAppFacts(new WhatsAppCounts(0, 0, List.of()), List.of(template("intro", 100, 0.05)), 0.1));
            assertNull(only("TEMPLATE_UNDERPERFORMING", WEEKLY, at));
            Facts below = facts(new WhatsAppFacts(new WhatsAppCounts(0, 0, List.of()), List.of(template("intro", 100, 0.04)), 0.1));
            Problem p = only("TEMPLATE_UNDERPERFORMING", WEEKLY, below);
            assertEquals(100, p.affected());
            assertEquals(List.of("intro"), p.names());
            assertEquals(Map.of("sent", 100L, "replyRate", 0.04, "channelRate", 0.1), p.numbers());
            assertEquals("WHATSAPP", p.link().channel());
            assertNull(p.link().outcome());
            assertNull(only("TEMPLATE_UNDERPERFORMING", DAILY, below));
        }

        @Test
        void aTemplateNeedsEnoughSendsAndAFreeFormRowIsNoTemplate() {
            Facts few = facts(new WhatsAppFacts(new WhatsAppCounts(0, 0, List.of()), List.of(template("intro", 99, 0.0)), 0.5));
            assertNull(only("TEMPLATE_UNDERPERFORMING", WEEKLY, few));
            Facts freeForm = facts(new WhatsAppFacts(new WhatsAppCounts(0, 0, List.of()),
                    List.of(template(EngagementDiagnosisRules.NO_TEMPLATE, 500, 0.0)), 0.5));
            assertNull(only("TEMPLATE_UNDERPERFORMING", WEEKLY, freeForm));
        }
    }

    // ── EMAIL ──

    @Nested
    class Email {

        private Facts counts(long sent, long bounced, long complained, boolean tracked) {
            return facts(new EmailFacts(new EmailCounts(sent, bounced, complained,
                    sent == 0 ? 0 : EngagementDiagnosisRules.rate(bounced, sent), tracked), List.of(), null));
        }

        @Test
        void bouncesNeedTwentySentAndTracking() {
            assertNull(only("EMAIL_BOUNCE_HIGH", DAILY, counts(19, 19, 0, true)));
            assertNotNull(only("EMAIL_BOUNCE_HIGH", DAILY, counts(20, 19, 0, true)));
            assertNull(only("EMAIL_BOUNCE_HIGH", DAILY, counts(20, 19, 0, false)));
        }

        @Test
        void bouncesAreAWarningFromFivePercentAndCriticalFromTen() {
            assertNull(only("EMAIL_BOUNCE_HIGH", DAILY, counts(100, 4, 0, true)));
            assertEquals("warning", only("EMAIL_BOUNCE_HIGH", DAILY, counts(100, 5, 0, true)).severity());
            assertEquals("warning", only("EMAIL_BOUNCE_HIGH", DAILY, counts(100, 9, 0, true)).severity());
            Problem p = only("EMAIL_BOUNCE_HIGH", DAILY, counts(100, 10, 0, true));
            assertEquals("critical", p.severity());
            assertEquals(10, p.affected());
            assertEquals(Map.of("bounced", 10L, "sent", 100L, "rate", 0.1), p.numbers());
            assertEquals("bounced", p.link().outcome());
        }

        @Test
        void anyComplaintCountsAndIsCriticalFromATenthOfAPercent() {
            assertNull(only("EMAIL_COMPLAINTS", DAILY, counts(2000, 0, 0, true)));
            assertEquals("warning", only("EMAIL_COMPLAINTS", DAILY, counts(2000, 0, 1, true)).severity());
            Problem p = only("EMAIL_COMPLAINTS", DAILY, counts(2000, 0, 2, true));
            assertEquals("critical", p.severity());
            assertEquals(2, p.affected());
            assertEquals(Map.of("complained", 2L, "sent", 2000L), p.numbers());
            assertEquals("complained", p.link().outcome());
        }

        private EmailSubjectRow subject(String name, long sent, Double replyRate, String verdict) {
            return new EmailSubjectRow(name, sent, sent, 0, 0, 0L, 0.0, replyRate, verdict);
        }

        private Facts subjects(EmailSubjectRow row, Double channelRate) {
            return facts(new EmailFacts(new EmailCounts(0, 0, 0, 0, true), List.of(row), channelRate));
        }

        @Test
        void aSubjectUnderperformsBelowHalfTheChannelRate() {
            assertNull(only("SUBJECT_UNDERPERFORMING", WEEKLY, subjects(subject("Hi", 100, 0.05, "OK"), 0.1)));
            Problem p = only("SUBJECT_UNDERPERFORMING", WEEKLY, subjects(subject("Hi", 100, 0.04, "OK"), 0.1));
            assertEquals(100, p.affected());
            assertEquals(List.of("Hi"), p.names());
            assertEquals(Map.of("sent", 100L, "replyRate", 0.04, "channelRate", 0.1), p.numbers());
            assertEquals("EMAIL", p.link().channel());
            assertNull(only("SUBJECT_UNDERPERFORMING", DAILY, subjects(subject("Hi", 100, 0.04, "OK"), 0.1)));
        }

        @Test
        void aSubjectWhoseSenderCannotBeHeardIsNotJudged() {
            assertNull(only("SUBJECT_UNDERPERFORMING", WEEKLY, subjects(subject("Hi", 100, null, "NOT_ENOUGH_DATA"), 0.1)));
            assertNull(only("SUBJECT_UNDERPERFORMING", WEEKLY, subjects(subject("Hi", 99, 0.0, "NOT_ENOUGH_DATA"), 0.1)));
        }

        @Test
        void theRowsCountRepliesOnlyWhereTheSenderCanBeHeard() {
            ActionRow heard1 = new ActionRow("h1", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), "u1", null);
            ActionRow heard2 = new ActionRow("h2", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), "u2", null);
            ActionRow deaf = new ActionRow("d1", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), "u3", null);
            ActionRow deafOnly = new ActionRow("d2", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), "u4", null);
            ActionRow onTemplate = new ActionRow("t1", "e1", "SEND", "EMAIL", "SENT", null, null, "ignored", "tpl1", "Welcome", utc(TODAY, 9), "u5", null);
            ActionRow failed = new ActionRow("f1", "e1", "SEND", "EMAIL", "FAILED", null, null, "Hi", null, null, utc(TODAY, 9), "u6", null);
            Map<String, Signal> signals = Map.of(
                    "h1", email("Hi", "a@ses.example", true, true),
                    "h2", email("Hi", "a@ses.example", true, false),
                    "d1", email("Hi", "b@gmail.example", true, false),
                    "d2", email("Other", "b@gmail.example", false, false),
                    "t1", email("Subject of the template", "a@ses.example", true, false));

            EmailSubjects out = EngagementDiagnosisRules.emailSubjects(List.of(heard1, heard2, deaf, deafOnly, onTemplate, failed),
                    signals, Map.of("h1", 5L), true, Set.of("b@gmail.example"), DAY);

            Map<String, EmailSubjectRow> byName = out.rows().stream().collect(Collectors.toMap(EmailSubjectRow::name, r -> r));
            EmailSubjectRow hi = byName.get("Hi");
            assertEquals(3, hi.sent());                  // the unheard send still went out
            assertEquals(1L, hi.replied());
            assertEquals(0.5, hi.replyRate());           // 1 of the 2 that could report a reply
            assertEquals(1, hi.clicked());
            assertEquals(0.3333, hi.clickRate());
            assertEquals("NOT_ENOUGH_DATA", hi.verdict());
            EmailSubjectRow other = byName.get("Other");
            assertNull(other.replied());
            assertNull(other.replyRate());
            assertNull(other.clickRate());               // not one send was tracked
            assertEquals(1, byName.get("Welcome").sent());
            assertEquals(0.3333, out.channelRate());     // 1 reply over the 3 heard sends
            assertEquals(3, out.rows().size());
        }

        @Test
        void withInboundEmailOffNoRowHasAReplyNumber() {
            EmailSubjects out = EngagementDiagnosisRules.emailSubjects(
                    List.of(new ActionRow("h1", "e1", "SEND", "EMAIL", "SENT", null, null, "Hi", null, null, utc(TODAY, 9), "u1", null)),
                    Map.of(), Map.of(), false, Set.of(), DAY);

            assertNull(out.rows().get(0).replied());
            assertNull(out.rows().get(0).replyRate());
            assertNull(out.channelRate());
        }
    }

    // ── ENGINE ──

    @Nested
    class Engine {

        private Facts runs(long decisions, long failed) {
            return facts(new EngineFacts(new RunCounts(decisions, failed, List.of(new BreakdownRow("boom", failed))),
                    new DoubleContact(0, 0), 0L, null, 0L));
        }

        private Facts doubleContact(long people, long contacted) {
            return facts(new EngineFacts(new RunCounts(0, 0, List.of()), new DoubleContact(people, contacted), 0L, null, 0L));
        }

        private Facts afterReply(long sends) {
            return facts(new EngineFacts(new RunCounts(0, 0, List.of()), new DoubleContact(0, 0), sends, null, 0L));
        }

        private Facts runway(Double days) {
            return facts(new EngineFacts(new RunCounts(0, 0, List.of()), new DoubleContact(0, 0), 0L, days, 0L));
        }

        private Facts stuck(long members) {
            return facts(new EngineFacts(new RunCounts(0, 0, List.of()), new DoubleContact(0, 0), 0L, null, members));
        }

        @Test
        void failingActionsNeedTenDecisions() {
            assertNull(only("ENGINE_ACTIONS_FAILING", DAILY, runs(9, 9)));
            assertNotNull(only("ENGINE_ACTIONS_FAILING", DAILY, runs(10, 9)));
        }

        @Test
        void failingActionsAreAWarningFromTwentyPercentAndCriticalFromFifty() {
            assertNull(only("ENGINE_ACTIONS_FAILING", DAILY, runs(100, 19)));
            assertEquals("warning", only("ENGINE_ACTIONS_FAILING", DAILY, runs(100, 20)).severity());
            assertEquals("warning", only("ENGINE_ACTIONS_FAILING", DAILY, runs(100, 49)).severity());
            Problem p = only("ENGINE_ACTIONS_FAILING", DAILY, runs(100, 50));
            assertEquals("critical", p.severity());
            assertEquals(50, p.affected());
            assertEquals(Map.of("failed", 50L, "decisions", 100L, "rate", 0.5), p.numbers());
            assertEquals(List.of(new BreakdownRow("boom", 50)), p.breakdown());
        }

        @Test
        void doubleContactFromThreePeopleOrFivePercent() {
            assertNull(only("DOUBLE_CONTACT", DAILY, doubleContact(0, 0)));
            assertNull(only("DOUBLE_CONTACT", DAILY, doubleContact(2, 100)));
            assertNotNull(only("DOUBLE_CONTACT", DAILY, doubleContact(3, 1000)));
            assertNull(only("DOUBLE_CONTACT", DAILY, doubleContact(1, 21)));          // 4.76%
            Problem p = only("DOUBLE_CONTACT", DAILY, doubleContact(1, 20));          // 5%
            assertEquals("warning", p.severity());
            assertEquals(Map.of("people", 1L, "contacted", 20L), p.numbers());
        }

        @Test
        void doubleContactCountsPeopleNotAttempts() {
            List<ActionRow> actions = List.of(
                    send("a1", "EMAIL", TODAY, 9, "u1"), send("a2", "EMAIL", TODAY, 15, "u1"), send("a3", "EMAIL", TODAY, 18, "u1"),
                    send("b1", "EMAIL", TODAY, 9, "u2"), send("b2", "WHATSAPP", TODAY, 15, "u2"),      // two channels
                    action("c1", "TASK", "EMAIL", "SENT", TODAY, 9, "u3"), action("c2", "TASK", "EMAIL", "SENT", TODAY, 15, "u3"),   // a person sent these
                    send("d1", "EMAIL", TODAY, 9, "u4"), action("d2", "SEND", "EMAIL", "FAILED", TODAY, 15, "u4"),                  // one never went out
                    action("e1", "REPLY", "EMAIL", "SENT", TODAY, 9, "u5"), action("e2", "REPLY", "EMAIL", "SENT", TODAY, 15, "u5"));

            assertEquals(new DoubleContact(1, 4), EngagementDiagnosisRules.doubleContact(actions, DAY));
        }

        @Test
        void doubleContactIsPerLocalDay() {
            // 23:30 and 00:30 IST: same UTC day, two local days.
            ActionRow late = new ActionRow("late", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null,
                    LocalDateTime.of(2026, 11, 2, 18, 0), "u1", null);
            ActionRow early = new ActionRow("early", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null,
                    LocalDateTime.of(2026, 11, 2, 19, 0), "u1", null);
            assertEquals(0, EngagementDiagnosisRules.doubleContact(List.of(late, early), WEEK).people());
            // Two on one local day, on different days of the week: one person, not two.
            List<ActionRow> twice = List.of(send("a", "EMAIL", TODAY, 9, "u1"), send("b", "EMAIL", TODAY, 10, "u1"),
                    send("c", "EMAIL", TODAY.minusDays(1), 9, "u1"), send("d", "EMAIL", TODAY.minusDays(1), 10, "u1"));
            assertEquals(new DoubleContact(1, 1), EngagementDiagnosisRules.doubleContact(twice, WEEK));
        }

        @Test
        void oneUserOnTwoLeadRowsIsOnePersonButTwoLeadRowsWithoutAUserAreTwo() {
            ActionRow a = new ActionRow("a", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), "u1", "lead1");
            ActionRow b = new ActionRow("b", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 10), "u1", "lead2");
            ActionRow c = new ActionRow("c", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 9), null, "lead3");
            ActionRow d = new ActionRow("d", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, utc(TODAY, 10), null, "lead4");

            assertEquals(new DoubleContact(1, 3), EngagementDiagnosisRules.doubleContact(List.of(a, b, c, d), DAY));
        }

        @Test
        void sentAfterReplyIsCriticalFromFive() {
            assertNull(only("SENT_AFTER_REPLY", DAILY, afterReply(0)));
            assertEquals("warning", only("SENT_AFTER_REPLY", DAILY, afterReply(1)).severity());
            assertEquals("warning", only("SENT_AFTER_REPLY", DAILY, afterReply(4)).severity());
            Problem p = only("SENT_AFTER_REPLY", DAILY, afterReply(5));
            assertEquals("critical", p.severity());
            assertEquals(5, p.affected());
            assertEquals(Map.of("sends", 5L), p.numbers());
        }

        @Test
        void aSendWithinSeventyTwoHoursAfterAReplyCounts() {
            ActionRow first = send("first", "WHATSAPP", TODAY.minusDays(1), 9, "u1");
            Map<String, Signal> signals = Map.of("first", replied(epoch(TODAY.minusDays(1), 10)));

            assertEquals(1, EngagementDiagnosisRules.sentAfterReply(List.of(first, send("next", "EMAIL", TODAY, 9, "u1")), signals, DAY));
        }

        @Test
        void exactlySeventyTwoHoursCountsAndAMinuteMoreDoesNot() {
            LocalDateTime sentAt = utc(TODAY, 12);
            long reply = sentAt.toInstant(ZoneOffset.UTC).toEpochMilli() - 72 * 3_600_000L;
            ActionRow first = send("first", "WHATSAPP", TODAY.minusDays(5), 9, "u1");
            ActionRow next = new ActionRow("next", "e1", "SEND", "EMAIL", "SENT", null, null, null, null, null, sentAt, "u1", null);

            assertEquals(1, EngagementDiagnosisRules.sentAfterReply(List.of(first, next), Map.of("first", replied(reply)), DAY));
            assertEquals(0, EngagementDiagnosisRules.sentAfterReply(List.of(first, next), Map.of("first", replied(reply - 60_000)), DAY));
        }

        @Test
        void onlyAnEngineSendOnEmailOrWhatsAppAfterTheReplyCounts() {
            long reply = epoch(TODAY, 10);
            ActionRow first = send("first", "WHATSAPP", TODAY, 9, "u1");
            Map<String, Signal> signals = Map.of("first", replied(reply));

            assertEquals(0, count(signals, first, action("x", "REPLY", "WHATSAPP", "SENT", TODAY, 11, "u1")));
            assertEquals(0, count(signals, first, action("x", "TASK", "EMAIL", "SENT", TODAY, 11, "u1")));
            assertEquals(0, count(signals, first, action("x", "SEND", "EMAIL", "FAILED", TODAY, 11, "u1")));
            assertEquals(0, count(signals, first, send("x", "IN_APP", TODAY, 11, "u1")));
            assertEquals(0, count(signals, first, send("x", "EMAIL", TODAY, 9, "u1")));       // before the reply
            assertEquals(0, count(signals, first, send("x", "EMAIL", TODAY, 11, "u2")));      // someone else
            assertEquals(1, count(signals, first, send("x", "EMAIL", TODAY, 11, "u1")));
        }

        @Test
        void aSendBeforeThePeriodIsNotCounted() {
            ActionRow first = send("first", "WHATSAPP", TODAY.minusDays(1), 9, "u1");
            ActionRow next = send("next", "EMAIL", TODAY.minusDays(1), 11, "u1");
            Map<String, Signal> signals = Map.of("first", replied(epoch(TODAY.minusDays(1), 10)));

            assertEquals(0, EngagementDiagnosisRules.sentAfterReply(List.of(first, next), signals, DAY));
        }

        @Test
        void aReplyToARowTheReportDoesNotCountStillMeansTheyWrote() {
            ActionRow answer = action("answer", "REPLY", "WHATSAPP", "SENT", TODAY, 9, "u1");

            assertEquals(1, count(Map.of("answer", replied(epoch(TODAY, 10))), answer, send("x", "EMAIL", TODAY, 11, "u1")));
        }

        private long count(Map<String, Signal> signals, ActionRow... actions) {
            return EngagementDiagnosisRules.sentAfterReply(List.of(actions), signals, DAY);
        }

        @Test
        void creditsAsTheBanner() {
            assertNull(only("CREDITS_LOW", DAILY, runway(null)));
            assertNull(only("CREDITS_LOW", DAILY, runway(7.0)));
            assertEquals("warning", only("CREDITS_LOW", DAILY, runway(6.9)).severity());
            assertEquals("warning", only("CREDITS_LOW", DAILY, runway(2.0)).severity());
            Problem p = only("CREDITS_LOW", DAILY, runway(1.9));
            assertEquals("critical", p.severity());
            assertEquals(0, p.affected());
            assertEquals(Map.of("runwayDays", 1.9), p.numbers());
        }

        @Test
        void stuckFromFiveMembersOnTheWeeklyView() {
            assertNull(only("MEMBERS_STUCK", WEEKLY, stuck(4)));
            Problem p = only("MEMBERS_STUCK", WEEKLY, stuck(5));
            assertEquals("warning", p.severity());
            assertEquals(5, p.affected());
            assertEquals(Map.of("members", 5L), p.numbers());
            assertNull(only("MEMBERS_STUCK", DAILY, stuck(5)));
        }

        @Test
        void thereIsNoOutsideScheduleRule() {
            Outcome o = eval(WEEKLY, new Facts(quietLeads(), quietCalls(), quietWhatsApp(), quietEmail(), quietEngine()));
            assertTrue(o.problems().stream().noneMatch(p -> "SENT_OUTSIDE_SCHEDULE".equals(p.code())));
        }
    }

    // ── ranking and the cap ──

    @Nested
    class Ranking {

        private Facts busy() {
            return new Facts(
                    new LeadFacts(new ContactCounts(100, 40, 0, 0), List.of(new AgentFact("A", "ACTIVE", 0, 0, 0, 0)), List.of()),
                    new CallFacts(new CallCounts(10, 10, 0, 0), null, new CallDetails(new CallLengths(50, 40, 10, 0), List.of(),
                            new CallInsights(0, Map.of(), List.of(), 0, List.of()))),
                    new WhatsAppFacts(new WhatsAppCounts(100, 50, List.of()), List.of(), null),
                    new EmailFacts(new EmailCounts(100, 6, 1, 0.06, true), List.of(), null),
                    new EngineFacts(new RunCounts(100, 60, List.of()), new DoubleContact(7, 100), 3L, 1.0, 9L));
        }

        @Test
        void criticalFirstThenAffectedThenStage() {
            Outcome o = eval(WEEKLY, busy());
            List<String> codes = o.problems().stream().map(Problem::code).toList();

            // Critical: ENGINE 60, WHATSAPP 50, CALLING 10, EMAIL 1 (1% of mail complained), ENGINE 0.
            // Warning: LEADS 40, SHORT_CALLS 40 (same affected: stage order), MEMBERS_STUCK 9, DOUBLE_CONTACT 7, EMAIL 6.
            assertEquals(List.of("ENGINE_ACTIONS_FAILING", "WHATSAPP_FAILED_HIGH", "CALLS_NOT_GOING_OUT", "EMAIL_COMPLAINTS",
                    "CREDITS_LOW", "LEADS_MISSING_CONTACT", "SHORT_CALLS", "MEMBERS_STUCK", "DOUBLE_CONTACT", "EMAIL_BOUNCE_HIGH"), codes);
            assertEquals(2, o.moreProblems());       // SENT_AFTER_REPLY 3 and LEAD_AGENT_NOT_DELIVERING 1
        }

        @Test
        void aDayShowsFive() {
            Outcome o = eval(DAILY, busy());

            assertEquals(5, o.problems().size());
            assertEquals("ENGINE_ACTIONS_FAILING", o.problems().get(0).code());
            // MEMBERS_STUCK is weekly only: 11 fired, 5 shown.
            assertEquals(6, o.moreProblems());
        }

        @Test
        void aStageIsProblemEvenWhenItsProblemWasCut() {
            Outcome o = eval(DAILY, busy());

            assertTrue(o.problems().stream().noneMatch(p -> "LEADS".equals(p.stage())));
            assertEquals("PROBLEM", status(o, "LEADS"));
        }

        @Test
        void noProblemsNothingCut() {
            Outcome o = eval(DAILY, new Facts(quietLeads(), quietCalls(), quietWhatsApp(), quietEmail(), quietEngine()));

            assertTrue(o.problems().isEmpty());
            assertEquals(0, o.moreProblems());
        }
    }

    // ── stages ──

    @Nested
    class Stages {

        private final Facts quiet = new Facts(quietLeads(), quietCalls(), quietWhatsApp(), quietEmail(), quietEngine());

        @Test
        void oneRowPerStageInOrder() {
            assertEquals(List.of("LEADS", "CALLING", "WHATSAPP", "EMAIL", "ENGINE"),
                    eval(DAILY, quiet).stages().stream().map(StageStatus::stage).toList());
        }

        @Test
        void nothingHappenedIsNoActivity() {
            eval(DAILY, quiet).stages().forEach(s -> assertEquals("NO_ACTIVITY", s.status(), s.stage()));
        }

        @Test
        void aFailedSectionIsUnavailableNeverOkOrQuiet() {
            Facts missing = new Facts(new LeadFacts(null, null, List.of()), new CallFacts(null, null, null),
                    new WhatsAppFacts(null, List.of(), null), new EmailFacts(null, List.of(), null),
                    new EngineFacts(null, null, null, null, null));
            Outcome o = EngagementDiagnosisRules.evaluate(DAILY, missing, Set.copyOf(EngagementDiagnosisRules.STAGES));

            assertTrue(o.problems().isEmpty());
            o.stages().forEach(s -> assertEquals("UNAVAILABLE", s.status(), s.stage()));
        }

        @Test
        void unavailableWinsOverPlentyOfQuietActivity() {
            Facts plenty = facts(new WhatsAppFacts(new WhatsAppCounts(500, 0, List.of()), List.of(), null));

            assertEquals("UNAVAILABLE", status(EngagementDiagnosisRules.evaluate(DAILY, plenty, Set.of("WHATSAPP")), "WHATSAPP"));
        }

        @Test
        void aFiredProblemWinsOverMissingData() {
            Facts bad = facts(new WhatsAppFacts(new WhatsAppCounts(100, 50, List.of()), List.of(), null));

            assertEquals("PROBLEM", status(EngagementDiagnosisRules.evaluate(DAILY, bad, Set.of("WHATSAPP")), "WHATSAPP"));
        }

        @Test
        void leads() {
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new LeadFacts(new ContactCounts(9, 0, 0, 0), List.of(), List.of()))), "LEADS"));
            assertEquals("OK", status(eval(DAILY, facts(new LeadFacts(new ContactCounts(10, 0, 0, 0), List.of(), List.of()))), "LEADS"));
            // An agent that delivers is activity, but a handful of leads judges nothing.
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new LeadFacts(new ContactCounts(0, 0, 0, 0),
                    List.of(new AgentFact("A", "ACTIVE", 1, 0, 0, 1)), List.of()))), "LEADS"));
            assertEquals("NO_ACTIVITY", status(eval(DAILY, facts(new LeadFacts(new ContactCounts(0, 0, 0, 0),
                    List.of(new AgentFact("A", "PAUSED", 0, 0, 0, 0)), List.of()))), "LEADS"));
        }

        @Test
        void calling() {
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new CallFacts(new CallCounts(10, 0, 0, 1), null, NO_CALL_DETAILS))), "CALLING"));
            // Plenty of calls but no baseline and few connected: no rule can judge them.
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new CallFacts(new CallCounts(100, 0, 0, 5), null, NO_CALL_DETAILS))), "CALLING"));
            assertEquals("OK", status(eval(DAILY, facts(new CallFacts(new CallCounts(100, 0, 0, 40), new CallCounts(50, 0, 0, 25), NO_CALL_DETAILS))), "CALLING"));
            assertEquals("OK", status(eval(DAILY, facts(new CallFacts(new CallCounts(100, 6, 0, 5), null, NO_CALL_DETAILS))), "CALLING"));
            CallDetails connected = new CallDetails(new CallLengths(20, 0, 20, 0), List.of(), NO_CALL_DETAILS.insights());
            assertEquals("OK", status(eval(DAILY, facts(new CallFacts(new CallCounts(100, 0, 0, 20), null, connected))), "CALLING"));
        }

        @Test
        void callingWeeklyHasMoreRulesToBeEnoughFor() {
            CallDetails analysed = new CallDetails(new CallLengths(5, 0, 5, 0), List.of(),
                    new CallInsights(10, Map.of(), List.of(), 0, List.of()));
            Facts f = facts(new CallFacts(new CallCounts(10, 0, 0, 5), null, analysed));
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, f), "CALLING"));
            assertEquals("OK", status(eval(WEEKLY, f), "CALLING"));
        }

        @Test
        void whatsapp() {
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new WhatsAppFacts(new WhatsAppCounts(19, 0, List.of()), List.of(), null))), "WHATSAPP"));
            assertEquals("OK", status(eval(DAILY, facts(new WhatsAppFacts(new WhatsAppCounts(20, 0, List.of()), List.of(), null))), "WHATSAPP"));
        }

        @Test
        void email() {
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new EmailFacts(new EmailCounts(19, 0, 0, 0, true), List.of(), null))), "EMAIL"));
            assertEquals("OK", status(eval(DAILY, facts(new EmailFacts(new EmailCounts(20, 0, 0, 0, true), List.of(), null))), "EMAIL"));
            // Without tracking no bounce can be seen, however many went out.
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new EmailFacts(new EmailCounts(500, 0, 0, 0, false), List.of(), null))), "EMAIL"));
            EmailSubjectRow judged = new EmailSubjectRow("Hi", 500, 0, 0, 0, 50L, null, 0.1, "OK");
            assertEquals("OK", status(eval(WEEKLY, facts(new EmailFacts(new EmailCounts(500, 0, 0, 0, false), List.of(judged), 0.1))), "EMAIL"));
        }

        @Test
        void engine() {
            assertEquals("NOT_ENOUGH_DATA", status(eval(DAILY, facts(new EngineFacts(new RunCounts(9, 0, List.of()), new DoubleContact(0, 0), 0L, null, 0L))), "ENGINE"));
            assertEquals("OK", status(eval(DAILY, facts(new EngineFacts(new RunCounts(10, 0, List.of()), new DoubleContact(0, 0), 0L, null, 0L))), "ENGINE"));
        }

        @Test
        void eachFailedSectionMarksItsStages() {
            assertEquals(Set.of("LEADS"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("lists")));
            assertEquals(Set.of("LEADS"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("leadDetails")));
            assertEquals(Set.of("LEADS"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("leadAgents")));
            assertEquals(Set.of("CALLING"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("calls")));
            assertEquals(Set.of("CALLING"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("callDetails")));
            assertEquals(Set.of("CALLING", "LEADS"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("callDetails")));
            assertEquals(Set.of("CALLING"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("callBaseline")));
            assertEquals(Set.of("WHATSAPP", "EMAIL", "ENGINE"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("delivery")));
            assertEquals(Set.of("WHATSAPP", "EMAIL", "ENGINE"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("actions")));
            assertEquals(Set.of("WHATSAPP", "EMAIL", "ENGINE", "LEADS"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("replies")));
            assertEquals(Set.of("ENGINE"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("runs")));
            assertEquals(Set.of("ENGINE"), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("creditBalance")));
            assertEquals(Set.of("ENGINE"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("stuckMembers")));
            assertEquals(Set.of("ENGINE"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("promptChanges")));
            assertEquals(Set.of("LEADS"), EngagementDiagnosisRules.unavailableStages(WEEKLY, List.of("demos")));
            assertEquals(Set.copyOf(EngagementDiagnosisRules.STAGES), EngagementDiagnosisRules.unavailableStages(DAILY, List.of("report")));
            assertTrue(EngagementDiagnosisRules.unavailableStages(DAILY, List.of()).isEmpty());
        }
    }

    // ── verdicts ──

    @Nested
    class Verdicts {

        private List<String> verdicts(String[] names, long[] sends, Double[] rates) {
            return EngagementDiagnosisRules.verdicts(List.of(names),
                    java.util.Arrays.stream(sends).boxed().toList(), java.util.Arrays.asList(rates));
        }

        @Test
        void bestAndWorstAmongRowsWithEnoughSends() {
            assertEquals(List.of("BEST", "OK", "WORST", "NOT_ENOUGH_DATA"), verdicts(
                    new String[]{"a", "b", "c", "d"}, new long[]{100, 100, 100, 99}, new Double[]{0.3, 0.2, 0.1, 0.9}));
        }

        @Test
        void oneRowWithEnoughIsNeitherBestNorWorst() {
            assertEquals(List.of("OK", "NOT_ENOUGH_DATA"), verdicts(
                    new String[]{"a", "b"}, new long[]{100, 99}, new Double[]{0.3, 0.1}));
        }

        @Test
        void twoRowsAreEnoughToCompare() {
            assertEquals(List.of("BEST", "WORST"), verdicts(new String[]{"a", "b"}, new long[]{100, 100}, new Double[]{0.3, 0.1}));
        }

        @Test
        void equalRatesAreAllOk() {
            assertEquals(List.of("OK", "OK"), verdicts(new String[]{"a", "b"}, new long[]{100, 100}, new Double[]{0.2, 0.2}));
        }

        @Test
        void noRateIsNotEnoughData() {
            assertEquals(List.of("NOT_ENOUGH_DATA", "OK"), verdicts(new String[]{"a", "b"}, new long[]{100, 100}, new Double[]{null, 0.2}));
        }

        @Test
        void placeholderRowsAreNotRanked() {
            assertEquals(List.of("OK", "NOT_ENOUGH_DATA", "BEST", "WORST"), verdicts(
                    new String[]{EngagementDiagnosisRules.NO_TEMPLATE, EngagementDailyReportService.OTHER_TEMPLATES, "a", "b"},
                    new long[]{500, 500, 100, 100}, new Double[]{0.9, 0.9, 0.3, 0.1}));
        }

        @Test
        void templatesComeMostSentFirstWithoutTheEmailRows() {
            List<WhatsAppTemplateRow> rows = EngagementDiagnosisRules.whatsappTemplates(List.of(
                    new TemplateRow("EMAIL", "Subject", 900, 0, 0, 0, 0, 0, 0, "INR"),
                    new TemplateRow("WHATSAPP", "small", 100, 90, 80, 2, 0.02, 0, 0, "INR"),
                    new TemplateRow("WHATSAPP", "big", 200, 190, 180, 20, 0.1, 0, 0, "INR")));

            assertEquals(List.of("big", "small"), rows.stream().map(WhatsAppTemplateRow::name).toList());
            assertEquals("BEST", rows.get(0).verdict());
            assertEquals("WORST", rows.get(1).verdict());
            assertEquals(new WhatsAppTemplateRow("big", 200, 190, 180, 20, 0.1, "BEST"), rows.get(0));
        }

        @Test
        void thereIsARowCapOnSubjects() {
            List<ActionRow> actions = new ArrayList<>();
            Map<String, Signal> signals = new HashMap<>();
            IntStream.range(0, EngagementDailyReportService.MAX_TEMPLATE_ROWS + 3).forEach(i -> {
                actions.add(new ActionRow("a" + i, "e1", "SEND", "EMAIL", "SENT", null, null, "Subject " + i, null, null, utc(TODAY, 9), "u" + i, null));
                signals.put("a" + i, email("Subject " + i, null, true, false));
            });
            List<EmailSubjectRow> rows = EngagementDiagnosisRules.emailSubjects(actions, signals, Map.of(), true, Set.of(), DAY).rows();

            assertEquals(EngagementDailyReportService.MAX_TEMPLATE_ROWS + 1, rows.size());
            EmailSubjectRow other = rows.get(rows.size() - 1);
            assertEquals(EngagementDailyReportService.OTHER_TEMPLATES, other.name());
            assertEquals(3, other.sent());
            assertEquals("NOT_ENOUGH_DATA", other.verdict());
        }
    }

    // ── facts from rows ──

    @Nested
    class Rows {

        private CallRow call(String id, String queue, String log, String status, Integer seconds, boolean connected, Integer hour) {
            return new CallRow(id, queue, log, "u" + id, null, status, seconds, connected, hour, false, null, null, null, null);
        }

        private CallRow analysed(String id, String sentiment, String generic, String likelihood, String objections) {
            return new CallRow(id, "DIALED", "l" + id, "u" + id, null, "COMPLETED", 30, true, 10, true, generic, sentiment,
                    likelihood, objections);
        }

        @Test
        void callLengthsAreBucketedAt20And60() {
            CallDetails d = EngagementDiagnosisRules.callDetails(List.of(
                    call("a", "DIALED", "l1", "COMPLETED", 19, true, 10),
                    call("b", "DIALED", "l2", "COMPLETED", 20, true, 10),
                    call("c", "DIALED", "l3", "COMPLETED", 60, true, 10),
                    call("d", "DIALED", "l4", "COMPLETED", 61, true, 10),
                    call("e", "DIALED", "l5", "COMPLETED", null, true, 10),     // connected, length unknown
                    call("f", "DIALED", "l6", "NO_ANSWER", 11, false, 10)));

            assertEquals(new CallLengths(5, 1, 2, 1), d.lengths());
        }

        @Test
        void hoursCountDialledFinishedCallsInHourOrder() {
            CallDetails d = EngagementDiagnosisRules.callDetails(List.of(
                    call("a", "DIALED", "l1", "COMPLETED", 30, true, 14),
                    call("b", "DIALED", "l2", "NO_ANSWER", null, false, 14),
                    call("c", "DIALED", "l3", "BUSY", null, false, 9),
                    call("d", "DIALED", "l4", "IN_PROGRESS", null, false, 9),   // still going
                    call("e", "FAILED", null, null, null, false, null),         // never dialled
                    call("f", "QUEUED", null, null, null, false, null),         // waiting
                    call("g", "DIALED", "l7", null, null, false, 9)));          // log row missing

            List<CallHourRow> hours = d.hours();
            assertEquals(List.of(9, 14), hours.stream().map(CallHourRow::hour).toList());
            assertEquals(new CallHourRow(9, 1, 0, 0.0, false), hours.get(0));
            assertEquals(new CallHourRow(14, 2, 1, 0.5, false), hours.get(1));
        }

        @Test
        void anHourHasEnoughFromTwentyCalls() {
            List<CallRow> nineteen = new ArrayList<>();
            IntStream.range(0, 19).forEach(i -> nineteen.add(call("c" + i, "DIALED", "l" + i, "BUSY", null, false, 10)));
            assertFalse(EngagementDiagnosisRules.callDetails(nineteen).hours().get(0).enough());
            nineteen.add(call("c19", "DIALED", "l19", "BUSY", null, false, 10));
            assertTrue(EngagementDiagnosisRules.callDetails(nineteen).hours().get(0).enough());
        }

        @Test
        void insightsReadOnlyFinishedAnalyses() {
            CallInsights in = EngagementDiagnosisRules.callDetails(List.of(
                    analysed("a", "POSITIVE", "NOT_INTERESTED", "HIGH", "[{\"objection\":\"Budget\",\"handled\":true}]"),
                    analysed("b", "NEGATIVE", "NOT_INTERESTED", "low", "[{\"objection\":\"budget \"},{\"objection\":\"BUDGET\"},{\"objection\":\"Timing\"}]"),
                    analysed("c", null, "CALLBACK_REQUESTED", "high", null),
                    call("d", "DIALED", "l9", "COMPLETED", 30, true, 10))).insights();

            assertEquals(3, in.analysed());
            assertEquals(Map.of("POSITIVE", 1L, "NEUTRAL", 0L, "NEGATIVE", 1L), in.sentiment());
            assertEquals("NOT_INTERESTED", in.outcomes().get(0).status());
            assertEquals(2, in.outcomes().get(0).count());
            assertEquals(2, in.highLikelihood());
            // Two calls raised budget, however often and in whatever case; each call counts once.
            assertEquals(List.of(new ObjectionCount("Budget", 2), new ObjectionCount("Timing", 1)), in.topObjections());
        }

        @Test
        void atMostTenObjections() {
            List<CallRow> rows = new ArrayList<>();
            IntStream.range(0, 12).forEach(i -> rows.add(analysed("c" + i, null, null, null, "[{\"objection\":\"o" + i + "\"}]")));

            assertEquals(10, EngagementDiagnosisRules.callDetails(rows).insights().topObjections().size());
        }

        @Test
        void objectionsSurviveBadJson() {
            assertEquals(List.of(), EngagementDiagnosisRules.objections(null));
            assertEquals(List.of(), EngagementDiagnosisRules.objections("not json"));
            assertEquals(List.of(), EngagementDiagnosisRules.objections("{\"objection\":\"x\"}"));
            assertEquals(List.of("x"), EngagementDiagnosisRules.objections("[{\"objection\":\"x\"},{\"objection\":\"  \"},{\"other\":1},7]"));
        }

        @Test
        void contactCountsTreatBlanksAndPlaceholdersAsMissing() {
            ContactCounts c = EngagementDiagnosisRules.contactCounts(List.of(
                    new LeadRow("both", "98", "a@b.com", null, null, null),
                    new LeadRow("leadOnly", null, null, "98", "c@d.com", null),
                    new LeadRow("noPhone", " ", "a@b.com", null, null, null),
                    new LeadRow("placeholder", "98", "x@placeholder.test", null, null, null),
                    new LeadRow("neither", null, "x@placeholder.test", "", " ", null)),
                    e -> e.endsWith("@placeholder.test"));

            assertEquals(new ContactCounts(5, 2, 2, 1), c);
        }

        @Test
        void agentCountersSumThePeriodOnly() {
            List<AgentFact> facts = EngagementDiagnosisRules.agentFacts(
                    List.of(new AgentRow("a1", "Busy", "ACTIVE", null, null),
                            new AgentRow("a2", "Idle", "ACTIVE", utc(TODAY.minusDays(30), 9), null)),
                    List.of(new AgentDay("a1", TODAY, 5, 0, 0, 1, 2, 0, 0, 0, 0),
                            new AgentDay("a1", TODAY.minusDays(1), 5, 0, 9, 1, 2, 0, 0, 0, 0),
                            new AgentDay("a1", TODAY.minusDays(9), 5, 0, 9, 1, 2, 0, 0, 0, 0)),
                    WEEK, LATE);

            assertEquals(new AgentFact("Busy", "ACTIVE", 10, 4, 2, 9), facts.get(0));
            assertEquals(new AgentFact("Idle", "ACTIVE", 0, 0, 0, 0), facts.get(1));
        }

        @Test
        void anAgentCreatedAfterThePeriodIsNotCounted() {
            Window lastWeek = EngagementDailyReportService.window(TODAY.minusDays(13), TODAY.minusDays(7), TODAY, IST);
            AgentRow createdInIt = new AgentRow("a1", "During", "ACTIVE", utc(TODAY.minusDays(10), 9), null);
            AgentRow createdAfter = new AgentRow("a2", "After", "ACTIVE", utc(TODAY.minusDays(1), 9), null);

            assertEquals(List.of(new AgentFact("During", "ACTIVE", 0, 0, 0, 0)),
                    EngagementDiagnosisRules.agentFacts(List.of(createdInIt, createdAfter), List.of(), lastWeek, LATE));
        }

        @Test
        void anAgentIsNotJudgedBeforeTodaysWindowCloses() {
            AgentRow agent = new AgentRow("a1", "Morning", "ACTIVE", utc(TODAY.minusDays(30), 9), null);
            Instant morning = TODAY.atTime(8, 0).atZone(IST).toInstant();
            Instant evening = TODAY.atTime(19, 0).atZone(IST).toInstant();

            assertEquals(List.of(), EngagementDiagnosisRules.agentFacts(List.of(agent), List.of(), DAY, morning));
            assertEquals(1, EngagementDiagnosisRules.agentFacts(List.of(agent), List.of(), DAY, evening).size());
        }

        @Test
        void aWindowIsReadAsTheAgentRunsIt() {
            LocalDate sunday = LocalDate.of(2026, 11, 8);
            Instant monday = sunday.plusDays(1).atStartOfDay(IST).toInstant();
            assertEquals(false, EngagementDiagnosisRules.windowClosedInPeriod(null, sunday, sunday, monday),
                    "the default window has Sunday off");
            assertEquals(true, EngagementDiagnosisRules.windowClosedInPeriod(
                    "{\"days\":[7]}", sunday, sunday, monday), "a key it sets wins over the default");
            assertEquals(false, EngagementDiagnosisRules.windowClosedInPeriod(
                    "{\"days\":[]}", TODAY, TODAY, LATE), "no working days never opens");
            assertEquals(false, EngagementDiagnosisRules.windowClosedInPeriod(
                    "{\"end\":\"late\"}", TODAY, TODAY, LATE), "an unreadable time never opens");

            String overnight = "{\"start\":\"22:00\",\"end\":\"02:00\"}";
            Instant beforeItEnds = TODAY.plusDays(1).atTime(1, 0).atZone(IST).toInstant();
            Instant afterItEnds = TODAY.plusDays(1).atTime(2, 0).atZone(IST).toInstant();
            assertEquals(false, EngagementDiagnosisRules.windowClosedInPeriod(overnight, TODAY, TODAY, beforeItEnds));
            assertEquals(true, EngagementDiagnosisRules.windowClosedInPeriod(overnight, TODAY, TODAY, afterItEnds));

            String utcWindow = "{\"tz\":\"UTC\",\"end\":\"19:00\"}";
            Instant evening = TODAY.atTime(19, 0).atZone(IST).toInstant();
            assertEquals(false, EngagementDiagnosisRules.windowClosedInPeriod(utcWindow, TODAY, TODAY, evening),
                    "19:00 in the agent's zone, not the institute's");
        }

        private LeadRow lead(String person, String source) {
            return new LeadRow(person, "98", null, null, null, source);
        }

        @Test
        void sourcesCountPeopleAndLeadsWithoutACandidateAreOther() {
            List<LeadSourceRow> rows = EngagementDiagnosisRules.leadSources(
                    List.of(lead("p1", "maps"), lead("p2", "maps"), lead("p3", "maps"), lead("p4", null)),
                    Set.of("p1", "p2", "p4", "someoneElse"),
                    Set.of("p1"),
                    List.of(new BookingRow("b1", null, "p1", utc(TODAY, 9)), new BookingRow("b2", null, "p1", utc(TODAY, 10)),
                            new BookingRow("b3", null, "notAddedThisWeek", utc(TODAY, 10))));

            assertEquals(new LeadSourceRow("maps", 3, 2L, 1L, 2L, 0.6667, 0.3333, false), rows.get(0));
            assertEquals(new LeadSourceRow("OTHER", 1, 1L, 0L, 0L, 1.0, 0.0, false), rows.get(1));
        }

        @Test
        void aSourceHasEnoughFromThirtyLeads() {
            List<LeadRow> leads = new ArrayList<>();
            IntStream.range(0, 29).forEach(i -> leads.add(lead("p" + i, "maps")));
            assertFalse(EngagementDiagnosisRules.leadSources(leads, Set.of(), Set.of(), List.of()).get(0).enough());
            leads.add(lead("p29", "maps"));
            assertTrue(EngagementDiagnosisRules.leadSources(leads, Set.of(), Set.of(), List.of()).get(0).enough());
        }

        @Test
        void aFailedReadLeavesItsColumnsNullNotZero() {
            LeadSourceRow r = EngagementDiagnosisRules.leadSources(List.of(lead("p1", "maps")), null, null, null).get(0);

            assertEquals(1, r.leads());
            assertNull(r.contacted());
            assertNull(r.responded());
            assertNull(r.demosBooked());
            assertNull(r.contactRate());
            assertNull(r.responseRate());
        }

        @Test
        void contactedMeansAMessageOrADialledCall() {
            Set<String> people = EngagementDiagnosisRules.contactedPeople(
                    List.of(send("a", "EMAIL", TODAY, 9, "u1"),
                            action("b", "SEND", "EMAIL", "FAILED", TODAY, 9, "u2"),
                            send("c", "EMAIL", TODAY.minusDays(2), 9, "u3"),
                            action("d", "REPLY", "EMAIL", "SENT", TODAY, 9, "u4")),
                    List.of(call("e", "DIALED", "l1", "NO_ANSWER", null, false, 9),
                            call("f", "FAILED", null, null, null, false, null)),
                    DAY);

            assertEquals(Set.of("u:u1", "u:ue"), people);
        }

        @Test
        void respondedMeansAReplyCreditedToAMessageOfThePeriod() {
            Set<String> people = EngagementDiagnosisRules.respondedPeople(
                    List.of(send("a", "EMAIL", TODAY, 9, "u1"), send("b", "EMAIL", TODAY, 9, "u2"),
                            send("c", "EMAIL", TODAY.minusDays(2), 9, "u3")),
                    Map.of("a", 1L, "c", 2L), List.of(), DAY);

            assertEquals(Set.of("u:u1"), people);
        }

        @Test
        void pickingUpACallIsAResponseAndARingingOneIsNot() {
            CallRow answered = new CallRow("q1", "DONE", "l1", "u1", null, "COMPLETED", 60, true, 10, false, null, null, null, null);
            CallRow missed = new CallRow("q2", "DONE", "l2", "u2", null, "NO_ANSWER", 0, false, 10, false, null, null, null, null);

            assertEquals(Set.of("u:u1"),
                    EngagementDiagnosisRules.respondedPeople(List.of(), Map.of(), List.of(answered, missed), DAY));
        }

        @Test
        void noResponseCanBeSeenWhenEveryEmailsRepliesMissUsAndNothingElseWentOut() {
            List<ActionRow> emails = List.of(send("a", "EMAIL", TODAY, 9, "u1"));
            Map<String, Signal> fromUntracked = Map.of("a", email("Hi", "hello@elsewhere.test", true, false));

            assertEquals(false, EngagementDiagnosisRules.responsesVisible(
                    emails, List.of(), fromUntracked, true, Set.of("hello@elsewhere.test"), DAY));
            assertEquals(false, EngagementDiagnosisRules.responsesVisible(
                    emails, List.of(), fromUntracked, false, Set.of(), DAY), "inbound email is off");
            assertEquals(true, EngagementDiagnosisRules.responsesVisible(
                    emails, List.of(), fromUntracked, true, Set.of(), DAY));
            assertEquals(true, EngagementDiagnosisRules.responsesVisible(
                    List.of(send("w", "WHATSAPP", TODAY, 9, "u1")), List.of(), Map.of(), false, Set.of(), DAY));
            CallRow dialled = new CallRow("q1", "DONE", "l1", "u1", null, "NO_ANSWER", 0, false, 10, false, null, null, null, null);
            CallRow neverDialled = new CallRow("q2", "FAILED", null, "u2", null, null, null, false, null, false, null, null, null, null);
            assertEquals(true, EngagementDiagnosisRules.responsesVisible(
                    List.of(), List.of(dialled), Map.of(), false, Set.of(), DAY));
            assertEquals(false, EngagementDiagnosisRules.responsesVisible(
                    List.of(), List.of(neverDialled), Map.of(), false, Set.of(), DAY));
        }

        @Test
        void aPromptVersionWhoseRepliesCannotBeSeenHasNoReplyCount() {
            ActionRow sent = new ActionRow("a", "e1", "SEND", "EMAIL", "SENT", "v1", null, null, null, null, utc(TODAY, 9), "u1", null);
            List<EngagementDiagnosisDao.PromptVersionRow> versions = List.of(
                    new EngagementDiagnosisDao.PromptVersionRow("v1", "e1", "Engine", 1, utc(TODAY, 8), "ADMIN", "Shorter"));

            PromptChangeRow row = EngagementDiagnosisRules.promptChanges(versions, List.of(sent), Map.of(), Map.of(),
                    false, Set.of(), List.of(), DAY).get(0);

            assertEquals(null, row.replies(), "unknown, not 0");
            assertEquals(null, row.replyRate());
            assertEquals(1, row.sends());
        }

        @Test
        void aSendMetaRefusedKeepsMetasReasonAfterTheJobMovesItToFailed() {
            // EngagementDeliveryCheckJob: Meta's verdict arrives and the action goes from SENT to FAILED.
            List<ActionRow> actions = List.of(
                    action("refused", "SEND", "WHATSAPP", "FAILED", TODAY, 10, "u1"),
                    action("neverLeft", "SEND", "WHATSAPP", "FAILED", TODAY, 10, "u2"));

            assertEquals(List.of(
                    new WhatsAppFailureRow("MARKETING_LIMIT", "131049", 1),
                    new WhatsAppFailureRow("REJECTED_AT_SEND", null, 1)),
                    EngagementDiagnosisRules.whatsappFailures(actions, Map.of("refused", failedOnMeta("131049")), DAY));
        }

        @Test
        void signalsAreReadForFailedWhatsAppToo() {
            List<ActionRow> actions = List.of(
                    send("sentWa", "WHATSAPP", TODAY, 9, "u1"),
                    send("sentEmail", "EMAIL", TODAY, 9, "u2"),
                    action("failedWa", "SEND", "WHATSAPP", "FAILED", TODAY, 10, "u3"),
                    action("failedEmail", "SEND", "EMAIL", "FAILED", TODAY, 10, "u4"));

            assertEquals(Set.of("sentWa", "sentEmail", "failedWa"), Set.copyOf(EngagementDiagnosisRules.signalIds(actions)));
        }

        private ActionRow versioned(String id, String version, String channel, int hour, String user) {
            return new ActionRow(id, "e1", "SEND", channel, "SENT", version, null, null, null, null, utc(TODAY, hour), user, null);
        }

        @Test
        void promptVersionsAreComparedExactlyNewestFirst() {
            List<ActionRow> actions = List.of(
                    versioned("a", "v1", "WHATSAPP", 9, "u1"),
                    versioned("b", "v1", "WHATSAPP", 9, "u2"),
                    versioned("c", "v2", "WHATSAPP", 10, "u3"),
                    versioned("d", "v2", "IN_APP", 10, "u4"),              // can't report a reply: not a send here
                    versioned("e", null, "WHATSAPP", 11, "u5"));
            List<PromptVersionRow> versions = List.of(
                    new PromptVersionRow("v1", "e1", "Eng", 1, LocalDateTime.of(2026, 11, 1, 6, 0), "ADMIN", null),
                    new PromptVersionRow("v2", "e1", "Eng", 2, LocalDateTime.of(2026, 11, 2, 6, 0), "ADMIN", "Shorter"),
                    new PromptVersionRow("v3", "e1", "Eng", 3, LocalDateTime.of(2026, 11, 3, 6, 0), "ADMIN", "No sends"));
            List<BookingRow> bookings = List.of(
                    new BookingRow("b1", "u1", null, utc(TODAY, 12)),     // v1's latest send to u1
                    new BookingRow("b2", "u3", null, utc(TODAY, 8)),      // before any send: nobody's
                    new BookingRow("b3", "u5", null, utc(TODAY, 12)));    // an unversioned send: nobody's

            List<PromptChangeRow> rows = EngagementDiagnosisRules.promptChanges(versions, actions, Map.of(), Map.of("a", 1L),
                    true, Set.of(), bookings, DAY);

            assertEquals(List.of(2, 1), rows.stream().map(PromptChangeRow::version).toList());
            assertEquals(new PromptChangeRow("e1", "Eng", 2, "2026-11-02T06:00:00Z", "ADMIN", "Shorter", 1, 0L, 0.0, 0L, false), rows.get(0));
            assertEquals(new PromptChangeRow("e1", "Eng", 1, "2026-11-01T06:00:00Z", "ADMIN", null, 2, 1L, 0.5, 1L, false), rows.get(1));
            assertEquals(Set.of("v1", "v2"), EngagementDiagnosisRules.promptVersionIds(actions, DAY));
        }

        @Test
        void aVersionHasEnoughFromAHundredSendsThatCouldReportAReply() {
            List<ActionRow> actions = new ArrayList<>();
            IntStream.range(0, 100).forEach(i -> actions.add(versioned("a" + i, "v1", "WHATSAPP", 9, "u" + i)));
            List<PromptVersionRow> versions = List.of(new PromptVersionRow("v1", "e1", "Eng", 1, utc(TODAY, 1), "ADMIN", null));
            assertTrue(EngagementDiagnosisRules.promptChanges(versions, actions, Map.of(), Map.of(), true, Set.of(), List.of(), DAY).get(0).enough());

            // The same 100 as emails from a sender whose replies can't reach us: nothing to compare.
            List<ActionRow> emails = actions.stream().map(a -> versioned(a.id(), "v1", "EMAIL", 9, a.userId())).toList();
            Map<String, Signal> signals = new HashMap<>();
            emails.forEach(a -> signals.put(a.id(), email("Hi", "b@gmail.example", true, false)));
            PromptChangeRow r = EngagementDiagnosisRules.promptChanges(versions, emails, signals, Map.of(), true,
                    Set.of("b@gmail.example"), List.of(), DAY).get(0);
            assertEquals(100, r.sends());
            assertNull(r.replyRate());
            assertFalse(r.enough());
        }

        @Test
        void unreadableDeliveryOrDemosLeaveVersionColumnsNull() {
            PromptChangeRow r = EngagementDiagnosisRules.promptChanges(
                    List.of(new PromptVersionRow("v1", "e1", "Eng", 1, utc(TODAY, 1), "ADMIN", null)),
                    List.of(versioned("a", "v1", "WHATSAPP", 9, "u1")), Map.of(), null, false, Set.of(), null, DAY).get(0);

            assertNull(r.replies());
            assertNull(r.replyRate());
            assertNull(r.demosBooked());
        }

        @Test
        void theRepliesGapNamesTheSendersThatCannotBeHeard() {
            List<ActionRow> actions = List.of(send("a", "EMAIL", TODAY, 9, "u1"), send("b", "EMAIL", TODAY, 9, "u2"),
                    send("c", "EMAIL", TODAY, 9, "u3"), send("old", "EMAIL", TODAY.minusDays(3), 9, "u4"));
            Map<String, Signal> signals = Map.of(
                    "a", email("Hi", "z@gmail.example", true, false),
                    "b", email("Hi", "ok@ses.example", true, false),
                    "c", email("Hi", "a@gmail.example", true, false),
                    "old", email("Hi", "old@gmail.example", true, false));

            DataGap gap = EngagementDiagnosisRules.repliesGap(actions, signals, true,
                    Set.of("z@gmail.example", "a@gmail.example", "old@gmail.example"), DAY);

            assertEquals("EMAIL_REPLIES_NOT_TRACKED", gap.code());
            assertEquals(List.of("a@gmail.example", "z@gmail.example"), gap.names());
            assertNull(EngagementDiagnosisRules.repliesGap(actions, signals, true, Set.of(), DAY));
        }

        @Test
        void withInboundEmailOffEverySenderIsInTheGapEvenWithoutOne() {
            List<ActionRow> actions = List.of(send("a", "EMAIL", TODAY, 9, "u1"), send("b", "EMAIL", TODAY, 9, "u2"));

            assertEquals(List.of("ok@ses.example"), EngagementDiagnosisRules.repliesGap(actions,
                    Map.of("a", email("Hi", "ok@ses.example", true, false)), false, Set.of(), DAY).names());
            assertEquals(List.of(), EngagementDiagnosisRules.repliesGap(actions, Map.of(), false, Set.of(), DAY).names());
            assertNull(EngagementDiagnosisRules.repliesGap(List.of(), Map.of(), false, Set.of(), DAY));
        }

        @Test
        void repliesAreTrackedUnlessEverySenderIsUnreachable() {
            Set<String> gone = Set.of("a@gmail.example", "b@gmail.example");

            assertTrue(EngagementDiagnosisRules.repliesTracked(true, Set.of(), gone));
            assertTrue(EngagementDiagnosisRules.repliesTracked(true, Set.of("ok@ses.example"), gone));
            assertTrue(EngagementDiagnosisRules.repliesTracked(true, Set.of("ok@ses.example", "a@gmail.example"), gone));
            assertFalse(EngagementDiagnosisRules.repliesTracked(true, Set.of("a@gmail.example", "b@gmail.example"), gone));
            // A sender we don't know keeps today's behaviour.
            Set<String> withUnknown = new java.util.HashSet<>(Set.of("a@gmail.example"));
            withUnknown.add(null);
            assertTrue(EngagementDiagnosisRules.repliesTracked(true, withUnknown, gone));
            assertFalse(EngagementDiagnosisRules.repliesTracked(false, Set.of("ok@ses.example"), Set.of()));
            assertFalse(EngagementDiagnosisRules.repliesTracked(false, Set.of(), Set.of()));
        }

        @Test
        void aPercentageWithNoBaseIsNull() {
            assertNull(EngagementDiagnosisRules.rate(0, 0));
            assertNull(EngagementDiagnosisRules.rate(3, 0));
            assertEquals(0.0, EngagementDiagnosisRules.rate(0, 3));
            assertEquals(0.3333, EngagementDiagnosisRules.rate(1, 3));
        }
    }
}
