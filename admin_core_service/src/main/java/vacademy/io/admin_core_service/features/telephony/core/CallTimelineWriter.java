package vacademy.io.admin_core_service.features.telephony.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.HashMap;
import java.util.Map;

/**
 * Writes the lead-timeline CALL_MADE event for a telephony call — one row per call.
 *
 * <p>Called twice in a call's life: when the call reaches a terminal status
 * ({@link CallLogService}, every call, recorded or not) and again when the recording has been
 * uploaded ({@link RecordingTxOps}). Both upsert the same row (matched on call_log_id), so the
 * event exists from the moment the call ended — which is what the TAT "responded" clock reads —
 * and gains its recording key later. Before this, only calls whose recording was uploaded got
 * an event at all, timestamped at upload time.
 *
 * <p>Deliberately depends only on {@link TimelineEventService} and {@link UserMobileResolver} so
 * both callers can use it without creating a bean cycle.
 */
@Service
public class CallTimelineWriter {

    private static final Logger log = LoggerFactory.getLogger(CallTimelineWriter.class);

    @Autowired private TimelineEventService timelineEventService;
    @Autowired private UserMobileResolver userMobileResolver;

    /** Best-effort: a failure is logged, never thrown — the timeline is a side effect. */
    public void write(TelephonyCallLog row) {
        String typeId = row.getResponseId() != null ? row.getResponseId() : row.getUserId();
        if (typeId == null) return; // not tied to a lead or a user — nothing to attach it to

        boolean isInbound = "INBOUND".equalsIgnoreCase(row.getDirection());

        Map<String, Object> meta = new HashMap<>();
        meta.put("provider_call_id", row.getProviderCallId());
        meta.put("recording_storage_key", row.getRecordingStorageKey());
        meta.put("status", row.getStatus());
        meta.put("duration_seconds", row.getDurationSeconds());
        meta.put("call_log_id", row.getId());
        meta.put("caller_id", row.getCallerId());
        // Direction is the source of truth for "did the lead call us or did we
        // call the lead?" — frontend renderers (icon, accent colour, label)
        // read this off the metadata so a single timeline-event renderer can
        // handle both directions without duplicating logic.
        meta.put("direction", row.getDirection());

        // Actor: for OUTBOUND the counsellor placed the call → show their name.
        // For INBOUND the LEAD initiated; the counsellor still answered, so
        // we keep their name on the "by" line so it's clear who picked up.
        String actorName = userMobileResolver
                .findDisplayName(row.getCounsellorUserId())
                .orElse(null);

        // Title needs to reflect direction so the timeline doesn't mislabel
        // inbound callbacks as outbound calls. action_type stays as CALL_MADE
        // for both — the existing timeline renderer keys on this and we don't
        // want to break it. Direction-specific styling reads `meta.direction`.
        String title = isInbound ? "Inbound call from lead" : "Outbound call";

        try {
            // student_user_id rides along — the TAT queries and the side-view match on it.
            timelineEventService.upsertCallEvent(
                    typeId,
                    row.getId(),
                    row.getCounsellorUserId(),
                    actorName,
                    title,
                    describeOutcome(row),
                    meta,
                    row.getUserId());
        } catch (Exception e) {
            log.warn("timeline event write failed for call {}", row.getId(), e);
        }
    }

    private String describeOutcome(TelephonyCallLog row) {
        Integer d = row.getDurationSeconds();
        String pretty = d == null ? "" : formatDuration(d);
        String status = row.getStatus() != null ? row.getStatus() : "";
        String label = switch (status) {
            case "COMPLETED" -> "Connected";
            case "NO_ANSWER" -> "No answer";
            case "BUSY"      -> "Busy";
            case "CANCELLED" -> "Cancelled";
            case "FAILED"    -> "Failed";
            default          -> status;
        };
        return d == null || d == 0 ? label : pretty + " · " + label;
    }

    private String formatDuration(int seconds) {
        int m = seconds / 60;
        int s = seconds % 60;
        return m + "m " + s + "s";
    }
}
