package vacademy.io.admin_core_service.features.live_activity.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;

import java.util.HashMap;
import java.util.Map;

/**
 * Translates a telephony call-log transition into a feed event.
 *
 * <p>Kept out of {@code CallLogService} so the telephony write path keeps exactly one
 * responsibility, and so the status-to-action mapping lives next to the rest of the feed
 * vocabulary rather than buried in a persistence class.
 *
 * <p>Not every provider status is worth a feed row. INITIATED and COUNSELLOR_ANSWERED are
 * bridge plumbing -- the second leg has not been dialled yet -- so they are dropped.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityCallRecorder {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityCallRecorder.class);

    private final LiveActivityRecorder recorder;
    private final TelephonyCallLogRepository callLogRepository;

    /**
     * The initial QUEUED moment, which does NOT flow through
     * {@code CallLogService.applyEvent} -- {@code CallOrchestrator} commits the provider id
     * and publishes straight to the per-call bus, so without this hook a call would only
     * appear in the feed once its first provider webhook landed.
     *
     * <p>Loads the row rather than taking fields from the orchestrator's local context so
     * that every CALL event is built from one place and cannot drift in how it maps
     * counsellor, subject and number.
     */
    public void recordQueued(String callLogId) {
        try {
            callLogRepository.findById(callLogId)
                    .ifPresent(call -> recordStatus(call, CallStatus.QUEUED));
        } catch (Exception e) {
            log.warn("Failed to record queued live activity for call {}: {}", callLogId, e.getMessage());
        }
    }

    public void recordStatus(TelephonyCallLog call, CallStatus status) {
        try {
            LiveActivityAction action = actionFor(status);
            if (action == null) {
                return;
            }

            Map<String, Object> payload = new HashMap<>();
            payload.put("status", status.name());
            if (call.getProviderType() != null) {
                payload.put("provider", call.getProviderType());
            }
            if (call.getDirection() != null) {
                payload.put("direction", call.getDirection());
            }
            if (call.getDurationSeconds() != null) {
                payload.put("durationSeconds", call.getDurationSeconds());
            }
            if (call.getTerminationReason() != null) {
                payload.put("terminationReason", call.getTerminationReason());
            }

            // An AI-placed call has no human counsellor. Attributing it to one would make
            // the counsellor filter lie about who was working.
            LiveActivityActorType actorType = call.getCounsellorUserId() == null
                    ? LiveActivityActorType.AI
                    : LiveActivityActorType.COUNSELLOR;

            recorder.recordAfterCommit(LiveActivityEvent.builder()
                    .instituteId(call.getInstituteId())
                    .occurredAtEpochMillis(System.currentTimeMillis())
                    .category(LiveActivityCategory.CALL)
                    .action(action)
                    .actorType(actorType)
                    .dedupeKey(LiveActivityDedupeKeys.forCall(call.getId(), status.name()))
                    .subjectId(call.getUserId())
                    .subjectMobile(call.getToNumber())
                    .entityId(call.getId())
                    .counsellorUserId(call.getCounsellorUserId())
                    .payload(payload)
                    .build());
        } catch (Exception e) {
            // A feed problem must never break a call.
            log.warn("Failed to record live activity for call {}: {}", call.getId(), e.getMessage());
        }
    }

    /**
     * Map a provider status onto the feed vocabulary, or null to skip.
     *
     * <p>All terminal statuses collapse to CALL_ENDED; the specific outcome (NO_ANSWER,
     * BUSY, FAILED) rides in the payload rather than the action, so the UI can collapse a
     * whole call into one row that settles at "ended" without needing a case per outcome.
     */
    private LiveActivityAction actionFor(CallStatus status) {
        if (status == null) {
            return null;
        }
        if (status.isTerminal()) {
            return LiveActivityAction.CALL_ENDED;
        }
        return switch (status) {
            case QUEUED -> LiveActivityAction.CALL_QUEUED;
            // On a bridged call this is the counsellor's own handset ringing, which is the
            // first moment a human is visibly engaged -- worth showing.
            case COUNSELLOR_RINGING -> LiveActivityAction.CALL_RINGING;
            case IN_PROGRESS -> LiveActivityAction.CALL_CONNECTED;
            // INITIATED and COUNSELLOR_ANSWERED are bridge plumbing: the second leg has not
            // been dialled yet, so neither tells a watcher anything CALL_RINGING and
            // CALL_CONNECTED do not already say.
            default -> null;
        };
    }
}
