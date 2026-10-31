package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A learner's enrolment as the Due side view shows it. {@code countsTowardsDue} is the whole point:
 * a cancelled plan is returned so it stays visible, but flagged so the UI can grey it out and say
 * why it adds nothing to the balance.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerPlanBreakdownDTO {
    private String userPlanId;
    private String courseName;
    private String planStatus;
    private String paymentType;
    private Double billed;
    private Double paid;
    private Double due;
    private Double upcoming;
    private Boolean countsTowardsDue;
    private String currency;
}
