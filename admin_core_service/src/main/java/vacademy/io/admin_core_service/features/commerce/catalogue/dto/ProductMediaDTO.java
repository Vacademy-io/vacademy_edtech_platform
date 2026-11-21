package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/** One gallery entry, in requests and responses. renditions is read-only. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ProductMediaDTO {

    private String id;
    private String packageId;
    private String packageSessionId;
    private String mediaId;
    private String kind;
    private String tag;
    private Map<String, String> altI18n;
    private Integer width;
    private Integer height;
    private Map<String, Object> renditions;
    private Integer position;
}
