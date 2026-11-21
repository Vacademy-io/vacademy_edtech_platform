package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.CallingWindowUtil;
import vacademy.io.admin_core_service.features.telephony.core.VoiceCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.core.dto.VoiceCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;

import java.sql.Timestamp;
import java.time.*;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The checks a human call placed through the public API passes before anything dials.
 *
 * <p>The dashboard's Call button has none of these: a counsellor deciding to ring a lead
 * now is a person's decision. An API call is a machine's decision on the counsellor's
 * behalf, so it gets the fan-out guards the AI calling API has, applied up front — an
 * immediate call cannot wait in a queue, so each guard rejects instead of deferring:
 * <ul>
 *   <li><b>Calling hours.</b> The institute's calling shifts from its AI calling
 *       settings, evaluated exactly as the AI queue does ({@link CallingWindowUtil}), AND
 *       the India compliance window from VOICE_CALLING_SETTING (start/cutoff hour,
 *       default 09:00–21:00 in its timezone, on unless switched off).</li>
 *   <li><b>Per-number daily cap.</b> The AI setting maxCallsPerDayPerLead (default 3),
 *       counted over every outbound call the number got in 24 h — AI and human, any
 *       provider — that was actually placed (not FAILED / CANCELLED).</li>
 *   <li><b>Recall gap.</b> telephony.ai.min-recall-gap-minutes (default 60) since the
 *       start of the last CONNECTED call to the number. Unlike the AI queue, a missed call (no answer,
 *       busy) does not start the gap: a counsellor retrying a missed call is normal, and
 *       for most providers we cannot tell whether the missed leg was the counsellor's or
 *       the contact's. Missed calls still count toward the daily cap.</li>
 *   <li><b>One live call.</b> The counsellor must not already be on a call, and the
 *       number must not already be ringing (a double click from the client's CRM).</li>
 * </ul>
 *
 * <p>No DND (NCPR) scrub: the platform holds no DND registry, and the AI queue does not
 * scrub either; VOICE_CALLING_SETTING.compliance.dndScrubEnabled is not wired anywhere yet.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class HumanCallGuards {

    /** How long a non-terminal call row still counts as live (a lost callback must not block forever). */
    static final Duration LIVE_WINDOW = Duration.ofMinutes(45);
    static final int DEFAULT_PER_NUMBER_DAILY_CAP = 3;

    private final AiCallingSettingsService aiSettings;
    private final VoiceCallingSettingsService voiceSettings;
    private final NamedParameterJdbcTemplate jdbc;

    @Value("${telephony.ai.min-recall-gap-minutes:60}")
    private int minRecallGapMinutes = 60;

    // ── Calling hours ────────────────────────────────────────────────────────────

    /** Throws 422 outside_calling_hours, with the next time a call would be accepted. */
    public void requireCallingHours(String instituteId, Instant now) {
        AiCallingSettingsPojo ai = aiSettings.get(instituteId);
        VoiceCallingSettingsPojo voice = voiceSettings.get(instituteId);
        String refusal = callingHoursRefusal(ai, voice, now);
        if (refusal == null) return;
        Map<String, Object> d = new LinkedHashMap<>();
        Instant next = nextAllowed(ai, voice, now);
        if (next != null) d.put("next_allowed_at", next.toString());
        d.put("timezone", CallingWindowUtil.resolveZone(ai.getTimezone()).getId());
        throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "outside_calling_hours", refusal, d);
    }

    /** Null when a call may be placed at {@code now}; else why not, in plain words. */
    static String callingHoursRefusal(AiCallingSettingsPojo ai, VoiceCallingSettingsPojo voice, Instant now) {
        ZoneId tz = CallingWindowUtil.resolveZone(ai == null ? null : ai.getTimezone());
        if (ai != null && !CallingWindowUtil.withinAnyShift(now, ai.getCallingShifts(), tz)) {
            return "It is outside this account's calling hours.";
        }
        VoiceCallingSettingsPojo.ComplianceConfig c = voice == null ? null : voice.getCompliance();
        if (c != null && c.isNightCutoffEnabled()) {
            ZoneId vtz = CallingWindowUtil.resolveZone(voice.getTimezone());
            int hour = LocalTime.ofInstant(now, vtz).getHour();
            if (hour < c.getStartHour() || hour >= c.getCutoffHour()) {
                return String.format("Calls are only placed between %02d:00 and %02d:00 (%s).",
                        c.getStartHour(), c.getCutoffHour(), vtz.getId());
            }
        }
        return null;
    }

    /** The first time both windows are open again, searched in 15-minute steps over 2 days. */
    static Instant nextAllowed(AiCallingSettingsPojo ai, VoiceCallingSettingsPojo voice, Instant now) {
        Instant t = now.plus(Duration.ofMinutes(15 - (LocalTime.ofInstant(now, ZoneOffset.UTC).getMinute() % 15)))
                .truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
        for (int i = 0; i < 2 * 24 * 4; i++, t = t.plus(Duration.ofMinutes(15))) {
            if (callingHoursRefusal(ai, voice, t) == null) return t;
        }
        return null;
    }

    // ── Caps and live calls ──────────────────────────────────────────────────────

    /**
     * 409 counsellor_busy when the counsellor already has a live call. Skipped for Airtel:
     * its click2dial rows only get a status from the CDR import, so every recent call would
     * look live.
     */
    public void requireCounsellorFree(String instituteId, String counsellorUserId, String providerType) {
        if (ProviderType.AIRTEL.equals(providerType)) return;
        Long live = jdbc.queryForObject("""
                SELECT COUNT(*) FROM telephony_call_log
                 WHERE institute_id = :i AND counsellor_user_id = :c
                   AND status IN ('INITIATED', 'QUEUED', 'COUNSELLOR_RINGING', 'COUNSELLOR_ANSWERED', 'IN_PROGRESS')
                   AND created_at >= :since
                """, new MapSqlParameterSource().addValue("i", instituteId).addValue("c", counsellorUserId)
                .addValue("since", utc(Instant.now().minus(LIVE_WINDOW))), Long.class);
        if (live != null && live > 0) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "counsellor_busy",
                    "This counsellor is already on a call. Retry when it ends.", null, 60);
        }
    }

    /**
     * The per-number guards: a call already ringing this number (409 call_in_progress),
     * the daily cap (422 contact_daily_limit_reached) and the recall gap after a
     * connected call (422 contact_called_recently). One query over the institute's last
     * 24 hours of outbound calls (idx_tcl_institute).
     */
    public void requireNumberAllowed(String instituteId, String phone, Instant now, int perNumberCap) {
        String last10 = last10(phone);
        if (last10 == null) return;
        Map<String, Object> r = jdbc.queryForMap("""
                SELECT COUNT(*) FILTER (WHERE status NOT IN ('FAILED', 'CANCELLED')) AS placed,
                       COUNT(*) FILTER (WHERE status IN ('INITIATED', 'QUEUED', 'COUNSELLOR_RINGING',
                                                         'COUNSELLOR_ANSWERED', 'IN_PROGRESS')
                                          AND provider_type <> 'AIRTEL'
                                          AND created_at >= :liveSince) AS live,
                       MAX(created_at) FILTER (WHERE status = 'COMPLETED'
                                          AND COALESCE(duration_seconds, 0) > 0) AS last_connected
                  FROM telephony_call_log
                 WHERE institute_id = :i AND direction = 'OUTBOUND'
                   AND created_at >= :since
                   AND RIGHT(regexp_replace(COALESCE(to_number, ''), '[^0-9]', '', 'g'), 10) = :last10
                """, new MapSqlParameterSource().addValue("i", instituteId).addValue("last10", last10)
                .addValue("since", utc(now.minus(Duration.ofHours(24))))
                .addValue("liveSince", utc(now.minus(LIVE_WINDOW))));
        long live = ((Number) r.getOrDefault("live", 0)).longValue();
        if (live > 0) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "call_in_progress",
                    "A call to this number is already in progress.", Map.of("phone_number", phone), 60);
        }
        long placed = ((Number) r.getOrDefault("placed", 0)).longValue();
        int cap = perNumberCap > 0 ? perNumberCap : DEFAULT_PER_NUMBER_DAILY_CAP;
        if (placed >= cap) {
            throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "contact_daily_limit_reached",
                    "This number has already been called " + placed + " times in the last 24 hours (limit " + cap + ").",
                    Map.of("limit", cap, "calls_last_24h", placed));
        }
        Object lastConnected = r.get("last_connected");
        if (minRecallGapMinutes > 0 && lastConnected instanceof Timestamp ts) {
            // Naive UTC in telephony_call_log (see AiCallingUsageService).
            Instant last = ts.toLocalDateTime().toInstant(ZoneOffset.UTC);
            Instant allowed = last.plus(Duration.ofMinutes(minRecallGapMinutes));
            if (allowed.isAfter(now)) {
                long wait = Math.max(1, Duration.between(now, allowed).getSeconds());
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("next_allowed_at", allowed.toString());
                d.put("recall_gap_minutes", minRecallGapMinutes);
                throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "contact_called_recently",
                        "This number had a call in the last " + minRecallGapMinutes + " minutes.", d,
                        (int) Math.min(Integer.MAX_VALUE, wait));
            }
        }
    }

    /** The per-number cap the AI calling API uses for this institute. */
    public int perNumberDailyCap(String instituteId) {
        AiCallingSettingsPojo s = aiSettings.get(instituteId);
        return s.getMaxCallsPerDayPerLead() > 0 ? s.getMaxCallsPerDayPerLead() : DEFAULT_PER_NUMBER_DAILY_CAP;
    }

    static String last10(String phone) {
        if (phone == null) return null;
        String digits = phone.replaceAll("[^0-9]", "");
        return digits.length() < 10 ? null : digits.substring(digits.length() - 10);
    }

    private static Timestamp utc(Instant i) {
        return Timestamp.valueOf(LocalDateTime.ofInstant(i, ZoneOffset.UTC));
    }
}
