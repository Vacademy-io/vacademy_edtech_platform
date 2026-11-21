package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** A library tag: a concept, a past-paper year or a source. question_count is set only in tag lists. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryTagDto {
    private String tagId;
    private String tagName;
    /** CONCEPT, PYQ or SOURCE. */
    private String kind;
    private Long questionCount;
}
