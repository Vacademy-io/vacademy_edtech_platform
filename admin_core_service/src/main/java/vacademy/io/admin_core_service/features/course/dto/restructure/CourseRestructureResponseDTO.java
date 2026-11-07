package vacademy.io.admin_core_service.features.course.dto.restructure;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Outcome of a course restructure (or of its dry run — then the new ids are throwaway). */
@Data
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CourseRestructureResponseDTO {

    private boolean dryRun;
    private int depthFrom;
    private int depthTo;
    private int batches;
    /** Learners (ACTIVE / INACTIVE) in the course's batches — they see the new layout at once. */
    private int learnersAffected;
    private int slidesMoved;

    private List<Ref> created = new ArrayList<>();
    private List<Ref> renamed = new ArrayList<>();
    private List<Ref> removed = new ArrayList<>();

    /** removed chapter id → the chapter that received (most of) its slides; drip references follow it. */
    private Map<String, String> chapterIdMap = new LinkedHashMap<>();
    /** Human-readable notes on drip rules that were re-pointed, moved or dropped. */
    private List<String> dripChanges = new ArrayList<>();
    private List<String> warnings = new ArrayList<>();

    /** The course's tree after the change, with ids. */
    private List<CourseRestructureRequestDTO.SubjectNode> tree = new ArrayList<>();

    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Ref {
        private String level;
        private String id;
        private String name;
        private String previousName;

        public Ref(String level, String id, String name, String previousName) {
            this.level = level;
            this.id = id;
            this.name = name;
            this.previousName = previousName;
        }
    }
}
