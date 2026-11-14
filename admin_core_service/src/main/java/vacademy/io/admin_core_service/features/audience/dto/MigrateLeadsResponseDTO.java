package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Outcome of a lead-list migration: how many moved, and exactly which leads did not and why.
 *
 * <p>Follows the bulk-import result shape rather than delete's all-or-nothing behaviour. Merging
 * two lists collides by definition — the same person is often in both — so a batch that refused
 * to do anything because one lead collided would be useless at the sizes this is used at.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class MigrateLeadsResponseDTO {

    /** How many leads actually changed list. */
    private int migrated;

    /** Leads that were deliberately not moved, each with a machine-readable reason. */
    private List<SkippedLead> skipped;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SkippedLead {

        private String responseId;

        /** One of {@link SkipReason}, as a string. */
        private String reason;

        /** Human-readable explanation, safe to show in the UI. */
        private String detail;
    }

    /** Why a lead was left where it was. */
    public enum SkipReason {

        /** Already in the target list — the move is a no-op, so it is idempotent, not an error. */
        ALREADY_IN_TARGET_LIST,

        /**
         * The person already holds a response in the target list. One response per person per list
         * is an invariant the intake guards rely on ({@code existsByAudienceIdAndUserId}); it is
         * enforced only in code, with no unique index behind it, so a move has to check it
         * explicitly or it would silently create the duplicate those guards assume cannot exist.
         */
        DUPLICATE_USER_IN_TARGET,

        /**
         * The institute's deduplication setting (LEAD_SETTING.data.dedup) says a lead with this
         * email/phone already exists in the target list, and the configured action is REJECT.
         * Dedup is scoped per list, so a lead that is unique in its current list can still collide
         * once it lands in another one.
         */
        DUPLICATE_IN_TARGET,

        /** Converted leads are not moved, matching how soft-delete treats them. */
        LEAD_CONVERTED,

        /**
         * The lead has opted out of contact. Opt-out is recorded as
         * {@code overall_status = 'OPTED_OUT'} on the row and is honoured by every list query,
         * report and dedup predicate — moving such a row must not be a way around that.
         */
        OPTED_OUT,

        /**
         * The lead currently sits in the institute's opt-out list. That row carries no OPTED_OUT
         * flag of its own — the flag stayed on the row it replaced — so moving it into a normal
         * list would silently re-subscribe someone who explicitly asked not to be contacted.
         */
        IN_OPT_OUT_LIST,

        /** The lead is soft-deleted. Restore it first if the intent is to move it. */
        LEAD_DELETED
    }
}
