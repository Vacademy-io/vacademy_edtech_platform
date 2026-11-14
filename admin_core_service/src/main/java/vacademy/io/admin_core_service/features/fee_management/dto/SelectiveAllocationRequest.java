package vacademy.io.admin_core_service.features.fee_management.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelectiveAllocationRequest {
    private String instituteId;
    private List<String> studentFeePaymentIds;
    private BigDecimal amount;
    private String remarks;
    /** How it was paid (mode, sub-option, reference, date); see OfflinePaymentDetailsService. */
    private vacademy.io.admin_core_service.features.offline_payment.dto.OfflinePaymentDetailsDTO paymentDetails;
}
