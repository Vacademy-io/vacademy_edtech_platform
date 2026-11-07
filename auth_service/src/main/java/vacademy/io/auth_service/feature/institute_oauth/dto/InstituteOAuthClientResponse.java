package vacademy.io.auth_service.feature.institute_oauth.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/** Never carries the secret. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstituteOAuthClientResponse {

    private String instituteId;
    private String provider;
    private boolean configured;
    private String clientId;
    private boolean enabled;
    private boolean hasSecret;
    /** The callback to add under "Authorized redirect URIs" on the brand's OAuth client. */
    private String redirectUri;
    private String updatedBy;
    private Date updatedAt;
}
