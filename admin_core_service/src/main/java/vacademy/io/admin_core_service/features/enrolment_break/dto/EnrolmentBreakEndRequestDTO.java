package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/** Resume a break now. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrolmentBreakEndRequestDTO {
    /** SHIFT_BY_PAUSED_DAYS (default), KEEP_DATES or NEW_DATE. Pause only. */
    private String resumeMode;
    /** NEW_DATE only: the membership (and its next payment) runs until this date. */
    private LocalDate newEndDate;
    /** Also move unpaid instalment due dates (instalment plans). Default true. */
    private Boolean moveUnpaidInstalments;
    private String note;
}
