package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Create or update a product with its variants. On an update a null field or list is left
 * unchanged; a list that is present replaces the stored set, except variants and translations,
 * which are added or updated and never removed.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductRequest {

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
    private Map<String, Object> seoI18n;
    private List<ProductTranslationDTO> translations;
    /** Attributes that vary between variants, in display order. */
    private List<String> optionAttributeIds;
    /** Facet values of the product. */
    private List<String> attributeValueIds;
    private List<String> collectionIds;
    private List<VariantRequest> variants;
}
