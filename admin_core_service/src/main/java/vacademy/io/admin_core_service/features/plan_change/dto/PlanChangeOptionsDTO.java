package vacademy.io.admin_core_service.features.plan_change.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.Date;
import java.util.List;

/**
 * Everything the "change plan" screen needs: where the learner is now, where they can go,
 * and whether a move is already booked.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PlanChangeOptionsDTO {

    private String userPlanId;
    private String currentPlanId;
    private String currentPlanName;
    private Double currentPlanPrice;
    private String currentPaymentOptionId;
    private String currentOptionName;
    private String currency;
    private Integer currentValidityInDays;
    /** Access-until date the proration credit is computed from. */
    private Date currentEndDate;

    /** Already priced for this learner. Empty when nothing is flagged or the plan is ineligible. */
    private List<PlanChangeTargetDTO> targets;

    /** Non-null when a downgrade is booked for the end of the cycle. */
    private ScheduledPlanChangeDTO scheduledChange;

    /**
     * False when the plan itself can never be changed (wrong status, CPO-backed, no
     * eligible targets configured). Lets the UI hide the entry point rather than opening
     * an empty dialog.
     */
    private boolean canChangePlan;

    /** Populated when {@code canChangePlan} is false, so the UI can say why. */
    private String blockedReason;
}
