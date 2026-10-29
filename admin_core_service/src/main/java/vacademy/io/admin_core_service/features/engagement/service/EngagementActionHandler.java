package vacademy.io.admin_core_service.features.engagement.service;

import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.Instant;
import java.util.Map;

/**
 * B6: one CRM action the brain may propose (design D24). The brain fills {@code params}; the
 * handler checks them when the task is drafted and again when a person approves it, does the
 * action through the CRM's own service (never a second follow-up system or call queue), and can
 * undo it (S9).
 */
public interface EngagementActionHandler {

    /** One of {@link EngagementActionTypes#CRM_TYPES}. */
    String type();

    /** Null when the action may go ahead, else why not (shown in the inbox / the decision log). */
    String validate(Context ctx, Map<String, String> params);

    /** The inbox text a person approves: what will happen, in one or two sentences. */
    String describe(Context ctx, Map<String, String> params);

    /** Do it. Returns what undo needs (ids written), merged into the task's variables. */
    Map<String, String> execute(Context ctx, Map<String, String> params, Approver approver);

    /** Reverse a done action using what execute returned. */
    void undo(Context ctx, Map<String, String> params, Map<String, String> result, Approver approver);

    /**
     * The lead the action is about. {@code leadRowId} is required for every CRM action (the CRM
     * keys follow-ups, statuses and notes by lead row).
     */
    record Context(EngagementEngine engine, EngagementMember member, String leadRowId, String phone,
                   String actionId, Instant now) {
        public String instituteId() {
            return engine.getInstituteId();
        }
    }

    /** Who approved it: a person in the inbox (user set) or, for a scheduled call, the stored approver. */
    record Approver(String userId, String name, CustomUserDetails user) {}
}
