package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * Admin records an offline (cash / cheque / UPI / bank-transfer) collection
 * against a CPO UserPlan. The amount is FIFO-allocated across unpaid
 * installments by the existing {@code FeeLedgerAllocationService}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class RecordOfflinePaymentRequestDTO {

    private Double amount;
    private Date paymentDate;
    private String reference;
    private String currency;
    private boolean generateInvoice;
    /** How it was paid (mode, sub-option, reference, extras); see OfflinePaymentDetailsService. */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails;
}
