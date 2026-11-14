package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/**
 * Answer to "is this phone / email already in the system?".
 *
 * Every field is nullable and {@code NON_NULL} is deliberate: a field the
 * institute did not share is absent from the JSON entirely, not sent as null.
 * Hiding a column in the UI while still shipping its value would make the
 * network tab a way around the setting.
 *
 * There is no lead id, response id or user id here, and that is also deliberate
 * — with one the caller could pivot to the lead-profile endpoints, which apply
 * no such masking.
 *
 * <p>The follow-up block ({@code leadCreatedAt} down to {@code followUps}) is only
 * filled for an admin or the lead's own counsellor; {@code followUpsVisible}
 * says which, so the page can explain an empty history instead of implying the
 * lead was never called.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadLookupResultDto {

    /** False means no match; every other field is then absent. */
    private boolean found;

    private String leadName;
    private String leadEmail;
    private String leadMobile;
    /** The "Assigned To" counsellor. */
    private String counsellorName;
    /** "Enquired By" — the staff member who entered the lead; absent for self-submitted leads. */
    private String enquiredBy;
    /** The institute's "Source" — audience.campaign_type. */
    private String campaignType;
    /** The institute's "Campaign" / "Label" — audience.campaign_name. */
    private String campaignName;
    private String status;
    /**
     * Status bucket next to the label: ADMISSION_ONGOING, ADMISSION_COMPLETED,
     * ADMISSION_TAKEN (admitted, no enrolment found), DISCARDED or PENDING.
     * Shared under the same switch as {@code status}.
     */
    private String stage;
    private String course;
    private String branch;

    /**
     * True when the lead opted out. Always sent on a match, regardless of which
     * fields the institute shares — "do not call this person" is a warning, not
     * lead data, and withholding it would cause the exact call it prevents.
     */
    private Boolean optedOut;

    /** True when the follow-up block below is filled; false = hidden from this caller. */
    private Boolean followUpsVisible;

    private Timestamp leadCreatedAt;
    /** Earliest still-open follow-up, if any. */
    private Timestamp nextFollowUpAt;
    /** The lead's tier label — what the institute calls Interest Level. */
    private String interestLevel;
    /** Newest first, across every enquiry by this person. */
    private List<FollowUpEntry> followUps;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class FollowUpEntry {
        private Timestamp scheduleTime;
        /** PENDING / ONGOING / OVERDUE / COMPLETED. */
        private String status;
        private String counsellorName;
        /** lead_followup.next_action — the institute's "Action Label". */
        private String actionLabel;
        private String mode;
        /** May contain HTML from the rich-text editor. */
        private String comments;
        private String studentResponse;
        /** What the counsellor recorded on this follow-up - not the lead's tier. */
        private String interestLevel;
        private String closerReason;
        private Timestamp closedAt;
        private Timestamp createdAt;
    }
}
