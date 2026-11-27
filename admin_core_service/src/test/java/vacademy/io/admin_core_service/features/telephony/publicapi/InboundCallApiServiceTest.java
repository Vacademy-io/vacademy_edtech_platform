package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Inbound calls in GET /v1/calls (v1.4): the direction switch keeps the default list
 * unchanged, inbound rows come from the call log under inb_ ids, and direction=all merges
 * both kinds newest first.
 */
class InboundCallApiServiceTest {

    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal("inst-1", "key-1", List.of("calls:read", "calls:write"));
    private static final Instant T0 = Instant.parse("2026-11-27T10:00:00Z");

    private final NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
    private final TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
    private final AiCallResultRepository results = mock(AiCallResultRepository.class);
    private final AiCallApiCallRepository apiCalls = mock(AiCallApiCallRepository.class);
    private final AiCallingApiViews views = mock(AiCallingApiViews.class);
    private final AiCallingUsageService usage = mock(AiCallingUsageService.class);
    private final InboundCallApiService service =
            new InboundCallApiService(jdbc, logs, results, apiCalls, views, usage);

    private static TelephonyCallLog inbound(String id, String status, Instant createdAt) {
        TelephonyCallLog l = TelephonyCallLog.builder().id(id).instituteId("inst-1").providerType("PLIVO")
                .direction("INBOUND").status(status).fromNumber("+919811111111").toNumber("+918022222222")
                .ivrSelection("1 - Admissions").build();
        l.setCreatedAt(Timestamp.from(createdAt));
        return l;
    }

    @Test
    void directionDefaultsToOutboundAndRejectsAnythingElse() {
        assertEquals("outbound", InboundCallApiService.normaliseDirection(null));
        assertEquals("all", InboundCallApiService.normaliseDirection(" ALL "));
        assertEquals("inbound", InboundCallApiService.normaliseDirection("inbound"));
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> InboundCallApiService.normaliseDirection("incoming"));
        assertEquals("invalid_request", e.getCode());
    }

    @Test
    void statusFollowsTheCallLog() {
        Instant now = Instant.now();
        assertEquals("completed", InboundCallApiService.state(inbound("l", "COMPLETED", now), now).status());
        TelephonyCallLog missed = inbound("l", "NO_ANSWER", now);
        missed.setTerminationReason("NO_COUNSELLOR_ANSWERED");
        assertEquals(new InboundCallApiService.State("no_answer", "NO_COUNSELLOR_ANSWERED"),
                InboundCallApiService.state(missed, now));
        assertEquals("ringing", InboundCallApiService.state(inbound("l", "INITIATED", now), now).status());
        assertEquals("in_progress", InboundCallApiService.state(inbound("l", "IN_PROGRESS", now), now).status());
        // Never reported an end: lost after 2 h, except Airtel whose rows settle at the CDR import.
        TelephonyCallLog stuck = inbound("l", "INITIATED", now.minus(Duration.ofHours(3)));
        assertEquals(new InboundCallApiService.State("failed", InboundCallApiService.NO_RESULT),
                InboundCallApiService.state(stuck, now));
        stuck.setProviderType("AIRTEL");
        assertEquals("ringing", InboundCallApiService.state(stuck, now).status());
    }

    @Test
    void theObjectNamesTheCallerTheNumberAndWhoAnswered() {
        TelephonyCallLog l = inbound("log-1", "COMPLETED", T0);
        l.setDurationSeconds(120);
        l.setAnswerTime(Timestamp.from(T0.plusSeconds(5)));
        l.setEndTime(Timestamp.from(T0.plusSeconds(125)));
        AiCallResult r = AiCallResult.builder().id("r1").callLogId("log-1").provider("VACADEMY_AI")
                .campaignId("agent-7").customerName("Asha").processingStatus("PROCESSED").build();
        Map<String, Object> cost = Map.of("credits", 6.0, "billed", true);
        when(usage.costOfCallLog("inst-1", l, r)).thenReturn(cost);
        when(views.outcome(r)).thenReturn(Map.of("disposition", "Interested"));

        Map<String, Object> m = service.view("inst-1", l, r);
        assertEquals("inb_log-1", m.get("id"));
        assertEquals("inbound_call", m.get("object"));
        assertEquals("inbound", m.get("direction"));
        assertEquals("completed", m.get("status"));
        assertEquals("+919811111111", m.get("phone_number"));
        assertEquals("+918022222222", m.get("called_number"));
        assertEquals("1 - Admissions", m.get("ivr_selection"));
        assertEquals("ai_agent", m.get("handled_by"));
        assertEquals("agent-7", m.get("agent_id"));
        assertEquals(Map.of("name", "Asha"), m.get("contact"));
        assertEquals(120, m.get("duration_seconds"));
        assertEquals(T0.plusSeconds(5).toString(), m.get("answered_at"));
        assertEquals(T0.plusSeconds(125).toString(), m.get("ended_at"));
        assertSame(cost, m.get("cost"));
        assertEquals(Map.of("disposition", "Interested"), m.get("outcome"));
        assertFalse(m.containsKey("call_log_id"));
    }

    @Test
    void aRowCreatedFromAnAiReportHasTheCallerInToNumber() {
        TelephonyCallLog l = inbound("log-2", "NO_ANSWER", T0);
        l.setFromNumber(null);
        l.setToNumber("+919833333333");
        l.setCounsellorUserId("c-1");
        Map<String, Object> m = service.view("inst-1", l, null);
        assertEquals("+919833333333", m.get("phone_number"));
        assertNull(m.get("called_number"));
        assertEquals("counsellor", m.get("handled_by"));
        assertNull(m.get("agent_id"));
    }

    @Test
    void getRefusesAnotherInstitutesOrAnOutboundRow() {
        TelephonyCallLog other = inbound("log-3", "COMPLETED", T0);
        other.setInstituteId("inst-2");
        TelephonyCallLog outbound = inbound("log-4", "COMPLETED", T0);
        outbound.setDirection("OUTBOUND");
        when(logs.findById("log-3")).thenReturn(Optional.of(other));
        when(logs.findById("log-4")).thenReturn(Optional.of(outbound));
        assertEquals("not_found", assertThrows(AiCallingApiException.class, () -> service.get(P, "inb_log-3")).getCode());
        assertEquals("not_found", assertThrows(AiCallingApiException.class, () -> service.get(P, "inb_log-4")).getCode());
        assertEquals("not_found", assertThrows(AiCallingApiException.class, () -> service.get(P, "inb_")).getCode());
    }

    @Test
    void allMergesBothKindsNewestFirst() {
        TelephonyCallLog newer = inbound("log-new", "COMPLETED", T0.plusSeconds(60));
        TelephonyCallLog older = inbound("log-old", "NO_ANSWER", T0.minusSeconds(60));
        when(jdbc.queryForList(contains("telephony_call_log l"), any(MapSqlParameterSource.class))).thenReturn(List.of(
                Map.of("id", "log-new", "created_ts", Timestamp.from(T0.plusSeconds(60))),
                Map.of("id", "log-old", "created_ts", Timestamp.from(T0.minusSeconds(60)))));
        AiCallApiCall placed = AiCallApiCall.builder().id("call_abc").instituteId("inst-1").createdAt(T0).build();
        when(apiCalls.page(eq("inst-1"), isNull(), isNull(), isNull(), isNull(), isNull(), anyInt()))
                .thenReturn(List.of(placed));
        when(views.call(placed, false)).thenReturn(Map.of("id", "call_abc", "object", "call"));
        when(logs.findAllById(any())).thenReturn(List.of(newer, older));
        when(results.findByCallLogIdIn(any())).thenReturn(List.of());

        Map<String, Object> out = service.list(P, "all", null, 25, null);
        assertEquals(List.of("inb_log-new", "call_abc", "inb_log-old"), ids(out));
        assertEquals(false, out.get("has_more"));

        Map<String, Object> firstTwo = service.list(P, "all", null, 2, null);
        assertEquals(List.of("inb_log-new", "call_abc"), ids(firstTwo));
        assertEquals(true, firstTwo.get("has_more"));
    }

    @Test
    void inboundAloneNeverReadsTheApiTable() {
        when(jdbc.queryForList(contains("telephony_call_log l"), any(MapSqlParameterSource.class))).thenReturn(List.of(
                Map.of("id", "log-new", "created_ts", Timestamp.from(T0))));
        when(logs.findAllById(any())).thenReturn(List.of(inbound("log-new", "COMPLETED", T0)));
        when(results.findByCallLogIdIn(any())).thenReturn(List.of());
        assertEquals(List.of("inb_log-new"), ids(service.list(P, "inbound", null, 25, null)));
        verify(apiCalls, never()).page(any(), any(), any(), any(), any(), any(), anyInt());
    }

    @Test
    void anInboundCursorPagesBothTablesFromItsTime() {
        when(jdbc.queryForList(contains("created_at AT TIME ZONE 'UTC' AS created_ts FROM telephony_call_log"),
                any(MapSqlParameterSource.class))).thenReturn(List.of(Map.of("created_ts", Timestamp.from(T0))));
        when(jdbc.queryForList(contains("telephony_call_log l"), any(MapSqlParameterSource.class))).thenReturn(List.of());
        when(apiCalls.page(any(), any(), any(), any(), any(), any(), anyInt())).thenReturn(List.of());
        service.list(P, "all", null, 25, "inb_log-x");
        verify(apiCalls).page("inst-1", null, null, null, T0, "inb_log-x", 26);
    }

    @Test
    void anUnknownCursorIsA400() {
        when(jdbc.queryForList(anyString(), any(MapSqlParameterSource.class))).thenReturn(List.of());
        when(apiCalls.findByIdAndInstituteId("call_zzz", "inst-1")).thenReturn(Optional.empty());
        assertEquals("invalid_request", assertThrows(AiCallingApiException.class,
                () -> service.list(P, "inbound", null, 25, "inb_nope")).getCode());
        assertEquals("invalid_request", assertThrows(AiCallingApiException.class,
                () -> service.list(P, "all", null, 25, "call_zzz")).getCode());
    }

    // ── Routes ───────────────────────────────────────────────────────────────────

    @Test
    void theControllerRoutesByDirectionAndIdPrefix() {
        AiCallingApiAuth auth = mock(AiCallingApiAuth.class);
        when(auth.authenticate(any(), any())).thenReturn(P);
        AiCallingApiService calls = mock(AiCallingApiService.class);
        InboundCallApiService inbound = mock(InboundCallApiService.class);
        PublicAiCallingApiController controller = new PublicAiCallingApiController(auth, calls, null, null, null, inbound);
        MockHttpServletRequest r = new MockHttpServletRequest();
        when(calls.listCalls(any(), any(), any(), any(), anyInt(), any())).thenReturn(Map.of("object", "list"));
        when(inbound.list(any(), any(), any(), anyInt(), any())).thenReturn(Map.of("object", "list"));
        when(inbound.get(any(), any())).thenReturn(Map.of("id", "inb_1"));
        when(calls.getCall(any(), any())).thenReturn(Map.of("id", "call_1"));

        // No direction: exactly the old list.
        controller.listCalls(r, null, null, null, 25, null, null);
        verify(calls).listCalls(P, null, null, null, 25, null);
        verifyNoInteractions(inbound);

        controller.listCalls(r, null, null, null, 25, null, "all");
        verify(inbound).list(P, "all", null, 25, null);

        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> controller.listCalls(r, "batch_1", null, null, 25, null, "inbound"));
        assertEquals("invalid_request", e.getCode());

        assertEquals("inb_1", controller.getCall(r, "inb_1").getBody().get("id"));
        assertEquals("call_1", controller.getCall(r, "call_1").getBody().get("id"));

        when(inbound.notCancelable(any(), any())).thenReturn(new AiCallingApiException(
                org.springframework.http.HttpStatus.CONFLICT, "call_not_cancelable", "Inbound calls cannot be canceled."));
        assertEquals("call_not_cancelable",
                assertThrows(AiCallingApiException.class, () -> controller.cancel(r, "inb_1")).getCode());
        verify(calls, never()).cancel(any(), any());
    }

    @SuppressWarnings("unchecked")
    private static List<Object> ids(Map<String, Object> out) {
        return ((List<Map<String, Object>>) out.get("data")).stream().map(d -> d.get("id")).toList();
    }
}
