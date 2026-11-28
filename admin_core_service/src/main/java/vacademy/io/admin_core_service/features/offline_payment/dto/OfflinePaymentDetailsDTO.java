package vacademy.io.admin_core_service.features.offline_payment.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.Map;

/**
 * How an admin says an offline payment was made. Optional on every admin record-payment
 * request ({@code payment_details}); validated against the institute's
 * {@link OfflinePaymentModesDTO}. See docs/OFFLINE_PAYMENT_RECORDING.md §5.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OfflinePaymentDetailsDTO {
    /** Mode code, e.g. UPI. */
    private String mode;
    /** Sub-option code within the mode, e.g. PHONEPE. */
    private String subMode;
    /** UPI ref / UTR / cheque number. */
    private String reference;
    /** When the money was received; the request's own date field wins when both are set. */
    private LocalDate paymentDate;
    private String notes;
    /** Media-service file id of an uploaded receipt or screenshot. */
    private String proofFileId;
    /** Mode-specific extras: cheque_date, bank_name, payer_name. */
    private Map<String, String> extra;
    /** Values of the mode's custom fields, by field key. */
    private Map<String, String> custom;
    /**
     * The institute's numbering-series field (e.g. branch) picked on the first payment of an
     * enrolment; pinned on the enrolment, so later payments never ask again.
     */
    private String numberingValue;
}
