package vacademy.io.admin_core_service.features.hr_teaching.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Result counts of a teaching → hr_attendance sync run. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TeachingAttendanceSyncResultDTO {

    private String instituteId;
    private Integer month;
    private Integer year;
    private boolean requireLog;

    /** New PRESENT rows inserted. */
    private int created;
    /** Existing non-PRESENT/non-ON_LEAVE rows upgraded to PRESENT. */
    private int updated;
    /** Rows left untouched (already PRESENT or ON_LEAVE, or concurrent insert race). */
    private int skipped;
    /** Distinct (employee, date) pairs considered. */
    private int datesConsidered;

    /** Teacher userIds that created sessions but have no HR employee profile (not synced). */
    private List<String> teachersWithoutProfile;
}
