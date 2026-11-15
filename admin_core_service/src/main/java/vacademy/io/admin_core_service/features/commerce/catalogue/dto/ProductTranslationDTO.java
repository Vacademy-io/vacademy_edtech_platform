package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** Product text in one language, in requests and responses. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductTranslationDTO {

    private String locale;
    private String name;
    private String shortDescription;
    private String descriptionHtml;
    /** List of {code, html}. */
    private List<Map<String, Object>> contentBlocks;
}
