package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * An admin corrects when an active membership ends — a payment recorded late, a date typed
 * wrong at enrolment — without taking a payment. Course access moves with it.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ChangePlanEndDateRequestDTO {

    /** The membership and its course access run until this date. Must be in the future. */
    private Date newEndDate;
    /** Required. Shown to every admin in the plan's remarks history, with who wrote it. */
    private String remarks;
}
