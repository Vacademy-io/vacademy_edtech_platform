package vacademy.io.admin_core_service.features.product_page.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Edits to a field already on a product page's form.
 *
 * Every property is optional and only a non-null one is applied, so a caller
 * that only wants to flip "required" does not have to echo the label and type
 * back correctly to avoid clobbering them.
 *
 * These live on the shared `custom_fields` row, so an edit reaches every form
 * in the institute that uses this field — which is why the admin dialog says
 * so. The product page is the entry point, not the scope.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductPageCustomFieldUpdateRequest {
    private String fieldName;
    private String fieldType;
    private Boolean isMandatory;
    /** Full config JSON — options, help text, and the `verification` block. */
    private String config;
}
