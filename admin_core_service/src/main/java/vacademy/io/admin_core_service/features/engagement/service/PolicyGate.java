package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Set;

/**
 * The safety layer, checked BEFORE the LLM call (gating after the LLM pays for decisions you
 * throw away). Because the prompt decides cadence (founder call, D13), the INSTITUTE-WIDE
 * CROSS-ENGINE per-subject cap here is the only hard cadence mechanism: three engines sharing
 * a learner share one cap, so "each engine behaved" can never add up to spam.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class PolicyGate {

    private final EngagementReadDao dao;
    private final EngagementActionRepository actionRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** Hard institute-wide cross-engine cap: actions per subject per window. */
    @Value("${engagement.cap.actions-per-window:3}")
    private int actionsPerWindow;

    @Value("${engagement.cap.window-days:7}")
    private int capWindowDays;

    /** Institute compliance floor (IST cutoff convention): no outreach 21:00–08:00. */
    @Value("${engagement.quiet.start-hour:21}")
    private int quietStartHour;

    @Value("${engagement.quiet.end-hour:8}")
    private int quietEndHour;

    @Value("${engagement.quiet.timezone:Asia/Kolkata}")
    private String quietTimezone;

    public enum Verdict { PROCEED, SKIP_OPTED_OUT, SKIP_CAPPED }

    /** Batch consent check for a cohort — one query. */
    public Set<String> optedOutUserIds(String instituteId, List<String> userIds) {
        return dao.optedOutUserIds(instituteId, userIds);
    }

    /** Per-member pre-LLM gate. Consent is checked at cohort level; this adds the cap. */
    public Verdict preDecision(EngagementMember member, Set<String> optedOut) {
        if (member.getUserId() != null && optedOut.contains(member.getUserId())) {
            return Verdict.SKIP_OPTED_OUT;
        }
        long recent = actionRepository.countRecentActionsForSubject(
                member.getInstituteId(), member.getUserId(), member.getAudienceResponseId(),
                Instant.now().minus(Duration.ofDays(capWindowDays)));
        if (recent >= actionsPerWindow) {
            return Verdict.SKIP_CAPPED;
        }
        return Verdict.PROCEED;
    }

    /**
     * Clamp a proposed action time out of quiet hours. Correctness matters here: an off-by-one
     * sends outreach at 2 AM. The institute floor (default 21:00→08:00, wrapping midnight) is
     * ALWAYS enforced; the engine's own quiet_hours can only ADD more quiet time, never remove
     * the floor — modelled as: a minute is blocked if it is floor-quiet OR engine-quiet (union).
     * The engine cannot move the floor's timezone. Replies are exempt (D10), but Phase 1a
     * creates tasks only, which respect the floor.
     */
    public Instant clampToAllowedWindow(EngagementEngine engine, Instant proposed) {
        ZoneId floorZone = ZoneId.of(quietTimezone);         // pinned — engine cannot move it
        int floorStart = quietStartHour * 60;
        int floorEnd = quietEndHour * 60;

        Integer engStart = null, engEnd = null;
        // The engine's own hours are in the zone the admin picked in the wizard (quietHours.timezone),
        // not the floor's: reading "21-8 Europe/London" as IST let sends go out around 02:30 London.
        ZoneId engineZone = floorZone;
        try {
            JsonNode qh = objectMapper.readTree(engine.getQuietHours());
            if (qh.hasNonNull("startHour") && qh.hasNonNull("endHour")) {
                int es = qh.get("startHour").asInt() * 60;
                int ee = qh.get("endHour").asInt() * 60;
                // Ignore a degenerate/empty engine interval (start==end would be a no-op that
                // could otherwise be read as "disable" — the floor stays regardless).
                if (es != ee && es >= 0 && es < 1440 && ee >= 0 && ee < 1440) {
                    engStart = es;
                    engEnd = ee;
                }
            }
            if (qh.hasNonNull("timezone")) {
                try {
                    engineZone = ZoneId.of(qh.get("timezone").asText());
                } catch (Exception badZone) {
                    // unknown zone id → keep the floor's zone
                }
            }
        } catch (Exception ignored) {
            // unparseable engine quiet hours → institute floor alone applies
        }

        Instant slot = firstAllowed(proposed, floorZone, floorStart, floorEnd, engineZone, engStart, engEnd);
        if (slot != null) return slot;
        // The engine's hours plus the floor cover the whole day (e.g. an admin who read the
        // pickers as "active hours" and chose 8-21). Returning the proposed time here sent at
        // 2 AM; the floor is the compliance minimum, so fall back to it alone.
        log.warn("Engine {}: its quiet hours and the institute floor leave no free time; using the floor only",
                engine.getId());
        slot = firstAllowed(proposed, floorZone, floorStart, floorEnd, engineZone, null, null);
        return slot != null ? slot : proposed;
    }

    /**
     * The first 15-minute step within 24h that is neither floor-quiet (in the floor's zone) nor
     * engine-quiet (in the engine's zone), or null when every step is blocked.
     */
    private static Instant firstAllowed(Instant proposed, ZoneId floorZone, int floorStart, int floorEnd,
                                        ZoneId engineZone, Integer engStart, Integer engEnd) {
        ZonedDateTime t = proposed.atZone(floorZone);
        for (int i = 0; i <= 96; i++) {
            ZonedDateTime candidate = t.plusMinutes(15L * i).withSecond(0).withNano(0);
            int floorMinute = candidate.getHour() * 60 + candidate.getMinute();
            if (inInterval(floorMinute, floorStart, floorEnd)) continue;
            if (engStart != null) {
                ZonedDateTime local = candidate.withZoneSameInstant(engineZone);
                if (inInterval(local.getHour() * 60 + local.getMinute(), engStart, engEnd)) continue;
            }
            return candidate.toInstant();
        }
        return null;
    }

    /** [start, end) minutes-of-day membership, wrapping past midnight when start > end. */
    private static boolean inInterval(int minute, int start, int end) {
        return start > end ? (minute >= start || minute < end) : (minute >= start && minute < end);
    }
}
