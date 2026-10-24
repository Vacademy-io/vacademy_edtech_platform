package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request body for moving leads from one lead list to another.
 *
 * <p>A "lead list" is an {@code audience} row; a lead is an {@code audience_response}. Moving is
 * therefore an update of {@code audience_response.audience_id}. Everything keyed by response id
 * — status history, follow-ups, calls, timeline, engagement — follows the row automatically.</p>
 *
 * <p>Partial success by design: colliding leads are skipped and reported rather than failing the
 * batch, because the common cases (merging two lists, re-routing a misconfigured form) collide
 * routinely and an all-or-nothing move of several thousand leads would be unusable.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class MigrateLeadsRequestDTO {

    /** The audience_response ids to move. Under USER scope these identify the people instead. */
    private List<String> responseIds;

    /** The lead list to move them into. Must belong to {@link #instituteId}. */
    private String targetAudienceId;

    /** Required: the move is institute-scoped and the ADMIN check is per institute. */
    private String instituteId;

    /**
     * RESPONSE (default) — move exactly the given responses.
     * USER — move every lead those people hold in this institute.
     */
    private String scope;

    /**
     * What to do with {@code workflow_activate_day_at}, the anchor every audience drip selects on.
     * See {@link WorkflowAnchorMode}. Defaults to PRESERVE.
     */
    private String workflowAnchor;
    /**
     * Fire the target list's event-driven automations for each moved lead — i.e. emit
     * {@code AUDIENCE_LEAD_SUBMISSION} on the target audience exactly as a fresh submission
     * would, with {@code leadSource = "LEAD_MOVED"} in the context so a workflow can tell the
     * two apart. {@link WorkflowAnchorMode#RESET_TO_TARGET} implies this (treating a lead as
     * new means its Lead-Submitted workflows run too — the AI call, the instant messages);
     * this flag additionally lets an API caller fire them under {@code PRESERVE}. Either way
     * the respondent/admin "thank you for submitting" emails are NOT sent. Defaults to false.
     */
    private Boolean runDestinationAutomations;

    /**
     * How a moved lead relates to the target list's automation.
     *
     * <p>Workflows pick leads by {@code audience_id} plus a date window on
     * {@code workflow_activate_day_at}, and that anchor is computed only at insert. There is no
     * per-lead "already sent" marker anywhere in the engine, so the choice here decides whether a
     * moved lead gets messaged — and a wrong default sends real messages to real people.</p>
     */
    public enum WorkflowAnchorMode {
        /**
         * Default. Keep the existing anchor. The source list's drip stops (its queries no longer
         * match), and the stale anchor will not line up with the target list's day windows, so in
         * practice the lead receives nothing further. Correct for re-routing a misdirected form,
         * archiving to a "Cold" list, or quarantining junk — anywhere the move is bookkeeping and
         * must not trigger outreach.
         */
        PRESERVE,

        /**
         * Recompute the anchor from the target list's {@code workflow_setting.offset_day}, exactly
         * as a freshly created lead would get. The lead then enters the target list's drip at day
         * zero. This is the re-engagement case: pulling lapsed leads into a "Win-back" list
         * precisely so that list's sequence runs on them.
         *
         * <p>Deliberate outreach — only use it when messaging the moved leads is the intent.</p>
         */
        RESET_TO_TARGET
    }
}
