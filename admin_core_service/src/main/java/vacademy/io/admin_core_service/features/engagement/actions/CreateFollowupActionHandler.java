package vacademy.io.admin_core_service.features.engagement.actions;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.audience.dto.CloseLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.dto.CreateLeadFollowupRequest;
import vacademy.io.admin_core_service.features.audience.service.LeadFollowupService;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionHandler;
import vacademy.io.admin_core_service.features.engagement.service.EngagementActionTypes;
import vacademy.io.admin_core_service.features.engagement.service.EngagementCoordinationDao;
import vacademy.io.admin_core_service.features.engagement.service.EngagementWakeService;
import vacademy.io.admin_core_service.features.engagement.service.PolicyGate;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * CREATE_FOLLOWUP through the CRM's own LeadFollowupService (no second follow-up system).
 * <ul>
 *   <li>F-4: never a second one — refused while the lead has an open follow-up (checked when the
 *   task is drafted and again on approval, a counsellor may have added one meanwhile).</li>
 *   <li>F-3: the time is at least an hour out and moved out of the institute's quiet hours.</li>
 *   <li>F-5: it is created by the person who approves it, so a lead without a counsellor still
 *   has an owner for it.</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
public class CreateFollowupActionHandler implements EngagementActionHandler {

    static final int DEFAULT_HOURS = 24;
    static final int MAX_HOURS = 24 * 14;

    private final LeadFollowupService leadFollowupService;
    private final EngagementCoordinationDao coordinationDao;
    private final PolicyGate policyGate;

    @Override public String type() { return EngagementActionTypes.CREATE_FOLLOWUP; }

    @Override
    public String validate(Context ctx, Map<String, String> params) {
        if (ctx.leadRowId() == null) return "A follow-up needs a lead; this person is not one.";
        if (ActionText.text(params, "note") == null) return "The follow-up says nothing to discuss.";
        if (coordinationDao.openFollowups(ctx.instituteId(), ctx.leadRowId()) > 0) {
            return "This lead already has an open follow-up.";
        }
        return null;
    }

    /** F-3: at least an hour out, then out of quiet hours (the institute floor plus the engine's own). */
    Instant dueAt(Context ctx, Map<String, String> params) {
        int hours = ActionText.hours(params, "dueInHours", DEFAULT_HOURS, 1, MAX_HOURS);
        Instant t = ctx.now().plus(Duration.ofHours(hours));
        return policyGate.clampToAllowedWindow(ctx.engine(), t);
    }

    @Override
    public String describe(Context ctx, Map<String, String> params) {
        return "Create a follow-up for " + dueAt(ctx, params) + ": " + ActionText.text(params, "note");
    }

    @Override
    public Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver) {
        if (approver.user() == null) throw new VacademyException("A follow-up needs the person who approves it.");
        CreateLeadFollowupRequest req = new CreateLeadFollowupRequest();
        req.setAudienceResponseId(ctx.leadRowId());
        req.setInstituteId(ctx.instituteId());
        req.setScheduleTime(Timestamp.from(dueAt(ctx, params)));
        req.setContent("AI suggestion: " + ActionText.text(params, "note"));
        // The engine's own CRM write: it must not wake the engine (or hold it as a counsellor's touch).
        String id = EngagementWakeService.withoutWakes(() -> leadFollowupService.create(req, approver.user()).getId());
        return Map.of("followupId", id);
    }

    @Override
    public void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver) {
        if (approver.user() == null) throw new VacademyException("Undo needs the person who asks for it.");
        CloseLeadFollowupRequest req = new CloseLeadFollowupRequest();
        req.setCloserReason("Withdrawn: the engagement engine's follow-up was undone.");
        EngagementWakeService.withoutWakes(() -> leadFollowupService.close(result.get("followupId"), req, approver.user()));
    }
}
