package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** The sign-up alert template, as Meta holds it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AlertTemplateDTO {
    private String name;
    private String language;
    private String body;
    /** NOT_REGISTERED, PENDING, APPROVED, REJECTED and so on. */
    private String status;
    private String category;
    private String rejectedReason;
}
