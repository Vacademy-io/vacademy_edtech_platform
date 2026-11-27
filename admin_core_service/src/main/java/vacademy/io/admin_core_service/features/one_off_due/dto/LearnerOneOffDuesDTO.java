package vacademy.io.admin_core_service.features.one_off_due.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerOneOffDuesDTO {
    private boolean enabled;
    private String defaultCurrency;
    /** The learner's batches at this institute, for the optional "relates to" picker (staff view only). */
    private List<Course> courses;
    private List<OneOffDueDTO> dues;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Course {
        private String packageSessionId;
        private String courseLabel;
    }
}
