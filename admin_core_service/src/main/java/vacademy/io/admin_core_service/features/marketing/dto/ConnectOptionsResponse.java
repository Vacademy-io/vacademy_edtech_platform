package vacademy.io.admin_core_service.features.marketing.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Answer of GET /marketing/oauth/session/{sessionKey}/options. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ConnectOptionsResponse {
    private String provider;
    private String connectionId;
    /** Name or email of the Meta / Google user that signed in. */
    private String accountName;
    private List<ConnectOptionDTO> options;
}
