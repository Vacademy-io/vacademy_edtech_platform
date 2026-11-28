package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Create or rename a topic. parent_id is read on create only, moving goes through MoveLibraryNodeRequest. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryNodeRequest {
    private String name;
    private String description;
    private String parentId;
}
