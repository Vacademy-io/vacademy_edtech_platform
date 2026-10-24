package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/** What a manual renewal would do by default, for prefilling the admin dialog. Saves nothing. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ManualRenewalPreviewDTO {

    private String userPlanId;
    private String status;
    private Date currentEndDate;
    private Date suggestedEndDate;
    private Integer validityDays;
    private Double suggestedAmount;
    private String currency;
    private boolean autoRenewalEnabled;
    /** False with a reason when this plan cannot be renewed by hand. */
    private boolean renewable;
    private String notRenewableReason;
}
