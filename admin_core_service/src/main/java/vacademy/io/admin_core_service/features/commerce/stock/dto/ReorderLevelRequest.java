package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;


/** Body of PUT /commerce/v1/stock/levels/reorder-level. A null level clears it. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReorderLevelRequest {
    private String locationId;
    private String packageSessionId;
    private Integer reorderLevel;
}
