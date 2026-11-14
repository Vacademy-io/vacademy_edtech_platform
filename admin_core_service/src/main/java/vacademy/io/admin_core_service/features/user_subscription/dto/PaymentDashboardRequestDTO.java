package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/** What the Payment Dashboard asks for: a period, an optional course/batch scope and a time zone. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentDashboardRequestDTO {
    private String instituteId;
    /** Period start (UTC). Null = all time, which also turns the comparison off. */
    private LocalDateTime startDateInUtc;
    /** Period end (UTC). Null = now. */
    private LocalDateTime endDateInUtc;
    /** Optional. Narrows everything to enrolments whose invite covers any of these batches. */
    private List<String> packageSessionIds;
    /** IANA zone months and days are cut in (e.g. Asia/Kolkata). Defaults to UTC. */
    private String timeZone;
}
