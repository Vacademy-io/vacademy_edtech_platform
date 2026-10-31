package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.Map;
import vacademy.io.common.auth.dto.UserDTO;

/**
 * DTO for detailed lead information with custom field values
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadDetailDTO {

    private String responseId;
    private String audienceId;
    private String campaignName;
    /** The audience's campaign type, i.e. the channel the lead came in through (FACEBOOK, GOOGLE ADS...). */
    private String campaignType;
    /** Latest UTM tagging for this lead, so the list can show where it came from. */
    private String utmSource;
    private String utmCampaign;
    private String userId;
    private String studentUserId;
    private String sourceType;
    private String sourceId;
    private Timestamp submittedAtLocal;
    
    // Optional hydrated user details (batch fetched)
    private UserDTO user;
    
    // Custom field values with field metadata
    // Key: fieldKey (e.g., "email", "phone"), Value: submitted value
    private Map<String, String> customFieldValues;
    
    // Additional metadata
    private Map<String, Object> customFieldMetadata; // fieldKey -> {fieldName, fieldType, etc.}

    // ── Lead Score (auto-populated from lead_score table) ──
    private Integer leadScore;              // Raw score 0-100
    /**
     * HOT / WARM / COLD. The tier stored on the lead profile wins; the tier derived
     * from leadScore is only the fallback. That is the same precedence the lead
     * tables use (tierCatalog.resolve(profile.lead_tier, profile.best_score)), and it
     * matters for an institute that imported its own interest level - deriving from
     * the score would quietly report a different tier than the UI shows.
     */
    private String leadTier;
    private Double percentileRank;          // 0-100

    // ── Counselor Assignment ──
    // Resolved from the linked ENQUIRY first, then from the lead profile. Leads that
    // never came through an enquiry (e.g. a CRM import) carry their counsellor only
    // on the profile, so reading the enquiry alone returns null for all of them.
    private String assignedCounselorId;
    private String assignedCounselorName;

    // ── Dedup Info ──
    private Boolean isDuplicate;
    /** The lead has an open priority follow-up (opened for a repeat-lead reattempt). */
    private Boolean followUpPriority;
    private String primaryResponseId;
    /** Live duplicate enquiries that repeat this lead; null when there are none. */
    private Integer duplicateCount;

    // ── Parent Info ──
    private String parentName;
    private String parentEmail;
    private String parentMobile;

    // ── Status ──
    private String overallStatus;
    private String conversionStatus;
    private String enquiryId;
    /** Custom pipeline status (from the linked enquiry's enquiry_status, e.g. NEW / INTERESTED). */
    private String leadStatus;

    // ── Opt-Out Source ──
    private String sourceAudienceName; // name of the audience the user opted out FROM

    // ── Next scheduled follow-up (the counsellor's own notes on it) ──
    // These mirror the earliest OPEN lead_followup row, the same one followUpDueAt
    // is read from, so a CSV export of a follow-up queue can carry what the
    // counsellor actually wrote without a second round of requests.
    private String followUpContent;
    private String followUpStudentResponse;
    private String followUpMode;
    private String followUpNextAction;
    /** Interest level recorded on that same open follow-up (lead_followup.interest_level). */
    private String followUpInterestLevel;

    // ── TAT / Follow-up SLA (deadlines computed live from SLA config; badges from scheduler state) ──
    private Timestamp tatDueAt;          // reach-out deadline: admin override, else working-hours-aware lead_sla_due_at (live when TAT enabled)
    private Boolean tatDueOverridden;    // true when an admin set tatDueAt by hand (PUT .../tat-due)
    private Timestamp firstResponseAt;   // first time the assigned counselor acted on this lead (null until they act)
    private Timestamp followUpDueAt;     // follow-up deadline = last counselor action + followUpSlaHours (null until acted)
    private String tatReminderStage;     // canonical stage last emitted: TAT_BEFORE / TAT_OVERDUE / FOLLOW_UP_DUE / FOLLOW_UP_OVERDUE
    private Boolean tatOverdue;          // TAT breached and counselor hasn't acted
    private Boolean tatDueSoon;          // inside a "before TAT" / follow-up-due window
    private Boolean followUpOverdue;     // follow-up SLA crossed
    private Boolean slaClosed;           // lead is Lost / Converted: off the SLA clock, no Pending / Overdue
}

