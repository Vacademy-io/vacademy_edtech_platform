package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;
import java.util.Map;


@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StudentReportFilter {
    Map<String, String> sortColumns;
    private String name;
    private List<String> status;
    private List<String> releaseResultStatus;
    private List<String> assessmentType;
    // Learner batches (package session ids). When sent, only tests assigned to one of these
    // batches, or that the learner is registered for or has attempted, are returned.
    private List<String> batchIds;
}
