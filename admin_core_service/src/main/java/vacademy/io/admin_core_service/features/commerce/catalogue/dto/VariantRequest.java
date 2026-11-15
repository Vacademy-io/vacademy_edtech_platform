package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Map;

/**
 * One variant in a product save. A variant is matched by package_session_id, then by
 * external_ref, then by sku, inside the product; no match creates it. On an existing variant a
 * null field is left unchanged.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class VariantRequest {

    private String packageSessionId;
    private String externalRef;
    private String name;
    private String sku;
    private String barcode;
    private String stockPolicy;
    private Integer leadTimeDays;
    private Integer weightGrams;
    private Integer lengthMm;
    private Integer widthMm;
    private Integer heightMm;
    private BigDecimal costPrice;
    private String mediaId;
    private Integer position;
    private String status;
    /** Selling price of one base unit (payment_plan.actual_price). */
    private BigDecimal price;
    /** MRP (payment_plan.elevated_price); defaults to the price. */
    private BigDecimal mrp;
    private String currency;
    /** attribute id to attribute value id, one entry per option of the product. */
    private Map<String, String> optionValues;
}
