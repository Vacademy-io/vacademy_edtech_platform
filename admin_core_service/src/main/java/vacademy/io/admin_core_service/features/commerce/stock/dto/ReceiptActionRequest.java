package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/** Body of POST /stock/receipts/{id}/reverse (reason) and POST /stock/receipts/no-bill. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReceiptActionRequest {
    /** no-bill only: the receipts to close. */
    private List<String> receiptIds;
    /** reverse: why, free text. no-bill: BILLED_ELSEWHERE, GIFT_OR_SAMPLE or OTHER. */
    private String reason;
}
