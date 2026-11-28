package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.Map;

/** A variant with its price and the ids of the legacy rows behind it. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class VariantResponse {

    private String packageSessionId;
    private String packageId;
    private String name;
    private String sku;
    private String barcode;
    private String labelCode;
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
    private String externalRef;
    private BigDecimal price;
    private BigDecimal mrp;
    private String currency;
    private String enrollInviteId;
    private String paymentOptionId;
    private String paymentPlanId;
    private Map<String, String> optionValues;
}
