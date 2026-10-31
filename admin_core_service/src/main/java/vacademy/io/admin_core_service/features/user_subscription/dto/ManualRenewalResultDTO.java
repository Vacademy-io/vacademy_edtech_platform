package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ManualRenewalResultDTO {

    private String userPlanId;
    private String paymentLogId;
    private String previousStatus;
    private String status;
    private Date previousEndDate;
    private Date newEndDate;
    /** Access rows extended or reactivated. */
    private int mappingsUpdated;
    private boolean invoiceQueued;
}
