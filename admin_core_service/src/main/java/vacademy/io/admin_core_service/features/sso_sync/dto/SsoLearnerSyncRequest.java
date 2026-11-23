package vacademy.io.admin_core_service.features.sso_sync.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/** From auth-service at each single sign-on: the learner, and the batches to add / take away. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class SsoLearnerSyncRequest {
    private String instituteId;
    private String userId;
    private String username;
    private String fullName;
    private String email;
    private String mobileNumber;
    private List<String> addPackageSessionIds;
    private List<String> removePackageSessionIds;
}
