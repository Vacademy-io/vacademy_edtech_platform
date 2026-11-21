package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.admin_core_service.features.marketing.entity.MarketingConnection;
import vacademy.io.admin_core_service.features.marketing.entity.SocialAccount;

/** A connected social account as the dashboard sees it (no tokens). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SocialAccountDTO {
    private String id;
    /** FACEBOOK | INSTAGRAM | GOOGLE_BUSINESS | YOUTUBE */
    private String platform;
    private String externalId;
    private String name;
    private String handle;
    private String avatarUrl;
    private Long followersCount;
    /** ACTIVE | RECONNECT_NEEDED | DISCONNECTED */
    private String status;
    private String statusDetail;
    /** Status of the OAuth grant behind the account; null for YouTube or when unknown. */
    private String connectionStatus;

    /** @param connection the account's marketing_connection; may be null (always null for YouTube) */
    public static SocialAccountDTO from(SocialAccount account, MarketingConnection connection) {
        if (account == null) return null;
        return SocialAccountDTO.builder()
                .id(account.getId())
                .platform(account.getPlatform())
                .externalId(account.getExternalId())
                .name(account.getName())
                .handle(account.getHandle())
                .avatarUrl(account.getAvatarUrl())
                .followersCount(account.getFollowersCount())
                .status(account.getStatus())
                .statusDetail(account.getStatusDetail())
                .connectionStatus(connection == null ? null : connection.getStatus())
                .build();
    }
}
