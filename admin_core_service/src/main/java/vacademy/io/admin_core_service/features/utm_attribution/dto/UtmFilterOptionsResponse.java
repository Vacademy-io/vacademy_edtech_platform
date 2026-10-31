package vacademy.io.admin_core_service.features.utm_attribution.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Every distinct value each UTM dimension holds across an institute's recorded
 * touches — what the list pages' campaign filter dropdowns offer.
 *
 * One round trip for all six dimensions rather than one per dropdown: these are
 * campaign names and channel labels, a few dozen strings at most, and the
 * filter bar renders several dropdowns side by side that would otherwise each
 * fire their own request on open.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UtmFilterOptionsResponse {
    private List<String> sources;
    private List<String> mediums;
    private List<String> campaigns;
    private List<String> contents;
    private List<String> terms;
    private List<String> sourceTypes;
    /** Total touches recorded for the institute — lets the UI tell "no data yet" from "no options". */
    private long totalTouches;
}
