package vacademy.io.admin_core_service.features.commerce.stock.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;


/** Body of POST /commerce/v1/stock/adjustments. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AdjustmentRequest {
    private String locationId;
    private String packageSessionId;
    /** Required for one-of-a-kind stock. */
    private String pieceId;
    /** ADJUSTMENT (default) or DAMAGE. */
    private String kind;
    /** In base units. ADJUSTMENT: plus or minus. DAMAGE: the number of units lost. */
    private Integer quantityDelta;
    /** A reason code, for example COUNT_DIFFERENCE, FOUND, DAMAGED_IN_STORE. */
    private String reason;
    private String note;
    /** Required. A repeat posts nothing. */
    private String clientRequestId;
    /** Above the limit, when the caller is not a manager: the approving manager and their PIN. */
    private String approverUserId;
    private String approverPin;
}
