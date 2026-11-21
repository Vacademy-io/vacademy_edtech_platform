package vacademy.io.assessment_service.features.assessment_folder.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/** How a folder orders its tests for students, and its draft + published tests in that order. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class FolderTestOrderDto {
    private String folderId;
    /** NAME = by name, A to Z (new tests take their place); CUSTOM = arranged by an admin (new tests go last). */
    private String mode;
    @Builder.Default
    private List<Item> assessments = new ArrayList<>();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Item {
        private String assessmentId;
        private String name;
        /** PUBLISHED or DRAFT. */
        private String status;
    }
}
