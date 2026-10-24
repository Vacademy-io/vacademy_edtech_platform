package vacademy.io.admin_core_service.features.domain_routing.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

@Data
public class DomainRoutingUpsertRequest {
    private String domain;
    private String subdomain;
    private String role;
    private String instituteId;
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
    private Boolean convertUsernamePasswordToLowercase;
    private String subOrgId;
    private String commaSeparatedPreferredCountry;
    /**
     * One of PhoneCountryGeoMode. Blank/unrecognised is stored as null, which
     * reads back as INSTITUTE_FIRST.
     */
    private String phoneCountryGeoMode;
    private Boolean hideInstituteName;
    private Integer logoWidthPx;
    private Integer logoHeightPx;
    private Boolean stackNameBelowLogo;
    private Boolean applyNamingSetting;

    /**
     * Marks this host as the institute's portal URL for the roles it serves.
     * Null leaves the stored flag untouched, so callers that don't know about
     * primaries (the generic domain-routing admin CRUD) can't silently demote a
     * row the white-label wizard set up.
     */
    @JsonProperty("isPrimary")
    @JsonAlias({ "is_primary", "primary" })
    private Boolean primary;

    /**
     * Catalogue tag to mount at this host's root (see
     * InstituteDomainRouting#rootCatalogueTag). Absent/null on update means
     * "leave it alone"; send an empty string to clear it.
     */
    private String rootCatalogueTag;
}
