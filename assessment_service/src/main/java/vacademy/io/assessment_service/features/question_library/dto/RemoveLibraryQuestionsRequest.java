package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** Take questions off one topic. The questions themselves are not deleted. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RemoveLibraryQuestionsRequest {
    @Builder.Default
    private List<String> questionIds = new ArrayList<>();
    private String nodeId;
}
