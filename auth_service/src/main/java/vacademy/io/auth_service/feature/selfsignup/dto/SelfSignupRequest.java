package vacademy.io.auth_service.feature.selfsignup.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelfSignupRequest {
    private String signupToken;
    private String product;

    private String fullName;
    /** Required for an email sign-up; a Google sign-up signs in with Google. */
    private String username;
    private String password;

    private String instituteName;
    private String instituteType;
    private String city;
    private String state;
    private Integer teachers;

    /** Where the visitor came from, for the funnel. */
    private String plan;
    private String source;
    private String campaign;
}
