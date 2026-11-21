package vacademy.io.admin_core_service.features.credits.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;

/**
 * Returned by GET /orders/{platformPaymentId}/status — the FE polls this until
 * status becomes PAID (or FAILED). On PAID it shows "credits added" and
 * invalidates the credit-balance React Query cache.
 */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditPackOrderStatusDTO {
    private String platformPaymentId;
    private String status;          // INITIATED | SUCCESS | FAILED
    private String paymentStatus;   // PAYMENT_PENDING | PAID | FAILED | REFUNDED | PARTIALLY_REFUNDED
    private BigDecimal creditsGranted;   // null until PAID
    private String invoiceUrl;           // relative PDF download path; null until invoice exists
    private String invoiceId;
    private String invoiceNumber;
}
