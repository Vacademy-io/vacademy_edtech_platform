package vacademy.io.admin_core_service.features.sso_sync.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SsoLearnerSyncResponse {
    private String studentId;
    private List<String> added;
    private List<String> alreadyActive;
    private List<String> removed;
    /** Not this institute's, or a sub-org batch (needs details single sign-on does not carry). */
    private List<String> skipped;
}
