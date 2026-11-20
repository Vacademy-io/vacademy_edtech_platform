package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

/** Change a live break's last day or its note. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrolmentBreakUpdateDTO {
    private LocalDate endsOn;
    /** True = no last day: the break runs until someone resumes it. */
    private Boolean openEnded;
    private String note;
}
