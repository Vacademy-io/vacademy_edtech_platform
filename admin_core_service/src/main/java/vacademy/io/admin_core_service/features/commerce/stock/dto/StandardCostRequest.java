package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

/** Body of PUT /commerce/v1/stock/standard-costs: "Set standard cost" for one or many items. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class StandardCostRequest {
    /** Required. A repeat changes nothing. */
    private String clientRequestId;
    private List<Item> items;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Item {
        /** Either the variant id or its SKU. */
        private String packageSessionId;
        private String sku;
        private BigDecimal standardCost;
    }
}
