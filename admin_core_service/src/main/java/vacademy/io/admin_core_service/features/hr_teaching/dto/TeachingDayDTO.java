package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/** Per-date breakdown of a teacher's month. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingDayDTO {

    private LocalDate date;
    private int sessionsScheduled;
    private int sessionsWithAttendance;
    private long taughtMinutes;
    private List<TeachingOccurrenceDTO> occurrences;
}
