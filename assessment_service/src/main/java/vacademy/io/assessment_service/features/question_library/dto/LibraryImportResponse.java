package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** What an import did: questions saved, topics created, and the items that could not be saved. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryImportResponse {
    private Integer created;
    private Integer nodesCreated;
    /** One line per item that was skipped, "Item 3: ..." (1-based, in request order). */
    @Builder.Default
    private List<String> errors = new ArrayList<>();
}
