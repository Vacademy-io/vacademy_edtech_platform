package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** An attribute value, in requests and responses. code is fixed after creation. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttributeValueDTO {

    private String id;
    private String attributeId;
    private String code;
    private Map<String, String> labelI18n;
    private String swatchHex;
    private Integer position;
}
