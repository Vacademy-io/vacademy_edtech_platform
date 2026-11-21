package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** What a Stop dues or Reopen did. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StopDuesResultDTO {

    private int stopped;
    private int reopened;
    private int removedFromCourses;
    /** Courses the learner could not be removed from, with the reason. The dues stay stopped. */
    private List<String> removalErrors;
}
