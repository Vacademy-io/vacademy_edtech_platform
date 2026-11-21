package vacademy.io.admin_core_service.features.domain_routing.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DomainRoutingResolveResponse {
    private String instituteId;
    private String instituteName;
    private String instituteLogoFileId;
    private String instituteThemeCode;
    private String role;
    private String redirect;
    private String privacyPolicyUrl;
    private String afterLoginRoute;
    private String adminPortalAfterLogoutRoute;
    private String homeIconClickRoute;
    private String termsAndConditionUrl;
    private String theme;
    private String tabText;
    private Boolean allowSignup;
    private String tabIconFileId;
    private String fontFamily;
    private Boolean allowGoogleAuth;
    private Boolean allowGithubAuth;
    private Boolean allowEmailOtpAuth;
    private Boolean allowPhoneAuth;
    private Boolean allowUsernamePasswordAuth;
    private String playStoreAppLink;
    private String appStoreAppLink;
    private String windowsAppLink;
    private String macAppLink;
    private String learnerPortalUrl;
    private String instructorPortalUrl;
    private boolean convertUsernamePasswordToLowercase;
    private String subOrgId;
    private String commaSeparatedPreferredCountry;
    /**
     * How the dashboards should pick a phone field's country code on this
     * portal: INSTITUTE_FIRST (default when null), GEO_FIRST or INSTITUTE_ONLY.
     * See PhoneCountryGeoMode.
     */
    private String phoneCountryGeoMode;
    private Boolean hideInstituteName;
    private Integer logoWidthPx;
    private Integer logoHeightPx;
    private Boolean stackNameBelowLogo;
    private NamingOverridesDto namingOverrides;
    /** Catalogue served at this host's root (clean URLs). Null = classic /<tag> routing. */
    private String rootCatalogueTag;
}
