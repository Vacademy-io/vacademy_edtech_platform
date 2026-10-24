package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdminBasicAssessmentListItemDto {
    private String assessmentId;
    private String name;
    private AssessmentRichTextDataDTO about;
    private String playMode;
    private String evaluationType;
    private String submissionType;
    private Integer duration;
    private String assessmentVisibility;
    private String status;
    private Date registrationCloseDate;
    private Date registrationOpenDate;
    private Integer expectedParticipants;
    private Integer coverFileId;
    private Date boundStartTime;
    private Date boundEndTime;
    private Long userRegistrations;
    private List<String> batchIds;
    private List<String> adminAccesses = new ArrayList<>();
    private Date createdAt;
    private Date updatedAt;
    private String subjectId;
    private String joinLink;
    private Long userAttemptCount;
    /** {@code assessment.source}: "API" for exams created through the partner API, else null. */
    private String source;

}
