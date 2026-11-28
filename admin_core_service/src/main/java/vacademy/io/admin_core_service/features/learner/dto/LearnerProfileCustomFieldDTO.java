package vacademy.io.admin_core_service.features.learner.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One custom field on the learner's own profile, with the learner's current value (null when empty). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerProfileCustomFieldDTO {
    private String customFieldId;
    private String fieldKey;
    private String fieldName;
    private String fieldType;
    private String config;
    private String value;
    /**
     * False for a field the institute's own rules depend on (it picks an invoice / receipt
     * numbering series, or it is synced into a system field): shown, but not editable here.
     */
    private boolean editable;
}
