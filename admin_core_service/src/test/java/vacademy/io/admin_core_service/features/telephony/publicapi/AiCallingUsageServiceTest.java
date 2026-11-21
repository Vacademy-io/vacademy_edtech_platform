package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class AiCallingUsageServiceTest {

    private static TelephonyCallLog log(String provider, Instant billedAt) {
        return TelephonyCallLog.builder().id("l1").providerType(provider).status("COMPLETED").durationSeconds(95)
                .creditsBilledAt(billedAt).build();
    }

    private static AiCallResult result(String provider, String status, Instant billedAt) {
        return AiCallResult.builder().id("r1").callLogId("l1").provider(provider).status(status)
                .processingStatus("PROCESSED").callUuid("uuid-1").durationSeconds(95).creditsBilledAt(billedAt).build();
    }

    @Test
    void anAavtaarCallHasNoVoiceLegToWaitFor() {
        // AAVTAAR rides its own trunk: CallLogService never charges (or stamps) a voice leg.
        assertFalse(AiCallingUsageService.voiceLegPending(log("AAVTAAR", null)));
        assertTrue(AiCallingUsageService.aiLegPending(result("AAVTAAR", "completed", null)));
        assertFalse(AiCallingUsageService.aiLegPending(result("AAVTAAR", "completed", Instant.now())));
    }

    @Test
    void aVacademyCallIsBilledOnlyOnceBothLegsAreCharged() {
        assertTrue(AiCallingUsageService.voiceLegPending(log("VACADEMY_AI", null)));
        assertFalse(AiCallingUsageService.voiceLegPending(log("VACADEMY_AI", Instant.now())));
        assertTrue(AiCallingUsageService.aiLegPending(result("VACADEMY_AI", "completed", null)));
    }

    @Test
    void aReportThatIsNeverChargedIsNotWaitedFor() {
        // Not completed by the bot's own status, unverified, MOCK, or no stable identity:
        // CallBillingService never charges these, so they must not read "not yet billed".
        assertFalse(AiCallingUsageService.aiLegPending(result("VACADEMY_AI", "no-answer", null)));
        AiCallResult unverified = result("VACADEMY_AI", "completed", null);
        unverified.setProcessingStatus("REJECTED_UNVERIFIED");
        assertFalse(AiCallingUsageService.aiLegPending(unverified));
        assertFalse(AiCallingUsageService.aiLegPending(result("MOCK", "completed", null)));
        AiCallResult noIdentity = result("VACADEMY_AI", "completed", null);
        noIdentity.setCallUuid(null);
        assertFalse(AiCallingUsageService.aiLegPending(noIdentity));
        noIdentity.setCorrelationId("l1");
        assertTrue(AiCallingUsageService.aiLegPending(noIdentity));
        assertFalse(AiCallingUsageService.aiLegPending(null));
    }

    @Test
    void costOfCallUsesThePerProviderRule() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), any(MapSqlParameterSource.class), eq(BigDecimal.class)))
                .thenReturn(new BigDecimal("12.5"));
        AiCallingUsageService usage = new AiCallingUsageService(jdbc, null);
        AiCallApiCall c = AiCallApiCall.builder().id("call_1").instituteId("inst-1").build();

        Map<String, Object> billed = usage.costOfCall(c, log("VACADEMY_AI", Instant.now()),
                result("VACADEMY_AI", "completed", Instant.now()));
        assertEquals(12.5, billed.get("credits"));
        assertEquals(true, billed.get("billed"));
        // The AI leg still owed: not billed, although the voice leg is stamped.
        assertEquals(false, usage.costOfCall(c, log("VACADEMY_AI", Instant.now()),
                result("VACADEMY_AI", "completed", null)).get("billed"));
        // A report the biller skips (bot status not completed) does not hold "billed" back forever.
        assertEquals(true, usage.costOfCall(c, log("VACADEMY_AI", Instant.now()),
                result("VACADEMY_AI", "no-answer", null)).get("billed"));
    }

    @Test
    void usageCountsUnbilledFromTheQuery() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.queryForList(anyString(), any(MapSqlParameterSource.class))).thenReturn(List.of(Map.of(
                "day", "2026-10-14", "calls", 3L, "connected", 2L, "seconds", 180L,
                "credits", new BigDecimal("20.00"), "unbilled", 1L)));
        AiCallingUsageService usage = new AiCallingUsageService(jdbc, null);
        Map<String, Object> out = usage.usage("inst-1", "2026-10-14", "2026-10-14", "UTC", "all");
        @SuppressWarnings("unchecked")
        Map<String, Object> totals = (Map<String, Object>) out.get("totals");
        assertEquals(1L, totals.get("calls_not_yet_billed"));
        verify(jdbc).queryForList(argThatSqlMentions("r.provider IN ('VACADEMY_AI', 'AAVTAAR')",
                "l.provider_type IN ('PLIVO', 'VACADEMY_AI')"), any(MapSqlParameterSource.class));
    }

    @Test
    void humanCallFiguresAreAddedAfterTheAiFields() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.queryForList(anyString(), any(MapSqlParameterSource.class))).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            if (sql.contains("human_call_api_call")) {
                return List.of(Map.of("day", "2026-10-14", "calls", 5L, "connected", 4L, "seconds", 600L,
                        "credits", new BigDecimal("10.00"), "unbilled", 0L));
            }
            return List.of(Map.of("day", "2026-10-14", "calls", 3L, "connected", 2L, "seconds", 180L,
                    "credits", new BigDecimal("20.00"), "unbilled", 1L));
        });
        AiCallingUsageService usage = new AiCallingUsageService(jdbc, null);
        Map<String, Object> out = usage.usage("inst-1", "2026-10-14", "2026-10-14", "UTC", "api");
        // v1.1 keys unchanged and in order; human_calls only appended.
        assertEquals(List.of("object", "source", "from", "to", "timezone", "totals", "days", "human_calls"),
                List.copyOf(out.keySet()));
        @SuppressWarnings("unchecked")
        Map<String, Object> ai = (Map<String, Object>) out.get("totals");
        assertEquals(3L, ai.get("calls"));
        @SuppressWarnings("unchecked")
        Map<String, Object> human = (Map<String, Object>) ((Map<String, Object>) out.get("human_calls")).get("totals");
        assertEquals(5L, human.get("calls"));
        assertEquals(4L, human.get("connected"));
        assertEquals(600L, human.get("talk_seconds"));
        assertEquals(10.0, human.get("credits"));
        // Placed calls only: uploaded recordings (provider MANUAL) are not human calls placed.
        verify(jdbc).queryForList(argThatSqlMentions("l.counsellor_user_id IS NOT NULL",
                "l.provider_type IN ('PLIVO', 'EXOTEL', 'AIRTEL')", "'voice_call:' || logs.id"),
                any(MapSqlParameterSource.class));
    }

    private static String argThatSqlMentions(String... parts) {
        return org.mockito.ArgumentMatchers.argThat(sql -> {
            for (String part : parts) if (sql == null || !sql.contains(part)) return false;
            return true;
        });
    }
}
