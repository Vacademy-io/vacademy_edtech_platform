package vacademy.io.admin_core_service.features.counselor_pool.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of {@code PATCH /counselor-pool/{poolId}/audiences/{audienceId}/assignment}.
 * {@code assign_on_intake=false} makes the list AI-first: intake leaves the lead unowned and
 * the pool assigns only when the AI-call outcome asks for a counsellor.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateAudienceAssignmentRequest {
    @JsonProperty("assign_on_intake")
    private Boolean assignOnIntake;
}
