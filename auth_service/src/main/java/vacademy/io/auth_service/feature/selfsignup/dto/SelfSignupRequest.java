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
    /** With the country code. Not verified: the email is what was proven. */
    private String phone;
    /** Required for an email sign-up; a Google sign-up signs in with Google. */
    private String username;
    private String password;

    private String instituteName;
    private String instituteType;
    private String city;
    private String state;
    private Integer teachers;

    /**
     * "Buy <plan>" on the website: the account is made to pay for that plan, so it gets no free
     * trial and no opening credits; the app stays on the plan screen until the plan is paid.
     */
    private String buy;

    /** Where the visitor came from, for the funnel. */
    private String plan;
    private String source;
    private String campaign;
}
