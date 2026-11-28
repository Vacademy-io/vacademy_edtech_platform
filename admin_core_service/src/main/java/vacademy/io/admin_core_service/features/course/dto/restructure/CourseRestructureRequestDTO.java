package vacademy.io.admin_core_service.features.course.dto.restructure;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Request body for POST /admin-core-service/course/v1/restructure/{instituteId}/{courseId}.
 *
 * <p>The WHOLE target tree of the course, always four levels deep (subject → module →
 * chapter → slide ids). Levels hidden at the target depth are single containers named
 * {@code DEFAULT}: depth 4 = one DEFAULT subject; depth 3 = one DEFAULT subject holding one
 * DEFAULT module; depth 2 = one DEFAULT subject → module → chapter. An existing container is
 * kept by passing its {@code id} (it may be renamed); a node without an id is created.
 * Every slide currently in the course must appear exactly once; containers left out are
 * deleted. Nothing is copied: slides and kept containers keep their ids, so learner
 * progress on them survives.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CourseRestructureRequestDTO {

    /** 2..5 — the course_depth after the change. */
    private Integer targetDepth;

    /** true: validate and compute everything, then roll back. Nothing is written. */
    private boolean dryRun;

    private List<SubjectNode> subjects = new ArrayList<>();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SubjectNode {
        private String id;
        private String name;
        private List<ModuleNode> modules = new ArrayList<>();
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ModuleNode {
        private String id;
        private String name;
        private List<ChapterNode> chapters = new ArrayList<>();
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ChapterNode {
        private String id;
        private String name;
        private List<String> slideIds = new ArrayList<>();
    }
}
