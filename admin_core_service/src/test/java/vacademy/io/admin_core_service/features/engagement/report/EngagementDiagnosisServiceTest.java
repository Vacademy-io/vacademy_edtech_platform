package vacademy.io.admin_core_service.features.engagement.report;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.audience.service.LeadReportSettingService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDailyReport.*;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosis.StageStatus;
import vacademy.io.admin_core_service.features.engagement.report.EngagementDiagnosisDao.ActionRow;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signal;
import vacademy.io.admin_core_service.features.engagement.report.EngagementReportSignalsClient.Signals;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The request rules, how sections that fail show up, and the JSON the dashboard reads. */
class EngagementDiagnosisServiceTest {

    private static final String INST = "inst", ENGINE = "e1";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private EngagementDiagnosisDao dao;
    private EngagementDailyReportDao reportDao;
    private EngagementDailyReportService reportService;
    private EngagementReportSignalsClient signals;
    private EngagementDiagnosisService service;
    private final LocalDate today = LocalDate.now(IST);

    @BeforeEach
    void setUp() {
        dao = mock(EngagementDiagnosisDao.class);
        reportDao = mock(EngagementDailyReportDao.class);
        reportService = mock(EngagementDailyReportService.class);
        signals = mock(EngagementReportSignalsClient.class);
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.getJdbcTemplate()).thenReturn(mock(JdbcTemplate.class));
        InstituteTimezoneService tz = mock(InstituteTimezoneService.class);
        when(tz.getTimezoneId(INST)).thenReturn("Asia/Kolkata");
        service = new EngagementDiagnosisService(dao, reportDao, reportService, jdbc,
                mock(PlatformTransactionManager.class), tz, mock(LeadReportSettingService.class),
                mock(PlaceholderEmailService.class), signals);
        when(dao.leads(any())).thenReturn(List.of());
        when(dao.actions(any(), any(), any())).thenReturn(List.of());
        when(dao.calls(any())).thenReturn(List.of());
        when(dao.bookings(any())).thenReturn(List.of());
        when(dao.stuckMembers(any())).thenReturn(0L);
        report(new LinkedHashMap<>(), List.of(new EngineOption(ENGINE, "Outreach", "ACTIVE", false)));
    }

    /** A report with nothing in it but these errors and engines. */
    private void report(Map<String, String> errors, List<EngineOption> engines) {
        EngagementDailyReport r = emptyReport(errors, engines, new Email(0, 0, 0, 0, 0, 0, 0, true, true),
                new WhatsApp(0, 0, 0, 0, 0, true, 0, List.of()), null);
        when(reportService.daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(false))).thenReturn(r);
        when(reportService.daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(true))).thenReturn(r);
    }

    private EngagementDailyReport emptyReport(Map<String, String> errors, List<EngineOption> engines, Email email,
                                              WhatsApp whatsapp, Double runway) {
        Summary summary = new Summary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                new Money(0, "INR", false, false), null, null, null, null, runway);
        return new EngagementDailyReport(today.toString(), today.toString(), today.toString(), 1, "Asia/Kolkata", null,
                "now", engines, summary, List.of(), List.of(), null, null, List.of(),
                new Runs(0, 0, Map.of(), 0, 0, List.of()), List.of(), new Calls(0, 0, 0, 0, 0, 0, 0, 0, 0, 0), email,
                whatsapp, List.of(), null, new Outcomes(0, 0, 0, 0, 0, 0, List.of()), null, null, null, List.of(), errors);
    }

    private static String status(EngagementDiagnosis d, String stage) {
        return d.stages().stream().filter(s -> stage.equals(s.stage())).map(StageStatus::status).findFirst().orElseThrow();
    }

    private ActionRow sentEmail(String id) {
        LocalDateTime noon = today.atTime(12, 0).atZone(IST).withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
        return new ActionRow(id, ENGINE, "SEND", "EMAIL", "SENT", null, null, "Hi", null, null, noon, "u-" + id, null);
    }

    // ── request rules ──

    @Test
    void aBadViewIs400() {
        assertThrows(InvalidRequestException.class, () -> service.diagnosis(INST, null, "MONTHLY", null, false));
    }

    @Test
    void theViewDefaultsToDailyAndAnyCaseIsAccepted() {
        assertEquals("DAILY", service.diagnosis(INST, null, null, null, false).view());
        assertEquals("WEEKLY", service.diagnosis(INST, null, " weekly ", null, false).view());
    }

    @Test
    void badDaysAre400() {
        assertThrows(InvalidRequestException.class, () -> service.diagnosis(INST, null, "DAILY", "04-11-2026", false));
        assertThrows(InvalidRequestException.class,
                () -> service.diagnosis(INST, null, "DAILY", today.plusDays(1).toString(), false));
        assertThrows(InvalidRequestException.class,
                () -> service.diagnosis(INST, null, "DAILY", today.minusDays(90).toString(), false));
    }

    @Test
    void theOldestDayIsTodayMinus89AndAWeekMustFitBehindIt() {
        String oldest = today.minusDays(89).toString();

        assertEquals(oldest, service.diagnosis(INST, null, "DAILY", oldest, false).from());
        assertThrows(InvalidRequestException.class, () -> service.diagnosis(INST, null, "WEEKLY", oldest, false));
        String weekFits = today.minusDays(83).toString();
        EngagementDiagnosis w = service.diagnosis(INST, null, "WEEKLY", weekFits, false);
        assertEquals(oldest, w.from());
        assertEquals(weekFits, w.to());
        assertEquals(7, w.days());
    }

    @Test
    void anUnknownEngineStays404() {
        when(reportService.daily(eq(INST), eq("nope"), any(), anyString(), anyString(), eq(false), eq(false)))
                .thenThrow(new ResourceNotFoundException("Engagement engine not found: nope"));

        assertThrows(ResourceNotFoundException.class, () -> service.diagnosis(INST, "nope", "DAILY", null, false));
    }

    @Test
    void theReportIsReadForThePeriodNeverAsSuperAdmin() {
        service.diagnosis(INST, ENGINE, "WEEKLY", null, false);

        verify(reportService).daily(INST, ENGINE, null, today.minusDays(6).toString(), today.toString(), false, false);
    }

    // ── cache ──

    @Test
    void aCompleteDiagnosisIsCachedUntilFreshAsksAgain() {
        EngagementDiagnosis first = service.diagnosis(INST, null, "DAILY", null, false);

        assertSame(first, service.diagnosis(INST, null, "DAILY", null, false));
        assertFalse(first == service.diagnosis(INST, null, "DAILY", null, true));
        verify(reportService).daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(true));
    }

    @Test
    void anIncompleteDiagnosisIsNotCached() {
        when(dao.leads(any())).thenThrow(new RuntimeException("timeout"));

        EngagementDiagnosis first = service.diagnosis(INST, null, "DAILY", null, false);

        assertFalse(first == service.diagnosis(INST, null, "DAILY", null, false));
    }

    // ── sections that fail ──

    @Test
    void theDailyReportFailingMakesEveryStageUnavailable() {
        when(reportService.daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(false)))
                .thenThrow(new RuntimeException("db down"));

        EngagementDiagnosis d = service.diagnosis(INST, null, "WEEKLY", null, false);

        assertEquals(Map.of("report", "unavailable"), d.errors());
        d.stages().forEach(s -> assertEquals("UNAVAILABLE", s.status(), s.stage()));
        assertTrue(d.problems().isEmpty());
        assertNull(d.weekly().callLengths());
        assertNull(d.weekly().engineChecks().doubleContact());
    }

    @Test
    void aFailedSectionIsNamedAndItsStageIsUnavailable() {
        when(dao.leads(any())).thenThrow(new RuntimeException("timeout"));

        EngagementDiagnosis d = service.diagnosis(INST, null, "DAILY", null, false);

        assertEquals(Map.of("leadDetails", "unavailable"), d.errors());
        assertEquals("UNAVAILABLE", status(d, "LEADS"));
        assertEquals("NO_ACTIVITY", status(d, "CALLING"));
    }

    @Test
    void theReportsOwnFailedSectionsCarryOverOnlyWhenTheDiagnosisReadsThem() {
        Map<String, String> errors = new LinkedHashMap<>();
        errors.put("calls", "unavailable");
        errors.put("revenue", "unavailable");
        report(errors, List.of(new EngineOption(ENGINE, "Outreach", "ACTIVE", false)));

        EngagementDiagnosis d = service.diagnosis(INST, null, "DAILY", null, false);

        assertEquals(Map.of("calls", "unavailable"), d.errors());
        assertEquals("UNAVAILABLE", status(d, "CALLING"));
    }

    @Test
    void signalsFailingLeaveTheMessageStagesUnavailableNotZero() {
        when(dao.actions(any(), any(), any())).thenReturn(List.of(sentEmail("a")));
        when(signals.fetch(eq(INST), anyList(), anyInt())).thenThrow(new RuntimeException("503"));

        EngagementDiagnosis d = service.diagnosis(INST, null, "WEEKLY", null, false);

        assertEquals(Map.of("delivery", "unavailable", "replies", "unavailable"), d.errors());
        assertEquals("UNAVAILABLE", status(d, "WHATSAPP"));
        assertEquals("UNAVAILABLE", status(d, "EMAIL"));
        assertEquals("UNAVAILABLE", status(d, "ENGINE"));
        assertEquals("UNAVAILABLE", status(d, "LEADS"));
        assertNull(d.weekly().engineChecks().sentAfterReply());
        assertTrue(d.weekly().emailSubjects().isEmpty());
        assertTrue(d.dataGaps().isEmpty());
    }

    @Test
    void whenTheReportCouldNotReadDeliveryItIsNotReadAgain() {
        Map<String, String> errors = new LinkedHashMap<>();
        errors.put("delivery", "too_many");
        errors.put("replies", "too_many");
        report(errors, List.of(new EngineOption(ENGINE, "Outreach", "ACTIVE", false)));
        when(dao.actions(any(), any(), any())).thenReturn(List.of(sentEmail("a")));

        EngagementDiagnosis d = service.diagnosis(INST, null, "DAILY", null, false);

        verify(signals, never()).fetch(anyString(), anyList(), anyInt());
        assertEquals("too_many", d.errors().get("delivery"));
        assertEquals("UNAVAILABLE", status(d, "EMAIL"));
    }

    @Test
    void tooManyMessagesAreNotRead() {
        List<ActionRow> many = new ArrayList<>();
        for (int i = 0; i <= EngagementDailyReportService.MAX_SIGNAL_ACTIONS; i++) many.add(sentEmail("a" + i));
        when(dao.actions(any(), any(), any())).thenReturn(many);

        EngagementDiagnosis d = service.diagnosis(INST, null, "DAILY", null, false);

        verify(signals, never()).fetch(anyString(), anyList(), anyInt());
        assertEquals(Map.of("delivery", "too_many", "replies", "too_many"), d.errors());
        assertEquals("UNAVAILABLE", status(d, "EMAIL"));
    }

    @Test
    void noEnginesMeansNothingHappenedNotAFailure() {
        report(new LinkedHashMap<>(), List.of());

        EngagementDiagnosis d = service.diagnosis(INST, null, "WEEKLY", null, false);

        assertTrue(d.errors().isEmpty());
        d.stages().forEach(s -> assertEquals("NO_ACTIVITY", s.status(), s.stage()));
        verify(dao, never()).leads(any());
        assertEquals(0L, d.weekly().engineChecks().stuckMembers());
    }

    // ── what signals say ──

    @Test
    void anOlderSignalsServerMeansNothingIsUnreachable() {
        when(dao.actions(any(), any(), any())).thenReturn(List.of(sentEmail("a")));
        when(signals.fetch(eq(INST), anyList(), anyInt())).thenReturn(new Signals(true, Map.of(
                "a", new Signal("EMAIL", "x@y.com", 1L, "Hi", null, null, null, null, null, null, null, null, null, null,
                        true, false, false, false, false, true, null))));

        assertTrue(service.diagnosis(INST, null, "DAILY", null, false).dataGaps().isEmpty());
    }

    @Test
    void gapsSaySoWhenRepliesAndTrackingCannotBeSeen() {
        when(dao.actions(any(), any(), any())).thenReturn(List.of(sentEmail("a")));
        when(signals.fetch(eq(INST), anyList(), anyInt())).thenReturn(new Signals(true, Map.of(
                "a", new Signal("EMAIL", "x@y.com", 1L, "Hi", null, null, null, null, null, null, null, null, null, null,
                        true, false, false, false, false, true, null, "hello@gmail.example")),
                Set.of("hello@gmail.example")));
        EngagementDailyReport r = emptyReport(new LinkedHashMap<>(),
                List.of(new EngineOption(ENGINE, "Outreach", "ACTIVE", false)),
                new Email(3, 0, 0, 0, 0, 0, 0, false, false), new WhatsApp(2, 0, 0, 0, 0, false, 0, List.of()), null);
        when(reportService.daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(false))).thenReturn(r);

        EngagementDiagnosis d = service.diagnosis(INST, null, "DAILY", null, false);

        assertEquals(List.of("EMAIL_REPLIES_NOT_TRACKED", "EMAIL_TRACKING_OFF", "WHATSAPP_TRACKING_OFF"),
                d.dataGaps().stream().map(EngagementDiagnosis.DataGap::code).toList());
        assertEquals(List.of("hello@gmail.example"), d.dataGaps().get(0).names());
    }

    // ── the contract ──

    @Test
    void theJsonIsWhatTheDashboardReads() throws Exception {
        JsonNode daily = new ObjectMapper().valueToTree(service.diagnosis(INST, null, "DAILY", null, false));

        for (String field : List.of("view", "from", "to", "days", "timezone", "engineId", "generatedAt", "problems",
                "moreProblems", "stages", "dataGaps", "weekly", "errors")) {
            assertTrue(daily.has(field), field);
        }
        assertTrue(daily.get("weekly").isNull());
        assertTrue(daily.get("engineId").isNull());
        assertEquals(5, daily.get("stages").size());

        JsonNode weekly = new ObjectMapper().valueToTree(service.diagnosis(INST, null, "WEEKLY", null, false)).get("weekly");
        assertEquals(30, weekly.at("/minimums/leadsPerSource").asInt());
        assertEquals(20, weekly.at("/minimums/callsPerHour").asInt());
        assertEquals(100, weekly.at("/minimums/sendsPerRow").asInt());
        for (String field : List.of("connected", "under20s", "s20to60", "over60")) {
            assertTrue(weekly.get("callLengths").has(field), field);
        }
        for (String field : List.of("analysed", "sentiment", "outcomes", "highLikelihood", "topObjections")) {
            assertTrue(weekly.get("callInsights").has(field), field);
        }
        assertEquals(0, weekly.at("/engineChecks/doubleContact").asInt());
        assertNotNull(weekly.get("promptChanges"));
    }

    @Test
    void aProblemCarriesItsNumbersAndLink() {
        EngagementDailyReport r = emptyReport(new LinkedHashMap<>(),
                List.of(new EngineOption(ENGINE, "Outreach", "ACTIVE", false)),
                new Email(0, 0, 0, 0, 0, 0, 0, true, true), new WhatsApp(0, 0, 0, 0, 0, true, 0, List.of()), 1.0);
        when(reportService.daily(eq(INST), any(), any(), anyString(), anyString(), eq(false), eq(false))).thenReturn(r);

        JsonNode p = new ObjectMapper().valueToTree(service.diagnosis(INST, null, "DAILY", null, false)).at("/problems/0");

        assertEquals("CREDITS_LOW", p.get("code").asText());
        assertEquals("ENGINE", p.get("stage").asText());
        assertEquals("critical", p.get("severity").asText());
        assertEquals(1.0, p.at("/numbers/runwayDays").asDouble());
        assertTrue(p.get("link").isNull());
        assertTrue(p.get("breakdown").isArray());
        assertTrue(p.get("names").isArray());
    }
}
