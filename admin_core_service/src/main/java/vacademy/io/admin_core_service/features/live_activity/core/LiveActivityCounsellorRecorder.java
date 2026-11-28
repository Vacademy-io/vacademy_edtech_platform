package vacademy.io.admin_core_service.features.live_activity.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

import java.util.HashMap;
import java.util.Map;

/**
 * Counsellor-side activity: status flips, lead transfers, dispositions and follow-ups.
 *
 * <p><b>The action names are not invented here.</b> They deliberately match
 * {@code counsellor_workbench/dto/ActivityFeedItemDTO} -- STATUS_CHANGED, NOTE_ADDED,
 * LEAD_TRANSFERRED_IN/OUT, FOLLOWUP_CREATED/CLOSED -- which
 * {@code WorkbenchActivityRepository.fetchFeed} already projects from call logs, follow-ups
 * and timeline events. Same event, same word, so the institute-wide live feed and the
 * per-counsellor workbench history never describe the same thing differently.
 *
 * <p>This category is about what counsellors <i>did</i>, not who is online. The platform has
 * no presence signal: counsellor status is ACTIVE/INACTIVE only, and the telephony
 * availability endpoint reports capability (does this user have an extension) rather than
 * presence -- it does not change when someone logs in or picks up a call.
 */
@Component
@RequiredArgsConstructor
public class LiveActivityCounsellorRecorder {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityCounsellorRecorder.class);

    private final LiveActivityRecorder recorder;

    public void recordStatusChanged(String instituteId, String counsellorUserId,
                                    String counsellorName, String status, String actorUserId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("status", status);
        record(instituteId, LiveActivityAction.STATUS_CHANGED, counsellorUserId, counsellorName,
                counsellorUserId, actorUserId, null, null, payload);
    }

    public void recordLeadTransfer(String instituteId, LiveActivityAction action,
                                   String counsellorUserId, String counsellorName,
                                   String actorUserId, int leadCount) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("leadCount", leadCount);
        record(instituteId, action, counsellorUserId, counsellorName,
                counsellorUserId, actorUserId, null, null, payload);
    }

    public void recordDisposition(String instituteId, String callLogId, String counsellorUserId,
                                  String actorUserId, String dispositionKey, String dispositionLabel,
                                  String notes, String subjectMobile) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("dispositionKey", dispositionKey);
        if (dispositionLabel != null) {
            payload.put("dispositionLabel", dispositionLabel);
        }
        if (notes != null && !notes.isBlank()) {
            payload.put("notes", notes);
        }
        record(instituteId, LiveActivityAction.NOTE_ADDED, counsellorUserId, null,
                callLogId, actorUserId, null, subjectMobile, payload);
    }

    public void recordFollowup(String instituteId, LiveActivityAction action, String followupId,
                               String counsellorUserId, String actorUserId, String subjectName) {
        record(instituteId, action, counsellorUserId, null,
                followupId, actorUserId, subjectName, null, new HashMap<>());
    }

    private void record(String instituteId, LiveActivityAction action, String counsellorUserId,
                        String counsellorName, String entityId, String actorUserId,
                        String subjectName, String subjectMobile, Map<String, Object> payload) {
        try {
            if (instituteId == null) {
                return;
            }
            recorder.recordAfterCommit(LiveActivityEvent.builder()
                    .instituteId(instituteId)
                    .occurredAtEpochMillis(System.currentTimeMillis())
                    .category(LiveActivityCategory.COUNSELLOR)
                    .action(action)
                    // An admin reassigning someone else's leads is not the counsellor acting.
                    .actorType(actorUserId != null && !actorUserId.equals(counsellorUserId)
                            ? LiveActivityActorType.ADMIN
                            : LiveActivityActorType.COUNSELLOR)
                    .dedupeKey(LiveActivityDedupeKeys.forCounsellor(
                            action, entityId, actorUserId, System.currentTimeMillis()))
                    .subjectName(subjectName)
                    .subjectMobile(subjectMobile)
                    .entityId(entityId)
                    .counsellorUserId(counsellorUserId)
                    .counsellorName(counsellorName)
                    .payload(payload)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to record counsellor live activity {}: {}", action, e.getMessage());
        }
    }
}
