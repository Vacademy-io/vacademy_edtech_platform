package vacademy.io.common.common.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class CustomFieldValueDTO {
    private String customFieldId;
    private String sourceType;
    private String sourceId;
    private String type;
    private String typeId;
    private String value;
    /** Invites that require this field — used by product-page enrollment to filter per-invite. */
    private List<String> enrollInviteIds;

    /** custom field id → value, skipping blanks; null when there is nothing to pass on. */
    public static Map<String, String> toValueMap(List<CustomFieldValueDTO> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        Map<String, String> map = new LinkedHashMap<>();
        for (CustomFieldValueDTO v : values) {
            if (v != null && v.getCustomFieldId() != null && v.getValue() != null && !v.getValue().isBlank()) {
                map.putIfAbsent(v.getCustomFieldId(), v.getValue());
            }
        }
        return map.isEmpty() ? null : map;
    }
}
