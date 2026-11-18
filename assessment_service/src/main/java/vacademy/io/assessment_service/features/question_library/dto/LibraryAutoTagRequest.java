package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * One batch of AI concept tagging under a topic. The caller repeats it, passing every id
 * tried so far in exclude_question_ids, until remaining is 0. limit 0 only counts.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryAutoTagRequest {
    private String nodeId;
    @Builder.Default
    private List<String> excludeQuestionIds = new ArrayList<>();
    private Integer limit;
}
