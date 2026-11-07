package vacademy.io.admin_core_service.features.learner_badge.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.learner_badge.entity.LearnerBadge;

import java.sql.Timestamp;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LearnerBadgeDTO {

    private String id;
    private String userId;
    private String instituteId;
    private String badgeId;
    private String badgeName;
    private String badgeIcon;
    private String badgeDescription;
    private String reason;
    private String status;
    /** MANUAL = staff-awarded; AUTO = synced from the learner app's client-computed unlocks. */
    private String source;
    private String awardedByUserId;
    private Timestamp awardedAt;

    public static LearnerBadgeDTO fromEntity(LearnerBadge b) {
        LearnerBadgeDTO dto = new LearnerBadgeDTO();
        dto.setId(b.getId());
        dto.setUserId(b.getUserId());
        dto.setInstituteId(b.getInstituteId());
        dto.setBadgeId(b.getBadgeId());
        dto.setBadgeName(b.getBadgeName());
        dto.setBadgeIcon(b.getBadgeIcon());
        dto.setBadgeDescription(b.getBadgeDescription());
        dto.setReason(b.getReason());
        dto.setStatus(b.getStatus() != null ? b.getStatus().name() : null);
        dto.setSource(b.getSource());
        dto.setAwardedByUserId(b.getAwardedByUserId());
        dto.setAwardedAt(b.getAwardedAt());
        return dto;
    }
}
