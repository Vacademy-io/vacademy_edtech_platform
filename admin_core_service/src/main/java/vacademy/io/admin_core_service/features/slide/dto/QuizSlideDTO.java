package vacademy.io.admin_core_service.features.slide.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;
import vacademy.io.common.ai.dto.RichTextDataDTO;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class QuizSlideDTO {

    private String id;

    private RichTextDataDTO description; // Rich Text Description

    private String title;

    private Integer timeLimitInMinutes;

    private Double marksPerQuestion;

    private Double negativeMarking;

    private Double passPercentage;

    private Boolean partialMarking;

    private Integer reAttemptCount;

    private List<QuizSlideQuestionDTO> questions;
}
