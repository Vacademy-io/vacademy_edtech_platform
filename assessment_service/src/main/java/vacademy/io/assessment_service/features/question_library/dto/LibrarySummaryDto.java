package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** Institute-wide numbers for the library header. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibrarySummaryDto {
    private Long totalQuestions;
    /** Live questions that sit in no topic. */
    private Long unsortedQuestions;
    private Long addedLastWeek;
    private Integer topicCount;
    /** EASY, MEDIUM, HARD (and UNKNOWN for questions with none). */
    private Map<String, Long> byDifficulty;
    private Map<String, Long> byType;
}
