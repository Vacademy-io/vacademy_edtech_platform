package vacademy.io.admin_core_service.features.engagement.actions;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionHandler;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.Map;

/**
 * ESCALATE: a person must look at this lead now. The inbox task itself is the escalation (high
 * priority); approving it records on the lead, as an AI note, that a counsellor took it.
 */
@Component
@RequiredArgsConstructor
public class EscalateActionHandler implements EngagementActionHandler {

    private final TimelineEventService timelineEventService;

    @Override public String type() { return EngagementActionTypes.ESCALATE; }

    @Override
    public String validate(Context ctx, Map<String, String> params) {
        if (ctx.leadRowId() == null) return "An escalation needs a lead; this person is not one.";
        return ActionText.text(params, "reason") == null ? "The escalation has no reason." : null;
    }

    @Override
    public String describe(Context ctx, Map<String, String> params) {
        return "A counsellor should look at this lead now: " + ActionText.text(params, "reason");
    }

    @Override
    public Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver) {
        String id = timelineEventService.logEngineNote(ctx.leadRowId(), "AI: needs a counsellor",
                ActionText.text(params, "reason"),
                Map.of("engagementActionId", ctx.actionId(), "approvedBy", String.valueOf(approver.userId())),
                ctx.member().getUserId());
        return Map.of("noteId", id);
    }

    @Override
    public void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver) {
        timelineEventService.deleteEngineNote(result.get("noteId"));
    }
}
