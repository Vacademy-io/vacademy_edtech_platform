package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/** Everything the learner panel needs: the switch, the courses and the breaks. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerBreaksDTO {
    private boolean enabled;
    private LocalDate today;
    private List<BreakCourseDTO> courses;
    /** Newest first; live ones (scheduled or active) first. */
    private List<EnrolmentBreakDTO> breaks;
}
