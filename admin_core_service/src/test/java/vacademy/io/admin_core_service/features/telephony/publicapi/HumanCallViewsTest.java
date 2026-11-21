package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.entity.CallIntelligence;
import vacademy.io.admin_core_service.features.call_intelligence.persistence.repository.CallIntelligenceRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.CallDispositionCatalog;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.CallDispositionCatalogRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HumanCallViewsTest {

    private HumanCallApiCallRepository calls;
    private TelephonyCallLogRepository logs;
    private CallIntelligenceRepository intelligence;
    private CallDispositionCatalogRepository catalog;
    private TelephonyConfigCache cache;
    private MediaService media;
    private NamedParameterJdbcTemplate jdbc;
    private HumanCallViews views;

    @BeforeEach
    void setUp() {
        calls = mock(HumanCallApiCallRepository.class);
        logs = mock(TelephonyCallLogRepository.class);
        intelligence = mock(CallIntelligenceRepository.class);
        catalog = mock(CallDispositionCatalogRepository.class);
        cache = mock(TelephonyConfigCache.class);
        media = mock(MediaService.class);
        jdbc = mock(NamedParameterJdbcTemplate.class);
        views = new HumanCallViews(calls, logs, intelligence, catalog, cache, media, jdbc);
        InstituteTelephonyConfig cfg = InstituteTelephonyConfig.builder().instituteId("inst-1").providerType("PLIVO")
                .enabled(true).recordCalls(true).build();
        when(cache.get("inst-1")).thenReturn(Optional.of(TelephonyConfigCache.Resolved.builder().config(cfg)
                .enabledNumbers(List.of()).build()));
        when(intelligence.findByCallLogId(anyString())).thenReturn(Optional.empty());
    }

    private static HumanCallApiCall row(boolean analyze) {
        return HumanCallApiCall.builder().id("hcall_1").instituteId("inst-1").counsellorUserId("c-1")
                .counsellorName("Priya").counsellorEmail("priya@school.in").phoneNumber("+919876543210")
                .callLogId("log-1").analysisRequested(analyze).createdAt(Instant.now().minusSeconds(120)).build();
    }

    private TelephonyCallLog log(String provider, String status, Instant created) {
        TelephonyCallLog l = TelephonyCallLog.builder().id("log-1").instituteId("inst-1").providerType(provider)
                .status(status).build();
        l.setCreatedAt(Timestamp.from(created));
        when(logs.findById("log-1")).thenReturn(Optional.of(l));
        return l;
    }

    @Test
    void liveStatusesMapToThePublicVocabulary() {
        assertEquals("queued", HumanCallViews.liveStatus("INITIATED"));
        assertEquals("queued", HumanCallViews.liveStatus("QUEUED"));
        assertEquals("ringing_counsellor", HumanCallViews.liveStatus("COUNSELLOR_RINGING"));
        assertEquals("connecting", HumanCallViews.liveStatus("COUNSELLOR_ANSWERED"));
        assertEquals("in_progress", HumanCallViews.liveStatus("IN_PROGRESS"));
    }

    @Test
    void terminalStatusesAreFinal() {
        Map<String, String> expected = Map.of("NO_ANSWER", "no_answer", "BUSY", "busy", "FAILED", "failed",
                "CANCELLED", "canceled");
        for (Map.Entry<String, String> e : expected.entrySet()) {
            log("PLIVO", e.getKey(), Instant.now().minusSeconds(60));
            HumanCallViews.State s = views.state(row(false));
            assertEquals(e.getValue(), s.status());
            assertTrue(s.isFinal(), e.getKey());
        }
        verify(calls, atLeastOnce()).setTerminalSeenAtIfNull(eq("hcall_1"), any());
    }

    @Test
    void aConnectedCallWaitsForItsRecording() {
        TelephonyCallLog l = log("PLIVO", "COMPLETED", Instant.now().minusSeconds(200));
        HumanCallApiCall justEnded = row(false);
        justEnded.setTerminalSeenAt(Instant.now().minusSeconds(30));
        assertFalse(views.state(justEnded).isFinal());
        l.setRecordingStorageKey("file-1");
        assertTrue(views.state(justEnded).isFinal());
        l.setRecordingStorageKey(null);
        justEnded.setTerminalSeenAt(Instant.now().minus(HumanCallViews.RECORDING_WAIT).minusSeconds(5));
        assertTrue(views.state(justEnded).isFinal(), "gives up waiting for the recording");
    }

    @Test
    void aCallThatNeverEndsIsFailedButAirtelGetsADay() {
        log("EXOTEL", "QUEUED", Instant.now().minus(Duration.ofHours(3)));
        HumanCallViews.State s = views.state(row(false));
        assertEquals("failed", s.status());
        assertEquals(HumanCallViews.NO_RESULT, s.reason());
        log("AIRTEL", "QUEUED", Instant.now().minus(Duration.ofHours(3)));
        assertEquals("queued", views.state(row(false)).status());
    }

    @Test
    void aRowNeverDialledIsQueuedThenFailed() {
        HumanCallApiCall c = row(false);
        c.setCallLogId(null);
        c.setCreatedAt(Instant.now());
        assertEquals("queued", views.state(c).status());
        c.setCreatedAt(Instant.now().minus(Duration.ofMinutes(10)));
        HumanCallViews.State s = views.state(c);
        assertEquals("failed", s.status());
        assertTrue(s.isFinal());
    }

    @Test
    void whoDidNotAnswerIsReportedOnlyWhenTheProviderSaysSo() {
        assertEquals("contact", HumanCallViews.noAnswerBy("EXOTEL", "NO_ANSWER",
                "CallSid=1&Status=completed&DialCallStatus=no-answer"));
        assertEquals("counsellor", HumanCallViews.noAnswerBy("EXOTEL", "NO_ANSWER", "CallSid=1&Status=no-answer"));
        assertEquals("counsellor", HumanCallViews.noAnswerBy("EXOTEL", "BUSY", "{\"Status\":\"busy\"}"));
        assertEquals("contact", HumanCallViews.noAnswerBy("PLIVO", "NO_ANSWER",
                "CallUUID=x&DialBLegStatus=no-answer"));
        assertNull(HumanCallViews.noAnswerBy("PLIVO", "NO_ANSWER", "CallUUID=x&CallStatus=no-answer"));
        assertNull(HumanCallViews.noAnswerBy("AIRTEL", "NO_ANSWER", "anything"));
        assertNull(HumanCallViews.noAnswerBy("EXOTEL", "COMPLETED", "Status=completed"));
        assertNull(HumanCallViews.noAnswerBy("EXOTEL", "NO_ANSWER", null));
    }

    @Test
    void statusUpdatesDependOnTheProvider() {
        assertEquals("realtime", HumanCallViews.statusUpdates("PLIVO"));
        assertEquals("final_only", HumanCallViews.statusUpdates("EXOTEL"));
        assertEquals("delayed", HumanCallViews.statusUpdates("AIRTEL"));
    }

    @Test
    void timesAreNeverInTheFuture() {
        Instant now = Instant.now();
        TelephonyCallLog l = TelephonyCallLog.builder().id("l").durationSeconds(90).build();
        l.setEndTime(Timestamp.from(now.plusSeconds(3600)));        // a provider clock in another zone
        l.setAnswerTime(Timestamp.from(now.plusSeconds(3500)));
        HumanCallApiCall c = row(false);
        Instant seen = now.minusSeconds(5);
        Instant ended = HumanCallViews.endedAt(c, l, seen, 90, now);
        assertEquals(seen, ended);
        Instant answered = HumanCallViews.answeredAt(l, "completed", ended, 90, now);
        assertEquals(seen.minusSeconds(90), answered);
    }

    @Test
    void theObjectCarriesCounsellorDispositionCostAndNoInternalIds() {
        TelephonyCallLog l = log("EXOTEL", "COMPLETED", Instant.now().minusSeconds(300));
        l.setRecordingStorageKey("file-1");
        l.setDurationSeconds(140);
        l.setDispositionKey("INTERESTED");
        l.setDispositionNotes("demo Friday");
        l.setDispositionedBy("api:abc");
        l.setDispositionedAt(Timestamp.from(Instant.now().minusSeconds(10)));
        when(media.getFilePublicUrlById("file-1")).thenReturn("https://cdn.example/rec.mp3");
        CallDispositionCatalog d = new CallDispositionCatalog();
        d.setLabel("Interested");
        when(catalog.findByInstituteIdAndDispositionKey("inst-1", "INTERESTED")).thenReturn(Optional.of(d));
        HumanCallApiCall c = row(false);
        c.setTerminalSeenAt(Instant.now().minusSeconds(60));
        Map<String, Object> m = views.view(c);
        assertEquals("human_call", m.get("object"));
        assertEquals("completed", m.get("status"));
        assertEquals(Map.of("id", "c-1", "name", "Priya", "email", "priya@school.in"), m.get("counsellor"));
        assertEquals("final_only", m.get("status_updates"));
        assertEquals("https://cdn.example/rec.mp3", m.get("recording_url"));
        assertNotNull(m.get("recording_expires_at"));
        @SuppressWarnings("unchecked")
        Map<String, Object> disposition = (Map<String, Object>) m.get("disposition");
        assertEquals("Interested", disposition.get("label"));
        assertEquals("api", disposition.get("set_by"));
        assertEquals(Map.of("credits", 0.0, "billed", true, "note", "billed_by_provider"), m.get("cost"));
        assertEquals(Map.of("status", "not_requested"), m.get("analysis"));
        assertFalse(m.containsKey("call_log_id"));
        assertFalse(m.containsKey("no_answer_by"));
    }

    @Test
    void plivoTalkTimeIsReadFromTheLedger() {
        TelephonyCallLog l = log("PLIVO", "COMPLETED", Instant.now().minusSeconds(300));
        l.setDurationSeconds(95);
        l.setCreditsBilledAt(Instant.now());
        when(jdbc.queryForObject(anyString(), any(MapSqlParameterSource.class), eq(BigDecimal.class)))
                .thenReturn(new BigDecimal("2.5"));
        HumanCallViews.State s = new HumanCallViews.State("completed", true, null, null, l, Instant.now());
        assertEquals(Map.of("credits", 2.5, "billed", true), views.cost("inst-1", l, s));
        l.setCreditsBilledAt(null);
        assertEquals(false, views.cost("inst-1", l, s).get("billed"));
        assertNull(views.cost("inst-1", l, new HumanCallViews.State("in_progress", false, null, null, l, null)));
    }

    @Test
    void analysisFollowsCallIntelligence() {
        TelephonyCallLog l = TelephonyCallLog.builder().id("log-1").status("COMPLETED").recordingStorageKey("f").build();
        HumanCallViews.State done = new HumanCallViews.State("completed", true, null, null, l, Instant.now());
        HumanCallApiCall asked = row(true);
        assertEquals("pending", HumanCallViews.analysis(asked, done, null, Instant.now()).get("status"));
        assertEquals("not_requested", HumanCallViews.analysis(row(false), done, null, Instant.now()).get("status"));

        CallIntelligence ci = CallIntelligence.builder().status("COMPLETED").generalSummary("Wants the weekend batch.")
                .leadSentiment("POSITIVE").callerSelfGoalRating(new BigDecimal("7.5"))
                .creditsCharged(new BigDecimal("0.45")).build();
        Map<String, Object> a = HumanCallViews.analysis(asked, done, ci, Instant.now());
        assertEquals("completed", a.get("status"));
        assertEquals("Wants the weekend batch.", a.get("summary"));
        assertEquals("POSITIVE", a.get("sentiment"));
        assertEquals(7.5, a.get("counsellor_rating"));
        assertTrue(HumanCallViews.analysisFinal(a));

        // FAILED is a retry in waiting until ai_service has claimed it CI_MAX_ATTEMPTS times.
        ci.setStatus("FAILED");
        ci.setAttempts(1);
        assertEquals(Map.of("status", "pending"), HumanCallViews.analysis(asked, done, ci, Instant.now()));
        assertFalse(HumanCallViews.analysisFinal(HumanCallViews.analysis(asked, done, ci, Instant.now())));
        ci.setAttempts(HumanCallViews.CI_MAX_ATTEMPTS);
        assertEquals(Map.of("status", "failed", "reason", "analysis_error"),
                HumanCallViews.analysis(asked, done, ci, Instant.now()));
        ci.setAttempts(1);
        ci.setStatus("SKIPPED");
        ci.setSkipReason("INSUFFICIENT_CREDITS");
        assertEquals(Map.of("status", "failed", "reason", "insufficient_credits"),
                HumanCallViews.analysis(asked, done, ci, Instant.now()));

        HumanCallViews.State missed = new HumanCallViews.State("no_answer", true, null, null, l, Instant.now());
        assertEquals("not_connected", HumanCallViews.analysis(asked, missed, null, Instant.now()).get("reason"));
        TelephonyCallLog noRec = TelephonyCallLog.builder().id("log-1").status("COMPLETED").build();
        HumanCallViews.State unrecorded = new HumanCallViews.State("completed", true, null, null, noRec, Instant.now());
        assertEquals("no_recording", HumanCallViews.analysis(asked, unrecorded, null, Instant.now()).get("reason"));
    }

    @Test
    void theListFiltersSqlMirrorsTheViewsMapping() {
        String sql = HumanCallApiCallRepository.PUBLIC_STATUS_SQL.replaceAll("\\s+", " ");
        java.util.Map<String, String> all = new java.util.HashMap<>(HumanCallViews.TERMINAL_STATUS);
        all.putAll(HumanCallViews.LIVE_STATUS);
        for (Map.Entry<String, String> e : all.entrySet()) {
            assertTrue(sql.contains("WHEN l.status = '" + e.getKey() + "' THEN '" + e.getValue() + "'"), e.getKey());
        }
        // Terminal statuses are decided before the stuck cut-off, live ones after it, and
        // anything unknown is queued — as in state().
        int stuck = sql.indexOf("l.created_at <");
        for (String terminal : HumanCallViews.TERMINAL_STATUS.keySet()) {
            assertTrue(sql.indexOf("'" + terminal + "'") < stuck, terminal);
        }
        for (String live : HumanCallViews.LIVE_STATUS.keySet()) assertTrue(sql.indexOf("'" + live + "'") > stuck, live);
        assertTrue(sql.contains("WHEN l.id IS NULL THEN CASE WHEN h.created_at >= CAST(:creatingSince AS timestamptz) THEN 'queued' ELSE 'failed' END"));
        assertTrue(sql.contains("ELSE 'queued' END"));
        assertTrue(sql.contains("l.provider_type = 'AIRTEL' THEN CAST(:airtelStuckBefore AS timestamp)"));
    }
}
