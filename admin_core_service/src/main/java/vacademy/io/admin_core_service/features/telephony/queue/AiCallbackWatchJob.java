package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementPointsOfContact;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The AI call the engine scheduled because a lead asked to be called back may never become a
 * conversation: the line never freed up, the item expired, or the phone rang unanswered. Nobody would
 * notice. This tells the admins and the counsellor once, on the lead's timeline and by email and bell,
 * so a human calls instead.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AiCallbackWatchJob {

    private static final Duration LOOKBACK = Duration.ofDays(7);

    private final AiCallQueueItemRepository repository;
    private final EngagementPointsOfContact pointsOfContact;
    private final TimelineEventService timelineEventService;

    @Scheduled(fixedDelayString = "${engagement.callback-watch.delay-ms:300000}",
            initialDelayString = "${engagement.callback-watch.initial-delay-ms:120000}")
    @SchedulerLock(name = "AiCallbackWatch", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        try {
            for (Object[] row : repository.findUnreachedEngineCallbacks(Instant.now().minus(LOOKBACK))) {
                String id = (String) row[0], instituteId = (String) row[1], responseId = (String) row[2],
                        userId = (String) row[3], phone = (String) row[4], name = (String) row[5], why = (String) row[6];
                // Mark first: an alert that fails once must not repeat every five minutes.
                if (repository.markAlerted(id) == 0) continue;
                tell(instituteId, responseId, userId, phone, name, why, id);
            }
        } catch (Exception e) {
            log.warn("Callback watch failed: {}", e.getMessage());
        }
    }

    void tell(String instituteId, String responseId, String userId, String phone, String name, String why, String itemId) {
        String who = name == null || name.isBlank() ? "A lead" : name;
        try {
            if (responseId != null) {
                timelineEventService.logJourneyEvent("AUDIENCE_RESPONSE", responseId,
                        vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType.CALLBACK_REQUESTED,
                        "SYSTEM", null, "AI call", "Callback call did not connect",
                        why + " The follow-up for this callback is still due: please call them.",
                        Map.of("queue_item_id", itemId), userId);
            }
        } catch (Exception e) {
            log.warn("Callback watch: timeline note failed: {}", e.getMessage());
        }
        pointsOfContact.alert(instituteId, userId, "Callback did not connect: " + who,
                "<p>" + EngagementPointsOfContact.esc(who) + (phone == null ? "" : " (" + EngagementPointsOfContact.esc(phone) + ")")
                        + " asked to be called back and the AI call the engine scheduled did not connect. "
                        + EngagementPointsOfContact.esc(why) + " Please call them.</p>", "AI_CALLBACK", itemId);
    }
}
