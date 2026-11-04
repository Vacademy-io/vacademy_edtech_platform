package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** How many questions of each difficulty to pick at random. All zero only reports what is available. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryRandomPickRequest {
    /** Topics, with everything below them. Empty means the whole library. */
    @Builder.Default
    private List<String> libraryNodeIds = new ArrayList<>();
    @Builder.Default
    private List<String> questionTypes = new ArrayList<>();
    /** Questions already in the section. Library questions they were copied from are skipped. */
    @Builder.Default
    private List<String> excludeQuestionIds = new ArrayList<>();
    private Integer easy;
    private Integer medium;
    private Integer hard;
}
