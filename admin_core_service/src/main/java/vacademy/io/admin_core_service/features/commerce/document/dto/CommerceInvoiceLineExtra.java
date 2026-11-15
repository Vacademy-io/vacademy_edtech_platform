package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Facts of an order line that are not tax facts, keyed by the line reference of the tax snapshot. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CommerceInvoiceLineExtra {

    private String lineRef;
    private String sku;
    private String packageSessionId;
    private String pieceId;
}
