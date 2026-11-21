package vacademy.io.admin_core_service.features.doubts.dtos;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * The learner-facing view of a doubt's workflow status: the configured learner label (falls back to
 * the internal label) and the coarse kind (OPEN / IN_PROGRESS / RESOLVED) the learner app tones by.
 * Internal remarks, assignee history and the admin-only label never travel in this object.
 */
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class DoubtStatusDto {
    private String key;
    private String label;
    private String kind;
}
