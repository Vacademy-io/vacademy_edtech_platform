package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/** Either add days (counted from today if the trial has already ended) or set the end date. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TrialChangeDTO {
    private Integer extendDays;
    /** ISO date, for example 2026-12-01. The trial runs to the end of that day, UTC. */
    private String endsOn;
}
