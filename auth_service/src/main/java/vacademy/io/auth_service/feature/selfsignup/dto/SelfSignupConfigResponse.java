package vacademy.io.auth_service.feature.selfsignup.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Builder;
import lombok.Data;

@Data
@Builder
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelfSignupConfigResponse {
    private String product;
    private String displayName;
    private Integer trialDays;
    private String logoUrl;
    private String appPath;
}
