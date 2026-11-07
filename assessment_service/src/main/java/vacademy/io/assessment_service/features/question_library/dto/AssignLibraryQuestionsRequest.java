package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** Put questions into topics. MOVE first takes them off from_node_id (or off every topic when it is null). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AssignLibraryQuestionsRequest {
    @Builder.Default
    private List<String> questionIds = new ArrayList<>();
    @Builder.Default
    private List<String> nodeIds = new ArrayList<>();
    /** ADD (default) or MOVE. */
    private String mode;
    private String fromNodeId;
}
