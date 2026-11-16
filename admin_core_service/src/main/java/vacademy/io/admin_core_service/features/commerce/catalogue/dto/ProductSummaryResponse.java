package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

/** One row of the product list. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductSummaryResponse {

    private String packageId;
    private String externalRef;
    private String slug;
    private String status;
    private String brand;
    /** QUANTITY or PIECE. */
    private String stockMode;
    /** Null when the product has no tax class yet (the list warns about it). */
    private String taxClassId;
    /** Names by locale. */
    private Map<String, String> names;
    private Integer variantCount;
    private BigDecimal minPrice;
    private BigDecimal maxPrice;
    private String currency;
    private LocalDateTime updatedAt;
}
