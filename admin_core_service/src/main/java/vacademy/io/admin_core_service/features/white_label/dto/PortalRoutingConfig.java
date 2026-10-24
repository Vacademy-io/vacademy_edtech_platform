package vacademy.io.admin_core_service.features.white_label.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * Per-portal domain routing settings — mirrors DomainRoutingUpsertRequest
 * but without the fields that are derived automatically (domain, subdomain,
 * role, instituteId).
 */
@Data
public class PortalRoutingConfig {

    @JsonProperty("redirect")
    private String redirect;

    @JsonProperty("privacy_policy_url")
    private String privacyPolicyUrl;

    @JsonProperty("terms_and_condition_url")
    private String termsAndConditionUrl;

    @JsonProperty("after_login_route")
    private String afterLoginRoute;

    @JsonProperty("admin_portal_after_logout_route")
    private String adminPortalAfterLogoutRoute;

    @JsonProperty("home_icon_click_route")
    private String homeIconClickRoute;

    @JsonProperty("theme")
    private String theme;

    @JsonProperty("tab_text")
    private String tabText;

    @JsonProperty("allow_signup")
    private Boolean allowSignup;

    /**
     * Sub-organisation this domain belongs to, when the portal is one sub-org's
     * white-label rather than the parent institute's.
     *
     * <p>It is not cosmetic. The routing row's {@code institute_id} stays the
     * PARENT — every sub-org admin is a parent-institute user with the same JWT —
     * so this id is the only thing distinguishing one sub-org's portal from
     * another's. It drives the logo/name/theme overlay AND the login check in
     * {@code loginFlowHandler}: with it absent, any sub-org admin can sign in on
     * any sibling sub-org's portal.
     *
     * <p>Null leaves an existing mapping untouched; an empty string clears it.
     */
    @JsonProperty("sub_org_id")
    private String subOrgId;

    @JsonProperty("tab_icon_file_id")
    private String tabIconFileId;

    @JsonProperty("font_family")
    private String fontFamily;

    @JsonProperty("allow_google_auth")
    private Boolean allowGoogleAuth;

    @JsonProperty("allow_github_auth")
    private Boolean allowGithubAuth;

    @JsonProperty("allow_email_otp_auth")
    private Boolean allowEmailOtpAuth;

    @JsonProperty("allow_phone_auth")
    private Boolean allowPhoneAuth;

    @JsonProperty("allow_username_password_auth")
    private Boolean allowUsernamePasswordAuth;

    @JsonProperty("play_store_app_link")
    private String playStoreAppLink;

    @JsonProperty("app_store_app_link")
    private String appStoreAppLink;

    @JsonProperty("windows_app_link")
    private String windowsAppLink;

    @JsonProperty("mac_app_link")
    private String macAppLink;

    @JsonProperty("convert_username_password_to_lowercase")
    private Boolean convertUsernamePasswordToLowercase;

    /**
     * Comma-separated list of ISO 3166-1 alpha-2 country codes (e.g. "in,us,gb,au").
     * Drives the default selection and ordering of country options in phone inputs
     * across the learner and admin dashboards.
     */
    @JsonProperty("comma_separated_preferred_country")
    private String commaSeparatedPreferredCountry;

    /**
     * How a phone field on this portal picks its country code — one of
     * {@code INSTITUTE_FIRST} (default), {@code GEO_FIRST} or
     * {@code INSTITUTE_ONLY}. See {@code PhoneCountryGeoMode}.
     *
     * <p>
     * {@code INSTITUTE_FIRST} keeps {@link #commaSeparatedPreferredCountry}
     * authoritative and only follows the visitor's own country when no
     * preferred countries are configured. {@code GEO_FIRST} pre-selects the
     * visitor's country and uses the configured list to order the rest of the
     * picker. {@code INSTITUTE_ONLY} never looks at the visitor.
     */
    @JsonProperty("phone_country_geo_mode")
    private String phoneCountryGeoMode;

    /**
     * When true, the institute name is suppressed next to the logo on the login
     * page and sidebar. Useful when the logo already contains the name.
     */
    @JsonProperty("hide_institute_name")
    private Boolean hideInstituteName;

    /** Optional explicit logo width in pixels. Null means use responsive default. */
    @JsonProperty("logo_width_px")
    private Integer logoWidthPx;

    /** Optional explicit logo height in pixels. Null means use responsive default. */
    @JsonProperty("logo_height_px")
    private Integer logoHeightPx;

    /**
     * When true, the institute name is rendered stacked BELOW the logo (centered
     * vertical) instead of to its right. Null / false keeps the side-by-side layout.
     */
    @JsonProperty("stack_name_below_logo")
    private Boolean stackNameBelowLogo;
}
