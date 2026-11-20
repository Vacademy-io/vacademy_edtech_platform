package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** One break as the admin sees it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrolmentBreakDTO {
    private String id;
    private String userId;
    private String kind;
    private String status;
    private String packageSessionId;
    /** Readable course name, or null for "all courses". */
    private String courseLabel;
    private String userPlanId;
    private boolean stopClassReminders;
    private boolean stopFeeReminders;
    private boolean removeAccess;
    private LocalDate startsOn;
    private LocalDate endsOn;
    private String reason;
    private String note;
    private Integer daysSoFar;
    private String endKind;
    private String resumeMode;
    private Integer shiftedDays;
    private LocalDateTime planEndBefore;
    private LocalDateTime planEndAfter;
    private LocalDateTime startedAt;
    private LocalDateTime endedAt;
    private LocalDateTime createdAt;
    private String createdByUserId;
}
