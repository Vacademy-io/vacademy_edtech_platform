package vacademy.io.auth_service.feature.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for trusted login request (bypasses OTP verification).
 * 
 * ⚠️ TEMPORARY: This is an emergency endpoint for when email service is down.
 * TODO: Remove this endpoint once email service is restored.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class TrustedLoginRequestDto {
    private String username;
    private String instituteId;
    /** Login code from the link's ?lc= (optional). When present it alone decides. */
    private String code;
    /**
     * Which passwordless landing route the learner app is on (a LoginLinkRoute name, optional).
     * Lets an institute that requires codes exempt routes. Client-reported, so not a security check.
     */
    private String route;
}
