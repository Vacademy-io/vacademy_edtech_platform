package vacademy.io.assessment_service.features.learner_assessment.dto.response;


import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerUpdateStatusResponse {

    private List<BasicLevelAnnouncementDto> announcements;
    private List<DurationResponse> duration = new ArrayList<>();
    private List<String> control = new ArrayList<>();
    /**
     * The attempt's current max_time in minutes. It grows when an admin approves a "more time"
     * request, and the open exam extends its clock by the difference. Null when not known.
     */
    private Integer maxTimeMinutes;


    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class DurationResponse {
        private String id;
        private String type;
        private Long newMaxTimeInSeconds;
    }


}
