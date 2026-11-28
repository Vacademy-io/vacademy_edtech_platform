package vacademy.io.admin_core_service.features.points_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One line of the learner-facing points breakdown. */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PointsBreakdownItemDTO {
    /** Raw source type, e.g. ENGAGEMENT_ITEM. */
    private String key;
    /** Human label, e.g. "Daily engagement". */
    private String label;
    private long points;
}
