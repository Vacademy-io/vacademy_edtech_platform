package vacademy.io.auth_service.feature.auth.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class JwtResponseDto {
    private String accessToken;
    private String refreshToken;

    // Session-limit fields — false/null on all normal logins (backward compatible)
    // Existing fields keep their original camelCase serialization (no @JsonNaming)
    @Builder.Default
    @JsonProperty("session_limit_exceeded")
    private boolean sessionLimitExceeded = false;

    @JsonProperty("active_sessions")
    private List<ActiveSessionDTO> activeSessions;

    // Learner registration only: true when the e-mail or phone already belonged to an
    // account that must sign in itself, so no tokens were issued. Omitted otherwise.
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonProperty("account_exists")
    private Boolean accountExists;
}
