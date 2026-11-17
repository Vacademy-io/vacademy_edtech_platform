package vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Values for the learner-list City and Region filters: the cities and regions (states) the
 * institute's learners actually have, each with how many learners have it.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerLocationFilterOptionsDTO {
    private List<Option> cities;
    private List<Option> regions;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Option {
        /** The value as most learners spell it; send it back as-is in the list filter. */
        private String value;
        private long count;
    }
}
