package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * How many questions each filter value would give, next to the filters already set. Each
 * group is counted with every OTHER filter applied and its own left out, so ticking a second
 * value in a group shows what it adds rather than zero.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryFacetsResponse {
    /** EASY, MEDIUM, HARD (and UNKNOWN for questions without one). */
    private Map<String, Long> difficulties;
    private Map<String, Long> questionTypes;
    /** The topics right below the open one (the top level when none is open), each with everything below it. */
    private List<LibraryFacetCountDto> topics;
    /** Concept, past-paper and source tags with question_count. */
    private List<LibraryTagDto> tags;
}
