package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** The whole topic tree (flat, linked by parent_id) plus the header numbers. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryTreeResponse {
    private List<LibraryNodeDto> nodes;
    private LibrarySummaryDto summary;
    /** Deepest level a topic may sit at. */
    private Integer maxDepth;
}
