package vacademy.io.admin_core_service.features.commerce.catalogue.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/** A collection, in requests and responses. children is filled only by the tree endpoint. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CollectionDTO {

    private String id;
    private String parentId;
    private String kind;
    private String slug;
    private Map<String, String> nameI18n;
    private Map<String, String> descriptionI18n;
    private String mediaId;
    private Integer returnWindowDays;
    private Integer position;
    private String status;
    private String externalRef;
    private List<CollectionDTO> children;
}
