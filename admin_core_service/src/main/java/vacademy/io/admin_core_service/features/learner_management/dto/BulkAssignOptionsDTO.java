package vacademy.io.admin_core_service.features.learner_management.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
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
public class BulkAssignOptionsDTO {

    /**
     * How to handle users who are already enrolled:
     * SKIP — silently skip (default)
     * ERROR — mark as FAILED in response
     * RE_ENROLL — reactivate TERMINATED/EXPIRED mappings
     */
    @Builder.Default
    private String duplicateHandling = "SKIP";

    @Builder.Default
    private boolean notifyLearners = false;

    /** Whether to send credentials (registration email) to new users. Default: false */
    @Builder.Default
    private boolean sendCredentials = false;

    /** Optional external transaction reference */
    private String transactionId;

    /** Optional payment date for manual/offline payments */
    @JsonFormat(shape = JsonFormat.Shape.STRING, timezone = "UTC")
    private Date paymentDate;

    /**
     * How the payment was made (mode, sub-option, reference) for every learner in this run,
     * recorded with the payment date / transaction id. See OfflinePaymentDetailsService.
     */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails;

    /** true = preview only, no database writes */
    @Builder.Default
    private boolean dryRun = false;
}
