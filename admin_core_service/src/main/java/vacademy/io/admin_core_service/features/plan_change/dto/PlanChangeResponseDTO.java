package vacademy.io.admin_core_service.features.plan_change.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import java.util.Date;

/**
 * One response shape for every outcome of a change request, so the client branches on
 * {@code status} instead of guessing from which fields happen to be present:
 *
 * <ul>
 *   <li>{@code PENDING_PAYMENT} — {@link #paymentResponse} carries the gateway checkout
 *       payload; the change lands when the webhook confirms.</li>
 *   <li>{@code SCHEDULED} — nothing to pay; {@link #effectiveFrom} says when it lands.</li>
 *   <li>{@code APPLIED} — already done (admin override, or an upgrade that cost nothing
 *       once the proration credit was applied).</li>
 * </ul>
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PlanChangeResponseDTO {

    /** PENDING_PAYMENT | SCHEDULED | APPLIED */
    private String status;
    private String changeRequestId;
    private String direction;
    private String toPlanId;
    private String toPlanName;
    private Date effectiveFrom;

    private Double amountDueNow;
    private Double prorationCredit;
    private String currency;
    private boolean requiresMandateReauth;

    /** Gateway checkout payload. Null unless {@code status} is PENDING_PAYMENT. */
    private PaymentResponseDTO paymentResponse;
}
