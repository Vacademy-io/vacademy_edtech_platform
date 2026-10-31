package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

/** Usage-metering fields on call minutes and the agent prompt assistant. */
class CallMeteringFieldsTest {

    @Test
    void aiMinutesAreASystemChargeOnThePhoneSurface() {
        MeteringFields m = CallBillingService.callMetering(CallBillingService.USE_CASE_AI_CALLING,
                "ai_call_result_id", "r-1", "VACADEMY_AI", "OUTBOUND", 95, "agent-1", "sarvam");
        assertEquals("ai_calling", m.useCase());
        assertEquals("SYSTEM", m.actorKind());
        assertEquals("SYSTEM", m.actorRoleClass());
        assertEquals("PHONE", m.surface());
        assertEquals("admin_core", m.sourceService());
        assertEquals(Map.of("ai_call_result_id", "r-1", "provider", "VACADEMY_AI", "direction", "OUTBOUND",
                "duration_seconds", 95, "agent_id", "agent-1", "tts_engine", "sarvam"), m.usageContext());
    }

    @Test
    void telephonyMinutesCarryTheCallLog() {
        MeteringFields m = CallBillingService.callMetering(CallBillingService.USE_CASE_TELEPHONY,
                "call_log_id", "c-1", "PLIVO", "INBOUND", 30, null, null);
        assertEquals("telephony", m.useCase());
        assertEquals("c-1", m.usageContext().get("call_log_id"));
        assertFalse(m.usageContext().containsKey("agent_id"));
        assertFalse(m.usageContext().containsKey("tts_engine"));
    }

    @Test
    void agentAssistIsAnAdminAppChargeWithTheOperation() {
        MeteringFields m = AiAgentAssistService.assistMetering("improve", "Riya");
        assertEquals("agent_assist", m.useCase());
        assertEquals("ADMIN_APP", m.surface());
        assertEquals("USER", m.actorKind(), "a user started it; who is not known this deep");
        assertNull(m.actorRoleClass(), "no role guessed: the ledger SYSTEM label must not become the role");
        assertEquals(Map.of("operation", "improve", "agent_name", "Riya"), m.usageContext());
    }

    @Test
    void aiMinutesCarryTheAgentNameAndLead() {
        MeteringFields m = CallBillingService.callMetering(CallBillingService.USE_CASE_AI_CALLING,
                "ai_call_result_id", "r-1", "VACADEMY_AI", "OUTBOUND", 95, "agent-1", "sarvam", "Riya", "lead-9");
        assertEquals("Riya", m.usageContext().get("agent_name"));
        assertEquals("lead-9", m.usageContext().get("lead_id"));
        MeteringFields none = CallBillingService.callMetering(CallBillingService.USE_CASE_TELEPHONY,
                "call_log_id", "c-1", "PLIVO", "INBOUND", 30, null, null, " ", null);
        assertFalse(none.usageContext().containsKey("agent_name"));
        assertFalse(none.usageContext().containsKey("lead_id"));
    }

    @Test
    void billedMinutesArePulseRounded() {
        MeteringFields base = CallBillingService.callMetering(CallBillingService.USE_CASE_AI_CALLING,
                "ai_call_result_id", "r-1", "VACADEMY_AI", "OUTBOUND", 236, null, null);
        // 236 s at a 30 s pulse = 8 pulses = 240 s = 4.000 billed minutes
        MeteringFields m = CallBillingService.withBilledMinutes(base, 8, 30);
        assertEquals(new java.math.BigDecimal("4.000"), m.usageContext().get("minutes"));
        assertEquals(236, m.usageContext().get("duration_seconds"));
        assertFalse(base.usageContext().containsKey("minutes"), "the input is not mutated");
        // 61 s per-minute = 2 pulses of 60 s = 2.000
        assertEquals(new java.math.BigDecimal("2.000"),
                CallBillingService.withBilledMinutes(base, 2, 60).usageContext().get("minutes"));
        assertNull(CallBillingService.withBilledMinutes(null, 2, 60));
    }
}
