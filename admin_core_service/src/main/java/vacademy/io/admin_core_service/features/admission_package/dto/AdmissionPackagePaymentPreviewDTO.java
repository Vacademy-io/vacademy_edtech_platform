package vacademy.io.admin_core_service.features.admission_package.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/** How a package payment would be shared between the courses. Saves nothing. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdmissionPackagePaymentPreviewDTO {

    private BigDecimal amount;
    private BigDecimal outstandingTotal;
    private List<Share> courses;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Share {
        private String userPlanId;
        private String courseName;
        private BigDecimal amount;
    }
}
