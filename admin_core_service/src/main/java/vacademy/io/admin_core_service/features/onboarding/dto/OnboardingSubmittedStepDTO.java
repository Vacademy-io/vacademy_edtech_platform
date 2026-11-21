package vacademy.io.admin_core_service.features.onboarding.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

/**
 * One step's answers, for the "what did I fill in during onboarding?" view a subject can open
 * long after the flow finished.
 *
 * <p>Exists so that view is ONE request rather than one per step: the per-step
 * {@code /step-instances/{id}/fields} endpoint is right for the form (which only ever renders a
 * single step) but turns a six-step flow into six round trips when the whole history is wanted.
 *
 * <p>{@code fields} is the same role-resolved list that endpoint returns -- already filtered to
 * what this caller may VIEW and already excluding hidden fields -- so the summary can never show
 * a subject something the form itself would have withheld.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OnboardingSubmittedStepDTO {
    private String stepInstanceId;
    private String stepId;
    private String stepName;
    private Integer stepOrder;
    /** COMPLETED / SKIPPED / IN_PROGRESS / PENDING -- a skipped step is still worth showing. */
    private String status;
    private Date completedAt;
    private String skipReason;
    private List<OnboardingResolvedFieldDTO> fields;
}
