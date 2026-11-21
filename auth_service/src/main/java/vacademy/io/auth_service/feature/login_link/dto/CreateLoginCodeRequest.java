package vacademy.io.auth_service.feature.login_link.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Body of POST /auth-service/open/v1/login-codes (institute's server, X-API-Key) and
 * POST /auth-service/internal/v1/login-codes (our services, HMAC). Exactly one of username /
 * email / user_id. institute_id is read only on the internal route; on the public one the key decides.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class CreateLoginCodeRequest {

    private String username;

    /** The learner's email, for callers that do not know the username. */
    private String email;

    @JsonProperty("user_id")
    @JsonAlias("userId")
    private String userId;

    @JsonProperty("institute_id")
    @JsonAlias("instituteId")
    private String instituteId;

    /** 1..30, default 7. */
    @JsonProperty("expires_in_days")
    @JsonAlias("expiresInDays")
    private Integer expiresInDays;
}
