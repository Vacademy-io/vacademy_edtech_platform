package vacademy.io.auth_service.feature.sso.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

/** Admin save. A null client_secret keeps the stored one. */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class SsoConnectionRequest {
    private String displayName;
    private String issuer;
    private String clientId;
    private String clientSecret;
    private String tokenAuthMethod;
    private String scopes;
    private List<String> emailDomains;
    private String claimUserId;
    private String claimEmail;
    private String claimName;
    private String claimGivenName;
    private String claimFamilyName;
    private String claimPhone;
    private String claimGroups;
    private String accessMode;
    private List<String> allowedGroups;
    private List<String> defaultPackageSessionIds;
    private List<SsoGroupRule> groupRules;
    private Boolean removeAccessOnGroupLoss;
    private Boolean trustProviderEmail;
    private Boolean autoRedirect;
    private Boolean enabled;
}
