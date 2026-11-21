package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Defaults of a FLEXIBLE fee plan, stored in {@code complex_payment_option.metadata_json}
 * under {@code flexible_defaults}. They prefill the Enroll wizard and are the schedule used
 * when an enrollment does not choose one (learner self-enroll, admissions, product pages).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class FlexibleScheduleDefaultsDTO {
    /** Default number of installments. */
    private Integer count;
    /** Default gap between installments. */
    private InstallmentScheduleDTO.IntervalDTO interval;
    /** Most installments an admin may choose for this plan; null = the system limit. */
    private Integer maxCount;
}
