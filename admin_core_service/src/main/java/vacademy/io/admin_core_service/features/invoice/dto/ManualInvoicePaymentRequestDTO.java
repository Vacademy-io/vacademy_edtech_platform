package vacademy.io.admin_core_service.features.invoice.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body for {@code POST /v1/invoices/{id}/mark-paid-manual} — records an offline
 * (cash / cheque / UPI) payment against a PENDING_PAYMENT admin invoice.
 *
 * <p>Both fields are optional. {@code transactionId} is stored on the resulting
 * PaymentLog's {@code paymentSpecificData} JSON for the audit trail; {@code notes}
 * appears on the confirmation email + the side-view detail panel.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ManualInvoicePaymentRequestDTO {
    private String transactionId;
    private String notes;
    /** How it was paid (mode, sub-option, reference, date); see OfflinePaymentDetailsService. */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails;
}
