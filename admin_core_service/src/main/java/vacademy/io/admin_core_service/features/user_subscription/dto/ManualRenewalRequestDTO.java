package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO;

import java.util.Date;

/**
 * An admin records a renewal the member paid outside the platform (bank transfer, cheque,
 * card over the phone) and extends the membership by hand.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ManualRenewalRequestDTO {

    private Double amount;
    /** Defaults to the plan's currency. */
    private String currency;
    /** When the money was received; defaults to today. */
    private Date paymentDate;
    /** Access runs until this date. Omitted: the plan's normal renewal (see preview). */
    private Date newEndDate;
    /** Required. Shown to every admin in the plan's remarks history, with who wrote it. */
    private String remarks;
    /** How it was paid (mode, reference, proof); see OfflinePaymentDetailsService. */
    private OfflinePaymentDetailsDTO paymentDetails;
    /** Issue an invoice for the payment. Off by default. */
    private boolean generateInvoice;
    /** With generateInvoice: email the invoice / payment confirmation to the member. Off by default. */
    private boolean sendEmail;
}
