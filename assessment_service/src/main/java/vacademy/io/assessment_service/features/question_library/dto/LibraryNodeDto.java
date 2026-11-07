package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** A topic in the question library, with live question counts that include every topic below it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryNodeDto {
    private String id;
    private String parentId;
    private String name;
    private String description;
    private Integer displayOrder;
    /** 1 for a top-level topic. */
    private Integer depth;
    private Long questionCount;
    private Long easyCount;
    private Long mediumCount;
    private Long hardCount;
}
