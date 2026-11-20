package vacademy.io.auth_service.feature.selfsignup.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

/**
 * The one-screen demo: name, email and phone, and the visitor is in. Nothing here is verified,
 * so the demo opens with its own (smaller) credit amount and one account per email.
 */
@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SelfSignupDemoRequest {
    private String product;
    private String fullName;
    private String email;
    /** With the country code. */
    private String phone;

    /** Where the visitor came from, for the funnel. */
    private String source;
    private String campaign;
    /** The visit's utm tags from the product's website, passed on to the lead. */
    private String utmSource;
    private String utmMedium;
    private String utmCampaign;
    private String utmContent;
    private String utmTerm;
}
