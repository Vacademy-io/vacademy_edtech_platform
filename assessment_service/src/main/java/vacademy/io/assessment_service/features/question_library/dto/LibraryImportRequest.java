package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.question_core.dto.QuestionDTO;

import java.util.ArrayList;
import java.util.List;

/**
 * New questions to save straight into the library, each filed under a topic.
 * <p>
 * Each item's path is a list of topic names below parent_id (or below the top level when
 * parent_id is empty), for example ["Polity", "Fundamental Rights"]. Missing topics are
 * created. An empty path files the question under parent_id itself.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryImportRequest {
    private String parentId;
    @Builder.Default
    private List<Item> items = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Item {
        @Builder.Default
        private List<String> path = new ArrayList<>();
        private QuestionDTO question;
        /** EASY, MEDIUM or HARD. Empty keeps the question's own, else MEDIUM. */
        private String difficulty;
        @Builder.Default
        private List<TagInput> tags = new ArrayList<>();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class TagInput {
        /** CONCEPT, PYQ or SOURCE. */
        private String kind;
        private String name;
    }
}
