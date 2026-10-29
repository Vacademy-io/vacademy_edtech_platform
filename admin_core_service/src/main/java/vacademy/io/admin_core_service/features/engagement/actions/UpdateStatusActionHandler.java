package vacademy.io.admin_core_service.features.engagement.actions;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadStatusService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionHandler;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * UPDATE_STATUS through LeadStatusService (history, workflow trigger, the CRM's one path).
 * Never Converted: a person confirms that (a payment, an enrolment). Lost and Not interested end
 * the lead's pipeline, so they need a note that says what the lead said or did; the note is
 * written on the lead next to the change. Any other active status of the institute may be set.
 * A Lost lead then leaves its engines within one exit sweep (B5).
 */
@Component
@RequiredArgsConstructor
public class UpdateStatusActionHandler implements EngagementActionHandler {

    /** The status source the CRM records: the wake hook and the timeline readers key on it. */
    static final String SOURCE = TimelineEventService.ENGINE_ACTOR_TYPE;

    private final LeadStatusService leadStatusService;
    private final AudienceResponseRepository audienceResponseRepository;
    private final TimelineEventService timelineEventService;

    @Override public String type() { return EngagementActionTypes.UPDATE_STATUS; }

    /** The statuses the engine may choose from: the institute's active ones, never Converted. */
    public List<LeadStatus> allowedStatuses(String instituteId) {
        return leadStatusService.listForInstitute(instituteId).stream()
                .filter(s -> s.getStatusKey() != null
                        && !EngagementActionTypes.FORBIDDEN_STATUS_KEYS.contains(s.getStatusKey()))
                .toList();
    }

    private Optional<LeadStatus> target(Context ctx, Map<String, String> params) {
        String key = ActionText.text(params, "statusKey");
        if (key == null) return Optional.empty();
        return leadStatusService.listForInstitute(ctx.instituteId()).stream()
                .filter(s -> key.equalsIgnoreCase(s.getStatusKey())).findFirst();
    }

    @Override
    public String validate(Context ctx, Map<String, String> params) {
        if (ctx.leadRowId() == null) return "A status change needs a lead; this person is not one.";
        String key = ActionText.text(params, "statusKey");
        if (key == null) return "No status chosen.";
        if (EngagementActionTypes.FORBIDDEN_STATUS_KEYS.contains(key.toUpperCase())) {
            return "The engine never marks a lead Converted; a person does.";
        }
        Optional<LeadStatus> target = target(ctx, params);
        if (target.isEmpty()) return "This institute has no active status '" + key + "'.";
        if (EngagementActionTypes.STATUS_KEYS_NEEDING_NOTE.contains(target.get().getStatusKey())
                && ActionText.text(params, "note") == null) {
            return "Marking a lead " + target.get().getLabel() + " needs a note that explains why.";
        }
        String current = audienceResponseRepository.findById(ctx.leadRowId())
                .map(AudienceResponse::getLeadStatusId).orElse(null);
        if (target.get().getId().equals(current)) return "The lead is already " + target.get().getLabel() + ".";
        return null;
    }

    @Override
    public String describe(Context ctx, Map<String, String> params) {
        String label = target(ctx, params).map(LeadStatus::getLabel).orElse(ActionText.text(params, "statusKey"));
        String note = ActionText.text(params, "note");
        return "Move the lead to " + label + (note != null ? ": " + note : ".");
    }

    @Override
    public Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver) {
        LeadStatus target = target(ctx, params)
                .orElseThrow(() -> new VacademyException("That status no longer exists."));
        String from = audienceResponseRepository.findById(ctx.leadRowId())
                .map(AudienceResponse::getLeadStatusId).orElse(null);
        EngagementWakeService.withoutWakes(() -> leadStatusService.changeLeadStatus(
                ctx.leadRowId(), target.getId(), approver.userId(), SOURCE));
        Map<String, String> result = new HashMap<>();
        if (from != null) result.put("fromStatusId", from);
        String note = ActionText.text(params, "note");
        if (note != null) {
            result.put("noteId", timelineEventService.logEngineNote(ctx.leadRowId(),
                    "AI: status moved to " + target.getLabel(), note,
                    Map.of("engagementActionId", ctx.actionId(), "approvedBy", String.valueOf(approver.userId())),
                    ctx.member().getUserId()));
        }
        return result;
    }

    @Override
    public void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver) {
        String from = result.get("fromStatusId");
        if (from == null) throw new VacademyException("The lead had no status before, so there is nothing to go back to.");
        EngagementWakeService.withoutWakes(() -> leadStatusService.changeLeadStatus(
                ctx.leadRowId(), from, approver.userId(), SOURCE));
        timelineEventService.deleteEngineNote(result.get("noteId"));
    }
}
