package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

/** Body of PATCH /commerce/v1/stock/receipts/{id}/cost: a cost typed per line or per piece. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReceiptCostRequest {
    /** Required. A repeat changes nothing. */
    private String clientRequestId;
    private List<Line> lines;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Line {
        private String lineId;
        /** Optional, for one-of-a-kind stock: this piece only. */
        private String pieceId;
        private BigDecimal unitCost;
    }
}
