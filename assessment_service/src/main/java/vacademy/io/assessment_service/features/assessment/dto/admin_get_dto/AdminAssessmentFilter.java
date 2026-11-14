package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto;

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
public class AdminAssessmentFilter {
    private String name;
    private List<String> batchIds;
    private List<String> subjectsIds;
    private List<String> tagIds;
    private Boolean getLiveAssessments;
    private Boolean getPassedAssessments;
    private Boolean getUpcomingAssessments;
    private List<String> assessmentTypes = new ArrayList<>();
    private List<String> evaluationTypes = new ArrayList<>();
    private List<String> instituteIds = new ArrayList<>();
    private List<String> assessmentStatuses = new ArrayList<>();
    private List<String> assessmentModes = new ArrayList<>();
    private List<String> accessStatuses = new ArrayList<>();
    /**
     * Optional "Source" filter of the assessment list (spec 12): {@code API} for exams
     * created through the partner API, {@code DASHBOARD} for every other exam. Empty = all.
     */
    private List<String> sources = new ArrayList<>();
    /** Optional: only assessments in this folder. */
    private String folderId;
    /** Optional: only assessments that are in no folder. */
    private Boolean unfiledOnly;
    private Map<String, String> sortColumns = new HashMap<>();
}