package vacademy.io.assessment_service.features.question_library.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** What one AI tagging batch did. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LibraryAutoTagResponse {
    /** Every question this batch looked at, tagged or not: send them back as exclude_question_ids. */
    private List<String> attemptedIds;
    /** Questions that got at least one concept tag. */
    private Integer tagged;
    /** Untagged questions left under the topic, not counting the ones already tried. */
    private Long remaining;
    /** The concept names used in this batch. */
    private List<String> tags;
}
