package vacademy.io.auth_service.feature.sso.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

import java.util.Date;
import java.util.List;

/** Admin view. Never carries the secret, only whether one is stored. */
@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SsoConnectionResponse {
    private boolean configured;
    private String instituteId;
    private String id;
    private String protocol;
    private String displayName;
    private String issuer;
    private String clientId;
    private boolean clientSecretSet;
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
    private boolean removeAccessOnGroupLoss;
    private boolean trustProviderEmail;
    private boolean autoRedirect;
    private boolean enabled;
    private long linkedUsers;
    private Date updatedAt;
    /** Values the partner registers in their provider. */
    private String redirectUri;
    private String initiateLoginUri;
}
