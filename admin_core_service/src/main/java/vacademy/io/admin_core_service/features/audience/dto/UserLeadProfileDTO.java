package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

import java.sql.Timestamp;

/**
 * Response DTO for the user-level lead profile (user_lead_profile table).
 * Returned by GET /admin-core-service/v1/audience/user-lead-profile?userId=...
 */
@Data
@Builder
public class UserLeadProfileDTO {

    @JsonProperty("user_id")
    private String userId;

    @JsonProperty("institute_id")
    private String instituteId;

    @JsonProperty("best_score")
    private Integer bestScore;

    @JsonProperty("best_score_response_id")
    private String bestScoreResponseId;

    @JsonProperty("lead_tier")
    private String leadTier;

    @JsonProperty("conversion_status")
    private String conversionStatus;

    @JsonProperty("converted_at")
    private Timestamp convertedAt;

    @JsonProperty("campaign_count")
    private Integer campaignCount;

    @JsonProperty("best_source_type")
    private String bestSourceType;

    @JsonProperty("total_timeline_events")
    private Integer totalTimelineEvents;

    @JsonProperty("demo_login_count")
    private Integer demoLoginCount;

    @JsonProperty("demo_attendance_count")
    private Integer demoAttendanceCount;

    @JsonProperty("last_activity_at")
    private Timestamp lastActivityAt;

    @JsonProperty("last_calculated_at")
    private Timestamp lastCalculatedAt;

    @JsonProperty("created_at")
    private Timestamp createdAt;

    @JsonProperty("assigned_counselor_id")
    private String assignedCounselorId;

    @JsonProperty("assigned_counselor_name")
    private String assignedCounselorName;

    /** Set when this person was merged into another person; the profile no longer counts as a lead. */
    @JsonProperty("merged_into_user_id")
    private String mergedIntoUserId;

    @JsonProperty("merged_at")
    private Timestamp mergedAt;
}
