package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CreditNoteLineRequest {

    private String invoiceLineItemId;
    /** Base units to credit. */
    private Integer quantity;
    /** Cost of the goods coming back, copied from the order line by the return flow. */
    private BigDecimal costTotal;
}
