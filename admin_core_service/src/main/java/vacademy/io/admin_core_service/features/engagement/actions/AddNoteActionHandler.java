package vacademy.io.admin_core_service.features.engagement.actions;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionHandler;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;

import java.util.Map;

/** ADD_NOTE: a normal note on the lead, labelled AI, for the counsellor. */
@Component
@RequiredArgsConstructor
public class AddNoteActionHandler implements EngagementActionHandler {

    private final TimelineEventService timelineEventService;

    @Override public String type() { return EngagementActionTypes.ADD_NOTE; }

    @Override
    public String validate(Context ctx, Map<String, String> params) {
        if (ctx.leadRowId() == null) return "A note needs a lead; this person is not one.";
        return ActionText.text(params, "note") == null ? "The note is empty." : null;
    }

    @Override
    public String describe(Context ctx, Map<String, String> params) {
        return "Add a note on the lead: " + ActionText.text(params, "note");
    }

    @Override
    public Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver) {
        String id = timelineEventService.logEngineNote(ctx.leadRowId(), "AI note", ActionText.text(params, "note"),
                Map.of("engagementActionId", ctx.actionId(), "approvedBy", String.valueOf(approver.userId())),
                ctx.member().getUserId());
        return Map.of("noteId", id);
    }

    @Override
    public void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver) {
        timelineEventService.deleteEngineNote(result.get("noteId"));
    }
}
