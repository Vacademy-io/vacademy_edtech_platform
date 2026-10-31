package vacademy.io.assessment_service.features.learner_assessment.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StudentAssessmentFilter {
    private String name;
    private List<String> batchIds;
    private List<String> userIds = new ArrayList<>();
    private List<String> tagIds;
    private List<String> assessmentTypes = new ArrayList<>();
    private Boolean getLiveAssessments;
    private Boolean getPassedAssessments;
    private Boolean getUpcomingAssessments;
    private List<String> instituteIds = new ArrayList<>();
    /** Optional: only assessments in this (active) folder. */
    private String folderId;
    /** Optional: only assessments in no active folder ("Others"). */
    private Boolean unfiledOnly;
    private Map<String, String> sortColumns = new HashMap<>();
}