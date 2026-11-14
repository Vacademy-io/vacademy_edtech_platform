package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Request for the billing summary behind the Total / Collected / Due KPI cards.
 *
 * The window filters {@code user_plan.created_at} — when the obligation was created — and NOT
 * payment dates. Collections are then counted against those enrolments whenever they arrived,
 * which is the only way "Due = Total - Collected" stays true for a selected period; dating the two
 * halves differently would leave the three numbers unable to add up.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BillingSummaryRequestDTO {

    private String instituteId;

    /** Optional. Null = from epoch ("all time"). Filters user_plan.created_at. */
    private LocalDateTime startDateInUtc;

    /** Optional. Null = now. Filters user_plan.created_at. */
    private LocalDateTime endDateInUtc;

    /** Optional. Narrows to enrolments whose invite covers any of these package sessions. */
    private List<String> packageSessionIds;

    /**
     * Optional. Name, email or phone from the search box. Only the learner lists
     * (outstanding-learners) read it; the summary cards ignore it and keep describing everyone.
     */
    private String searchString;
}
