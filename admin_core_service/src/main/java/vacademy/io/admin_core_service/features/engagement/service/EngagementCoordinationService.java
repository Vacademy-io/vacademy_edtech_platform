package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.spi.DataPointRegistry;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * B5: the engine works alongside the rest of the CRM instead of on its own.
 *
 * <ul>
 *   <li><b>One contact limit across all systems (S1, L10):</b> touches from the engine, workflows,
 *   announcements and the chatbot (the ledger's {@code contact}, per phone and email, so two leads
 *   sharing a parent's phone share it) plus outbound AI calls. At the limit the member is not
 *   decided (zero tokens) and looks again tomorrow. The engine's own cap (PolicyGate) still
 *   applies on top.</li>
 *   <li><b>Counsellor-active hold (F-1):</b> a person touched the lead in the last hours (a note, a
 *   call, a follow-up, an inbox message) or a follow-up is due today. The engine still decides, but
 *   only drafts for the inbox; it never auto-sends over the counsellor.</li>
 *   <li><b>Do not automate:</b> a counsellor flagged the lead; the same draft-only rule, until the
 *   flag is cleared.</li>
 * </ul>
 *
 * A failed read never blocks a decision outright: it degrades to draft-only for the cohort, the
 * safe side (a human sees everything before it goes out).
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementCoordinationService {

    public static final String HOLD_HUMAN_TOUCH = "HUMAN_TOUCH";
    public static final String HOLD_FOLLOWUP_TODAY = "FOLLOWUP_TODAY";
    public static final String HOLD_DO_NOT_AUTOMATE = "DO_NOT_AUTOMATE";
    public static final String HOLD_UNKNOWN = "COORDINATION_UNAVAILABLE";

    private final EngagementCoordinationDao dao;

    @Value("${engagement.contact.max-touches:4}")
    private int maxTouches = 4;

    @Value("${engagement.contact.window-days:7}")
    private int windowDays = 7;

    @Value("${engagement.hold.human-touch-hours:24}")
    private int holdHours = 24;

    /** "Today" for a follow-up is the institute's day; the same zone as the quiet-hours floor. */
    @Value("${engagement.quiet.timezone:Asia/Kolkata}")
    private String timezone = "Asia/Kolkata";

    /** Per member: whether the contact limit is reached, and why its decision may only draft. */
    public record Verdict(boolean contactLimitReached, String hold, long touches) {
        static final Verdict CLEAR = new Verdict(false, null, 0);
    }

    /** One cohort's verdicts; members not in the map are clear. */
    public Map<String, Verdict> forCohort(String instituteId, List<EngagementMember> members,
                                          DataPointRegistry.CohortBundle bundle, Instant now) {
        Map<String, Verdict> out = new HashMap<>();
        List<String> leadRows = members.stream().map(EngagementMember::getAudienceResponseId)
                .filter(Objects::nonNull).distinct().toList();
        Map<String, Long> aiCalls;
        Set<String> followupToday;
        Set<String> flagged;
        try {
            aiCalls = dao.aiCallCounts(instituteId, leadRows, now.minus(Duration.ofDays(windowDays)));
            ZoneId zone = zone();
            LocalDate today = now.atZone(zone).toLocalDate();
            followupToday = dao.leadsWithFollowupDue(instituteId, leadRows,
                    today.atStartOfDay(zone).toInstant(), today.plusDays(1).atStartOfDay(zone).toInstant());
            flagged = dao.doNotAutomate(instituteId, leadRows);
        } catch (Exception e) {
            log.warn("Coordination read failed for institute {} — this cohort only drafts: {}", instituteId, e.getMessage());
            for (EngagementMember m : members) out.put(m.getId(), new Verdict(false, HOLD_UNKNOWN, 0));
            return out;
        }
        for (EngagementMember m : members) {
            JsonNode contact = bundle != null ? bundle.payloadsFor(m.getId()).getOrDefault("ledger", null) : null;
            contact = contact != null ? contact.get("contact") : null;
            String row = m.getAudienceResponseId();
            long touches = (contact != null ? contact.path("touches").asLong(0) : 0)
                    + (row != null ? aiCalls.getOrDefault(row, 0L) : 0);
            Instant lastInbox = contact != null ? parse(contact.path("lastHumanSentAt").asText(null)) : null;
            String hold = null;
            if (row != null && flagged.contains(row)) hold = HOLD_DO_NOT_AUTOMATE;
            else if (recent(m.getHumanTouchAt(), now) || recent(lastInbox, now)) hold = HOLD_HUMAN_TOUCH;
            else if (row != null && followupToday.contains(row)) hold = HOLD_FOLLOWUP_TODAY;
            boolean limit = touches >= maxTouches;
            if (limit || hold != null) out.put(m.getId(), new Verdict(limit, hold, touches));
        }
        return out;
    }

    /**
     * At send time, for an auto SEND decided earlier (it may be scheduled up to a week out): the
     * lead was flagged do-not-automate, or a person touched it within the hold, since. Null when
     * it may go. AI-call promises are the caller's to exempt (the person asked for them).
     */
    public String sendHold(EngagementMember m, Instant now) {
        if (m == null) return null;
        try {
            if (m.getAudienceResponseId() != null
                    && dao.doNotAutomate(m.getInstituteId(), List.of(m.getAudienceResponseId())).contains(m.getAudienceResponseId())) {
                return HOLD_DO_NOT_AUTOMATE;
            }
        } catch (Exception e) {
            return HOLD_UNKNOWN;
        }
        return recent(m.getHumanTouchAt(), now) ? HOLD_HUMAN_TOUCH : null;
    }

    public static Verdict of(Map<String, Verdict> verdicts, String memberId) {
        return verdicts != null ? verdicts.getOrDefault(memberId, Verdict.CLEAR) : Verdict.CLEAR;
    }

    /** What the brain is told when it may only draft, so the draft is written for the counsellor. */
    public static String explain(String hold) {
        if (hold == null) return null;
        return switch (hold) {
            case HOLD_DO_NOT_AUTOMATE -> "a counsellor marked this lead do-not-automate";
            case HOLD_HUMAN_TOUCH -> "a counsellor was in touch with this lead recently";
            case HOLD_FOLLOWUP_TODAY -> "a counsellor follow-up with this lead is due today";
            default -> "the engine could not check what the counsellor is doing";
        };
    }

    private boolean recent(Instant t, Instant now) {
        return t != null && t.isAfter(now.minus(Duration.ofHours(Math.max(holdHours, 0))));
    }

    private ZoneId zone() {
        try {
            return ZoneId.of(timezone);
        } catch (Exception e) {
            return ZoneId.of("Asia/Kolkata");
        }
    }

    private static Instant parse(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return Instant.parse(s);
        } catch (Exception e) {
            return null;
        }
    }
}
