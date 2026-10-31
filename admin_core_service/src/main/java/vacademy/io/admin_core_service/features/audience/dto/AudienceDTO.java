package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.common.dto.InstituteCustomFieldDTO;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

/**
 * DTO for Audience Campaign creation and management
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AudienceDTO {

    private String id;
    private String instituteId;
    private String campaignName;
    private String campaignType; // Comma-separated: "WEBSITE,GOOGLE_ADS,FACEBOOK_ADS"
    private String description;
    private String campaignObjective; // LEAD_GENERATION, EVENT_REGISTRATION, etc.
    private Timestamp startDateLocal;
    private Timestamp endDateLocal;
    private String status; // ACTIVE, PAUSED, COMPLETED, ARCHIVED
    private String jsonWebMetadata;
    private String toNotify; // Comma-separated emails for additional notification recipients
    private Boolean sendRespondentEmail; // Whether to send email to the respondent
    private String sessionId; // References session(id)
    private String settingJson; // JSON settings for the audience campaign
    private String createdByUserId;

    /** Floor score for new leads in this campaign. Overrides institute-level default. Null = no floor. Range 0-100. */
    private Integer defaultInitialScore;

    /** Sub-org this campaign belongs to (child-institute id). Nullable. */
    private String subOrgId;

    /**
     * The counsellor pool this lead list feeds, when it is attached to one.
     * Read-only, hydrated per page from counselor_pool_audience — an audience
     * belongs to at most ONE pool (the repository enforces it with
     * existsByAudienceId at pool create/update time), so these are single
     * values rather than a list. Null when the list has no pool, which is the
     * normal state for lists that are not auto-assigned.
     */
    private String poolId;
    private String poolName;

    /**
     * Key -> value tags on this list, e.g. {"state": "Maharashtra", "course": "MBA"}. One value
     * per key. On update, null leaves the saved tags unchanged and an empty map clears them.
     */
    private Map<String, String> tags;

    // Custom fields for the form
    private List<InstituteCustomFieldDTO> instituteCustomFields;
}

