package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/** A new break, or a preview of one. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrolmentBreakRequestDTO {
    private String userId;
    /** HOLD or PAUSE. */
    private String kind;
    /** The course (package session) it applies to; null = all of the learner's courses (hold only). */
    private String packageSessionId;
    private Boolean stopClassReminders;
    private Boolean stopFeeReminders;
    /** Pause only. */
    private Boolean removeAccess;
    private LocalDate startsOn;
    /** Null = until resumed by hand. */
    private LocalDate endsOn;
    private String reason;
    private String note;
}
