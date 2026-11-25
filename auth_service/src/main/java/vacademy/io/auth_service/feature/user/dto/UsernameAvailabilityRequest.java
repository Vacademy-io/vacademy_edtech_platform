package vacademy.io.auth_service.feature.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Body of POST /auth-service/v1/user/username-availability. The e-mail and phone the admin
 * typed for the new learner travel in the body, not the query string, so they stay out of
 * access logs.
 */
public record UsernameAvailabilityRequest(
        @JsonProperty("username") String username,
        @JsonProperty("email") String email,
        @JsonProperty("mobile_number") String mobileNumber) {
}
