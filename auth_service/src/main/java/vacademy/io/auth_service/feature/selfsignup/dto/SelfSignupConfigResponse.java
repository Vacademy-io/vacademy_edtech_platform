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
    /** The form asks for a WhatsApp code on the phone number before the account is created. */
    private Boolean phoneVerificationRequired;
    /** The form does not ask how many teachers there are. */
    private Boolean hideTeachers;
    /** The "what kind of business" choices; null = the default institute types. */
    private java.util.List<String> instituteTypes;
}
