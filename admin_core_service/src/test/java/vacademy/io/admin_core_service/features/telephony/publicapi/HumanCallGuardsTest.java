package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.core.dto.VoiceCallingSettingsPojo;

import java.sql.Timestamp;
import java.time.*;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HumanCallGuardsTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static Instant ist(int hour, int minute) {
        return LocalDate.of(2026, 10, 17).atTime(hour, minute).atZone(IST).toInstant();
    }

    @Test
    void theDefaultWindowIsNineToNineIndiaTime() {
        AiCallingSettingsPojo ai = new AiCallingSettingsPojo();
        VoiceCallingSettingsPojo voice = VoiceCallingSettingsPojo.defaults();
        assertNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(10, 0)));
        assertNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(20, 59)));
        assertNotNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(21, 30)));
        assertNotNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(8, 45)));
        assertEquals(ist(9, 0).plus(Duration.ofDays(1)), HumanCallGuards.nextAllowed(ai, voice, ist(21, 30).plus(Duration.ofHours(1))));
    }

    @Test
    void theInstitutesShiftsApplyAsInTheAiQueue() {
        AiCallingSettingsPojo ai = new AiCallingSettingsPojo();
        ai.setCallingShifts(List.of(new AiCallingSettingsPojo.Shift("10:00", "13:00")));
        VoiceCallingSettingsPojo voice = VoiceCallingSettingsPojo.defaults();
        assertNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(11, 0)));
        assertEquals("It is outside this account's calling hours.",
                HumanCallGuards.callingHoursRefusal(ai, voice, ist(15, 0)));
    }

    @Test
    void theComplianceCutoffCanBeSwitchedOff() {
        AiCallingSettingsPojo ai = new AiCallingSettingsPojo();
        ai.setCallingShifts(List.of());
        VoiceCallingSettingsPojo voice = VoiceCallingSettingsPojo.defaults();
        voice.getCompliance().setNightCutoffEnabled(false);
        assertNull(HumanCallGuards.callingHoursRefusal(ai, voice, ist(23, 0)));
    }

    @Test
    void outsideHoursIsA422WithTheNextAllowedTime() {
        var aiSettings = mock(vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService.class);
        var voiceSettings = mock(vacademy.io.admin_core_service.features.telephony.core.VoiceCallingSettingsService.class);
        when(aiSettings.get("inst-1")).thenReturn(new AiCallingSettingsPojo());
        when(voiceSettings.get("inst-1")).thenReturn(VoiceCallingSettingsPojo.defaults());
        HumanCallGuards g = new HumanCallGuards(aiSettings, voiceSettings, null);
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> g.requireCallingHours("inst-1", ist(22, 10)));
        assertEquals(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, e.getStatus());
        assertEquals("outside_calling_hours", e.getCode());
        assertEquals(ist(9, 0).plus(Duration.ofDays(1)).toString(), ((Map<?, ?>) e.getDetails()).get("next_allowed_at"));
        assertDoesNotThrow(() -> g.requireCallingHours("inst-1", ist(12, 0)));
    }

    private static HumanCallGuards guards(Map<String, Object> row) {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        when(jdbc.queryForMap(anyString(), any(MapSqlParameterSource.class))).thenReturn(row);
        return new HumanCallGuards(null, null, jdbc);
    }

    private static Map<String, Object> row(long placed, long live, Instant lastConnected) {
        Map<String, Object> m = new HashMap<>();
        m.put("placed", placed);
        m.put("live", live);
        m.put("last_connected", lastConnected == null ? null
                : Timestamp.valueOf(LocalDateTime.ofInstant(lastConnected, ZoneOffset.UTC)));
        return m;
    }

    @Test
    void aNumberAlreadyRingingIsAConflict() {
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> guards(row(1, 1, null)).requireNumberAllowed("inst-1", "+919876543210", Instant.now(), 3));
        assertEquals("call_in_progress", e.getCode());
    }

    @Test
    void theDailyCapCountsPlacedCalls() {
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> guards(row(3, 0, null)).requireNumberAllowed("inst-1", "+919876543210", Instant.now(), 3));
        assertEquals("contact_daily_limit_reached", e.getCode());
        assertDoesNotThrow(() -> guards(row(2, 0, null)).requireNumberAllowed("inst-1", "+919876543210", Instant.now(), 3));
    }

    @Test
    void theRecallGapStartsAtTheLastConnectedCall() {
        Instant now = Instant.now();
        AiCallingApiException e = assertThrows(AiCallingApiException.class, () -> guards(row(1, 0, now.minusSeconds(600)))
                .requireNumberAllowed("inst-1", "+919876543210", now, 3));
        assertEquals("contact_called_recently", e.getCode());
        assertNotNull(e.getRetryAfterSeconds());
        assertDoesNotThrow(() -> guards(row(1, 0, now.minus(Duration.ofMinutes(61))))
                .requireNumberAllowed("inst-1", "+919876543210", now, 3));
    }

    @Test
    void last10IgnoresFormatting() {
        assertEquals("9876543210", HumanCallGuards.last10("+91 98765-43210"));
        assertNull(HumanCallGuards.last10("12345"));
    }
}
