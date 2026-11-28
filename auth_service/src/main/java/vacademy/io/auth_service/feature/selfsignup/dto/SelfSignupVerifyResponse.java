package vacademy.io.auth_service.feature.selfsignup.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelfSignupVerifyResponse {
    private String signupToken;
    private String email;
    private long expiresAt;
}
