package vacademy.io.admin_core_service.features.course.dto.duplicate;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Result of a one-click course duplicate. {@code session_id} / {@code level_id} name the
 * first new batch, so the dashboard can open the new course on it.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DuplicateCourseResponse {
    private String courseId;
    private String courseName;
    private String sessionId;
    private String levelId;
    private int batchesCopied;
    private int copiedSubjects;
    private int copiedModules;
    private int copiedChapters;
    private int copiedSlides;

    @Builder.Default
    private List<String> warnings = new ArrayList<>();
}
