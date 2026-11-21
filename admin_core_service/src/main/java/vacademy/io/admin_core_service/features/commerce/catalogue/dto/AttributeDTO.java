package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** An attribute, in requests and responses. code is fixed after creation; values are read-only here. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class AttributeDTO {

    private String id;
    private String code;
    private Map<String, String> nameI18n;
    private String kind;
    private Boolean isFilterable;
    private Integer position;
    private List<AttributeValueDTO> values;
}
