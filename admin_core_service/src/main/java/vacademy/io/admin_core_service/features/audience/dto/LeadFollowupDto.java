package vacademy.io.admin_core_service.features.audience.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;
import vacademy.io.admin_core_service.features.audience.entity.LeadFollowup;

import java.sql.Timestamp;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LeadFollowupDto {

    private String id;
    private String audienceResponseId;
    private String instituteId;
    private String createdBy;
    private Timestamp scheduleTime;
    private String status;
    private Boolean isClosed;
    private String content;
    private String studentResponse;
    private String followUpMode;
    private String nextAction;
    private String interestLevel;
    private String closerReason;
    private String closedBy;
    private Timestamp closedAt;
    private Timestamp createdAt;
    private Timestamp updatedAt;

    /**
     * Lead display fields, hydrated from audience_response on the list paths
     * (the reminder feed needs a name to show) - null on every other endpoint.
     */
    private String leadName;
    private String leadMobile;
    private String leadUserId;

    /**
     * The rest of the lead, hydrated only where a caller needs a row that stands on
     * its own - the Completed queue and its CSV export. A completed follow-up is the
     * only view of that lead the reporting team gets, so a row carrying just a name
     * and a note cannot be read without opening the lead.
     */
    private String leadEmail;
    /** The audience/campaign the lead came in on — the list's "Source" column. */
    private String leadSource;
    private String leadStatus;
    private String leadTier;
    private String assignedCounselorName;
    /** Form answers keyed by custom_field_id, same shape as LeadDetailDTO. */
    private Map<String, String> customFieldValues;
    /** custom_field_id -> { fieldName, fieldKey, fieldType }, same shape as LeadDetailDTO. */
    private Map<String, Object> customFieldMetadata;

    public static LeadFollowupDto from(LeadFollowup f) {
        return LeadFollowupDto.builder()
                .id(f.getId())
                .audienceResponseId(f.getAudienceResponseId())
                .instituteId(f.getInstituteId())
                .createdBy(f.getCreatedBy())
                .scheduleTime(f.getScheduleTime())
                .status(f.getStatus())
                .isClosed(f.getIsClosed())
                .content(f.getContent())
                .studentResponse(f.getStudentResponse())
                .followUpMode(f.getFollowUpMode())
                .nextAction(f.getNextAction())
                .interestLevel(f.getInterestLevel())
                .closerReason(f.getCloserReason())
                .closedBy(f.getClosedBy())
                .closedAt(f.getClosedAt())
                .createdAt(f.getCreatedAt())
                .updatedAt(f.getUpdatedAt())
                .build();
    }
}
