package vacademy.io.admin_core_service.features.commerce.document.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** A buyer asks for a GSTIN invoice after a B2C one. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReissueB2bRequest {

    private String buyerGstin;
    /** The registered name of the buyer; kept as it is when null. */
    private String buyerName;
    /** Kept as it is when null. */
    private String billingAddress;
}
