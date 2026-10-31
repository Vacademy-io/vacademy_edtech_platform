package vacademy.io.admin_core_service.features.learner_badge.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Request to manually award a configured badge to one or more learners.
 * Accepts a list of userIds so a future bulk-award UI needs no API change.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AwardBadgeRequest {

    public static final int MAX_USER_IDS = 500;

    /** Capped so one call (and its single batched notification) stays bounded; the FE chunks larger selections. */
    @NotEmpty(message = "userIds cannot be empty")
    @Size(max = MAX_USER_IDS, message = "at most 500 userIds per call")
    private List<String> userIds;

    /** learner_badge.badge_id is varchar(255). */
    @NotBlank(message = "badgeId is required")
    @Size(max = 255, message = "badgeId must be at most 255 characters")
    private String badgeId;

    // Snapshot of the badge's presentation at award time.
    private String badgeName;
    private String badgeIcon;
    private String badgeDescription;

    /** Optional note shown to the learner ("Note for the learner"). */
    private String reason;
}
