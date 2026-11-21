package vacademy.io.admin_core_service.features.learner_study_library.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** A chapter and its slides as an open (no login) endpoint may show them. */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PublicChapterOutlineDTO {
    private Chapter chapter;
    private List<PublicSlideOutlineDTO> slides;

    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Chapter {
        private String id;
        private String chapterName;
        private String status;
        private String fileId;
        private String description;
        private Integer chapterOrder;
    }
}
