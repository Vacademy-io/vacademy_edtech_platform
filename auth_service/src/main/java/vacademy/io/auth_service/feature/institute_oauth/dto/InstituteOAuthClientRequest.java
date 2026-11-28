package vacademy.io.auth_service.feature.institute_oauth.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstituteOAuthClientRequest {

    private String clientId;

    /** Required on create; omit on update to keep the stored secret. */
    @ToString.Exclude
    private String clientSecret;

    /** Defaults to true. */
    private Boolean enabled;
}
