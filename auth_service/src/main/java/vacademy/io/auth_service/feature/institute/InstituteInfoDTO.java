package vacademy.io.auth_service.feature.institute;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class InstituteInfoDTO {
    private String id;
    private String instituteName;
    private String address;
    private String instituteThemeCode;
    private String setting;
    private String websiteUrl;
    private String learnerPortalUrl;
    private String adminPortalUrl;
    /** The institute's contact address (institutes.email), shown as the support contact in learner mails. */
    private String email;
    /** Permanent public logo URL, resolved by admin-core; null when there is none. */
    private String instituteLogoUrl;
}
