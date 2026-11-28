package vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One column of the template, for the column guide beside the upload. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ImportColumnResponse {

    private String column;
    /** KEY (every row), PRODUCT (first row of the product) or VARIANT (each row). */
    private String level;
    private Boolean required;
    private String description;
    private String example;
}
