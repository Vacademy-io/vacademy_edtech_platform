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
    /** Per base unit (10 cm at qty_scale 10); the price of one unit is this × qty_scale. */
    private BigDecimal minPrice;
    /** Per base unit, as {@code minPrice}. */
    private BigDecimal maxPrice;
    /** The unit code (MTR, PCS); null when not set. */
    private String unit;
    /** Base units in one unit: 1 for counted goods, 10/100/1000 for measured goods. */
    private Integer qtyScale;
    /** The sale step in base units. */
    private Integer qtyStep;
    private String currency;
    private LocalDateTime updatedAt;
}
