package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** A product with everything the editor shows. The product id is the package id. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductResponse {

    private String packageId;
    private String externalRef;
    private String slug;
    private String stockMode;
    private String taxClassId;
    private String brand;
    private String unit;
    private Integer qtyScale;
    private Integer qtyStep;
    private String originLocationId;
    private String status;
    private LocalDateTime publishedAt;
    private Map<String, Object> seoI18n;
    private List<ProductTranslationDTO> translations;
    private List<String> optionAttributeIds;
    private List<String> attributeValueIds;
    private List<String> collectionIds;
    private List<VariantResponse> variants;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
