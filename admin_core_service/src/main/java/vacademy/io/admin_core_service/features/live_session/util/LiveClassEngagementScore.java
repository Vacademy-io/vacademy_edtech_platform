package vacademy.io.admin_core_service.features.live_session.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Per-class engagement ("concentration") score for one learner in one live class, 0-100.
 *
 * <ul>
 *   <li>80 pts from time attended: {@code providerMinutes / meetingMinutes * 80}. When the class
 *       length is unknown, raw minutes earn partial credit ({@code minutes * 1.5}, capped at 80).</li>
 *   <li>20 pts from interactions BBB reports in {@code live_session_logs.engagement_data}:
 *       chats, raise-hands, talks, talk time, emojis and poll votes, each with its own cap.</li>
 * </ul>
 *
 * Shared by the attendance-report workflow query and the learner-profile Live Sessions tab so the
 * score a learner is emailed and the score an admin sees can never disagree.
 */
public final class LiveClassEngagementScore {

    private LiveClassEngagementScore() {
    }

    public record Result(
            /* false when there is neither a provider duration nor BBB counters — nothing to score */
            boolean scorable,
            int score,
            double attendancePoints,
            double interactionPoints,
            int chats,
            int raiseHands,
            int talks,
            int talkTime,
            int emojis,
            int pollVotes) {
    }

    public static Result compute(Integer providerMinutes, Integer meetingMinutes, String engagementJson,
                                 ObjectMapper objectMapper) {
        boolean hasProviderDuration = providerMinutes != null;
        int minutes = hasProviderDuration ? providerMinutes : 0;

        double attendancePts = 0.0;
        if (hasProviderDuration && meetingMinutes != null && meetingMinutes > 0) {
            attendancePts = Math.min(80.0, ((double) minutes / meetingMinutes) * 80.0);
        } else if (hasProviderDuration && minutes > 0) {
            // No schedule duration known — award partial based on raw minutes (cap at 80)
            attendancePts = Math.min(80.0, minutes * 1.5);
        }

        int chats = 0, raises = 0, talks = 0, talkTime = 0, emojis = 0, pollVotes = 0;
        boolean hasEngagementJson = false;
        if (engagementJson != null && !engagementJson.isEmpty() && !"null".equals(engagementJson)) {
            try {
                JsonNode engNode = objectMapper.readTree(engagementJson);
                chats = engNode.path("chats").asInt(0);
                raises = engNode.path("raisehand").asInt(0);
                talks = engNode.path("talks").asInt(0);
                talkTime = engNode.path("talkTime").asInt(0);
                emojis = engNode.path("emojis").asInt(0);
                pollVotes = engNode.path("pollVotes").asInt(0);
                // The opt-in activeness score lands in the same JSON during the class; on its
                // own it is not BBB engagement and must not read as "0/100" before the
                // analytics callback arrives.
                hasEngagementJson = engNode.has("chats") || engNode.has("raisehand")
                        || engNode.has("talks") || engNode.has("talkTime")
                        || engNode.has("emojis") || engNode.has("pollVotes");
            } catch (Exception ignored) {
            }
        }

        // Interaction score out of 20:
        //   chats up to 4, raises up to 4, talks up to 5, talkTime up to 3, emojis up to 2, polls up to 2
        double interactionPts = 0.0;
        interactionPts += Math.min(4.0, chats * 0.4);        // 10+ chats = 4pts
        interactionPts += Math.min(4.0, raises * 0.8);       // 5+ raises = 4pts
        interactionPts += Math.min(5.0, talks * 0.25);       // 20+ talks = 5pts
        interactionPts += Math.min(3.0, talkTime / 60.0 * 0.6); // 5+ min talk = 3pts
        interactionPts += Math.min(2.0, emojis * 0.2);       // 10+ emojis = 2pts
        interactionPts += Math.min(2.0, pollVotes * 0.4);    // 5+ polls = 2pts
        interactionPts = Math.min(20.0, interactionPts);

        int score = (int) Math.round(Math.min(100.0, attendancePts + interactionPts));
        return new Result(hasProviderDuration || hasEngagementJson, score,
                attendancePts, interactionPts, chats, raises, talks, talkTime, emojis, pollVotes);
    }
}
