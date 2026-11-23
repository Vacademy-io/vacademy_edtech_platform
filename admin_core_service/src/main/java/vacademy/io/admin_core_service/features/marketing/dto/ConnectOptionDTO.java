package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One account the admin can pick after OAuth: a Meta ad account, a Google Ads customer, a Facebook
 * Page, an Instagram account or a Business Profile location. Never carries a token.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ConnectOptionDTO {
    private String externalId;
    private String name;
    private String subtitle;
    /** AD_ACCOUNT | MANAGER_ACCOUNT | FACEBOOK_PAGE | INSTAGRAM | GBP_LOCATION */
    private String kind;
    private String currency;
    private String timeZone;
    /** Google manager id when the customer is reached through a manager account. */
    private String loginCustomerId;
    private boolean alreadyConnected;
    private boolean selectable;
    private String warning;
}
