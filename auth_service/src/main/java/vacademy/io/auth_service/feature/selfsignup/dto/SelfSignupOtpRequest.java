package vacademy.io.auth_service.feature.selfsignup.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelfSignupOtpRequest {
    private String product;
    private String email;
    /** Only when verifying. */
    private String otp;
    /** Phone step only: the email proof from the step before, and the number being proven. */
    private String signupToken;
    private String phone;
}
