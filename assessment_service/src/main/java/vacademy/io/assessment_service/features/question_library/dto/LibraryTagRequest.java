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
 * Put a library tag on questions (kind + name, the tag is created when new) or take one
 * off (tag_id).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryTagRequest {
    @Builder.Default
    private List<String> questionIds = new ArrayList<>();
    /** CONCEPT, PYQ or SOURCE. */
    private String kind;
    private String name;
    private String tagId;
}
