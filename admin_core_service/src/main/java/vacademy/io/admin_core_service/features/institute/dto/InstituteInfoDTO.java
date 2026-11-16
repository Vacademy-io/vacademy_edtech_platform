package vacademy.io.admin_core_service.features.institute.dto;


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
    /**
     * The institute's own logo file id. Exposed so other services (e.g. the
     * assessment-service report branding fallback) can brand generated documents
     * with the institute logo when a feature-specific logo isn't configured.
     */
    private String instituteLogoFileId;
    private String setting;
    private String email;
    private String websiteUrl;
    private String learnerPortalUrl;
    private String adminPortalUrl;
    /**
     * Permanent public URL of {@link #instituteLogoFileId}. Filled only by the internal
     * /internal/institute/v1/{id} endpoint, so services without a media client (the
     * notification service's OTP mail) can show the logo; null when there is none.
     */
    private String instituteLogoUrl;
}
