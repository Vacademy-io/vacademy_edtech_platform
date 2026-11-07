package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService.WakeRequest;
import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventHook;

import java.util.Map;

/**
 * B4's one hook into the CRM: every timeline write (notes, follow-ups, status and owner changes,
 * re-enquiries, list moves, calls, new leads) passes here, so a CRM path added later wakes the
 * engine without touching engagement code. Only the event types below wake anyone; the rest
 * (score updates, TAT edits, research, reach-out logs) are noise for the engine.
 *
 * <p>The engine's own writes never wake it: its reach-outs and outcomes carry the
 * ENGAGEMENT_ENGINE actor, and the status changes it makes carry that source in their metadata.
 */
@Component
@RequiredArgsConstructor
public class EngagementTimelineWakeHook implements TimelineEventHook {

    static final String ENGINE_ACTOR = EngagementLeadOutcomeService.STATUS_SOURCE;

    /** action type → (wake reason, whether a person spoke to or wrote about the lead). */
    record Kind(String reason, boolean human) {}

    static final Map<String, Kind> KINDS = Map.ofEntries(
            // A person wrote about or spoke to the lead: the next decision only drafts.
            Map.entry("NOTE", new Kind(EngagementWakeService.NOTE, true)),
            Map.entry("COMMENT", new Kind(EngagementWakeService.NOTE, true)),
            Map.entry("WALK_IN_NOTE", new Kind(EngagementWakeService.NOTE, true)),
            Map.entry("CALL_LOG", new Kind(EngagementWakeService.HUMAN_CALL, true)),
            Map.entry("CALL_MADE", new Kind(EngagementWakeService.HUMAN_CALL, true)),
            Map.entry("FOLLOWUP_SCHEDULED", new Kind(EngagementWakeService.FOLLOWUP, true)),
            Map.entry("FOLLOWUP_CLOSED", new Kind(EngagementWakeService.FOLLOWUP, true)),
            // The lead's state moved.
            Map.entry("STATUS_CHANGED", new Kind(EngagementWakeService.STATUS, false)),
            Map.entry("STATUS_CHANGE", new Kind(EngagementWakeService.STATUS, false)),
            Map.entry("LEAD_LOST", new Kind(EngagementWakeService.STATUS, false)),
            Map.entry("COUNSELOR_ASSIGNED", new Kind(EngagementWakeService.OWNER_CHANGED, false)),
            Map.entry("COUNSELOR_UNASSIGNED", new Kind(EngagementWakeService.OWNER_CHANGED, false)),
            Map.entry("RE_ENQUIRY", new Kind(EngagementWakeService.RE_ENQUIRY, false)),
            Map.entry("REATTEMPT", new Kind(EngagementWakeService.RE_ENQUIRY, false)),
            Map.entry("DUPLICATE_MERGED", new Kind(EngagementWakeService.RE_ENQUIRY, false)),
            Map.entry("LEAD_LIST_CHANGED", new Kind(EngagementWakeService.LIST_CHANGED, false)),
            Map.entry("LEAD_DELETED", new Kind(EngagementWakeService.LIST_CHANGED, false)),
            Map.entry("LEAD_RESTORED", new Kind(EngagementWakeService.LIST_CHANGED, false)),
            Map.entry("PAYMENT_RECEIVED", new Kind(EngagementWakeService.PAYMENT, false)),
            // Not a wake: enrol the new lead within minutes rather than at the nightly reconcile.
            Map.entry("LEAD_SUBMITTED", new Kind(EngagementWakeService.NEW_LEAD, false)));
    // LEAD_CONVERTED is left out: EngagementLeadExitJob takes converted leads out within minutes.

    private final EngagementWakeService wakeService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void onEventSaved(TimelineEvent e) {
        WakeRequest r = toRequest(e);
        if (r != null) wakeService.request(r);
    }

    /** Null when the event wakes nobody. */
    WakeRequest toRequest(TimelineEvent e) {
        if (e == null || e.getActionType() == null) return null;
        Kind kind = KINDS.get(e.getActionType());
        if (kind == null) return null;
        if (ENGINE_ACTOR.equals(e.getActorType())) return null;
        JsonNode meta = metadata(e.getMetadataJson());
        if (ENGINE_ACTOR.equals(meta.path("source").asText(null))) return null;

        String type = e.getType() != null ? e.getType() : "";
        String leadRowId = null, profileId = null, enquiryId = null;
        switch (type) {
            case "LEAD", "AUDIENCE_RESPONSE" -> leadRowId = e.getTypeId();
            case "USER_LEAD_PROFILE" -> profileId = e.getTypeId();
            case "ENQUIRY" -> enquiryId = e.getTypeId();
            case "APPLICANT" -> { return null; }
            default -> { /* a person-keyed note: the student user id below */ }
        }
        String userId = e.getStudentUserId();
        if (leadRowId == null && profileId == null && enquiryId == null && userId == null) return null;
        // A new lead is enrolled by its lead row; nothing else identifies it yet.
        if (EngagementWakeService.NEW_LEAD.equals(kind.reason()) && leadRowId == null) return null;

        String callLogId = "CALL_MADE".equals(e.getActionType()) ? meta.path("call_log_id").asText(null) : null;
        String actorKey = e.getActorId() != null && !e.getActorId().isBlank()
                ? "user:" + e.getActorId()
                : "SYSTEM:" + e.getActionType();
        return new WakeRequest(e.getInstituteId(), leadRowId, userId, profileId, enquiryId, callLogId,
                kind.reason(), kind.human(), actorKey);
    }

    private JsonNode metadata(String json) {
        if (json == null || json.isBlank()) return objectMapper.createObjectNode();
        try {
            return objectMapper.readTree(json);
        } catch (Exception ex) {
            return objectMapper.createObjectNode();
        }
    }
}
