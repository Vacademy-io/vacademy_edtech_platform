package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementEngineRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementReplyMemberQueries.LiveMember;
import vacademy.io.admin_core_service.features.telephony.core.AiCallFollowThrough;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiCallResult;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiCallResultRepository;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * What an engine does with the outcome of its AI call. A demo the person agreed to or clear interest
 * reaches the team straight away, by email, bell alert and a CRM follow-up, because the agent told them
 * someone would confirm.
 *
 * <p>Only leads in an engine that calls with this agent: a bulk campaign of thousands of calls keeps
 * its own workflow and does not email the team per call. Every step is best effort.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementCallOutcomeService {

    public enum Verdict { BOOKED, INTERESTED, NONE }

    /** Agent vocabularies vary, so these match a normalized label (as the voice bot's analyser does). */
    private static final Pattern NEGATED = Pattern.compile("not|cancel|declin|reject|noshow|lost");
    private static final Pattern BOOKED = Pattern.compile("book|schedul|appointment|demo|meeting");
    private static final int MAX_ANSWERS = 10;
    private static final int MAX_ANSWER_CHARS = 200;
    private static final int MAX_GIST_CHARS = 250;

    private final EngagementReplyMemberQueries memberQueries;
    private final EngagementEngineRepository engineRepository;
    private final EngagementMemberRepository memberRepository;
    private final EngagementTeamAlertService teamAlert;
    private final AiCallResultRepository resultRepository;

    /** Lazy: telephony reaches back into the engine. */
    @Autowired
    @Lazy
    private AiCallFollowThrough followThrough;

    public static Verdict verdict(String disposition) {
        String d = disposition == null ? "" : disposition.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
        if (d.isEmpty()) return Verdict.NONE;
        if (NEGATED.matcher(d).find()) return Verdict.NONE;
        if (BOOKED.matcher(d).find()) return Verdict.BOOKED;
        return d.contains("interested") ? Verdict.INTERESTED : Verdict.NONE;
    }

    public void onCallEnded(AiCallResult r, String responseId, String userId, String instituteId) {
        Verdict verdict = verdict(r.getDisposition());
        if (verdict == Verdict.NONE || instituteId == null || r.getCampaignId() == null) return;
        List<LiveMember> live = memberQueries.findLiveMembersOfLeadForAgent(instituteId,
                responseId != null ? responseId : "", userId != null ? userId : "", r.getCampaignId());
        if (live.isEmpty()) return;

        Instant now = Instant.now();
        boolean booked = verdict == Verdict.BOOKED;
        // The analyser reads "already booked" as nothing left to do, but nobody has confirmed it yet.
        if (booked && "SKIP".equals(r.getFollowUp())) {
            resultRepository.updateFollowUp(r.getId(), "CALL", gistForBooked(r));
        }
        String task = booked ? "demo agreed on the call. Confirm it with them." : "interested on the call. Call them.";
        String who = r.getCustomerName() != null && !r.getCustomerName().isBlank()
                ? r.getCustomerName() : (r.getPhoneNumber() != null ? r.getPhoneNumber() : "A lead");
        String followupId = followThrough != null ? followThrough.createHotLeadFollowup(r, responseId, userId,
                instituteId, now, who + ": " + task + answersOf(r, " ")) : null;

        LiveMember target = live.get(0);
        var engine = engineRepository.findById(target.getEngineId()).orElse(null);
        var member = memberRepository.findById(target.getMemberId()).orElse(null);
        if (engine == null || member == null) return;
        teamAlert.notifyCallOutcome(engine, member, r.getId(),
                (booked ? "Demo agreed: " : "Interested: ") + who,
                (booked ? "agreed to a demo" : "showed interest") + " on the AI call of \"" + engine.getName() + "\"."
                        + (r.getAiSummary() != null ? "\n\nSummary: " + r.getAiSummary().trim() : "")
                        + answersOf(r, "\n")
                        + "\n\n" + (followupId != null ? "A follow-up is in the CRM, due now. " : "")
                        + (booked ? "The agent told them the team will confirm the demo, so please confirm it today."
                                  : "Please call them while they are interested."));
        log.info("Call outcome {} for member {}: team told, follow-up {}", r.getDisposition(), target.getMemberId(), followupId);
    }

    private static String gistForBooked(AiCallResult r) {
        String summary = r.getAiSummary() == null ? "" : " " + r.getAiSummary().trim();
        String gist = "Confirm the demo with them." + summary;
        return gist.length() <= MAX_GIST_CHARS ? gist : gist.substring(0, MAX_GIST_CHARS);
    }

    /** What the person actually answered: the demo time and the questions they asked live here. */
    static String answersOf(AiCallResult r, String separator) {
        Map<String, Object> qa = r.getExtractedQa();
        if (qa == null || qa.isEmpty()) return "";
        StringBuilder out = new StringBuilder();
        int shown = 0;
        for (Map.Entry<String, Object> e : qa.entrySet()) {
            String answer = e.getValue() == null ? "" : String.valueOf(e.getValue()).trim();
            if (answer.isEmpty() || answer.equalsIgnoreCase("null") || answer.equalsIgnoreCase("false")) continue;
            if (shown++ == MAX_ANSWERS) break;
            if (answer.length() > MAX_ANSWER_CHARS) answer = answer.substring(0, MAX_ANSWER_CHARS);
            out.append(separator).append(e.getKey()).append(": ").append(answer);
        }
        return out.toString();
    }
}
