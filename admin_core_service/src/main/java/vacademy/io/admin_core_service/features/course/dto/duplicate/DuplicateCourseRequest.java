package vacademy.io.admin_core_service.features.course.dto.duplicate;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of POST /admin-core-service/course/v1/duplicate/{instituteId}/{courseId}.
 * The body is optional; a blank or missing name becomes "&lt;source name&gt; (Copy)".
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class DuplicateCourseRequest {
    /** JSON {@code new_course_name}. */
    private String newCourseName;
}
