package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Answer of POST /marketing/oauth/session/{sessionKey}/select. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ConnectSelectResponse {
    /** Accounts connected or re-connected by this call. */
    private int created;
    private List<AdAccountDTO> adAccounts;
    private List<SocialAccountDTO> socialAccounts;
}
