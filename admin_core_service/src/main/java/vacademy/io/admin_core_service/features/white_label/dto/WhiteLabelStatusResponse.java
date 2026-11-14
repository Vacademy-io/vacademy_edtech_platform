package vacademy.io.admin_core_service.features.white_label.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * Current white-label status for an institute — returned by the GET /status
 * endpoint.
 */
@Data
@Builder
public class WhiteLabelStatusResponse {

    @JsonProperty("is_configured")
    private boolean isConfigured;

    @JsonProperty("cloudflare_enabled")
    private boolean cloudflareEnabled;

    @JsonProperty("domain_type")
    private String domainType;

    @JsonProperty("learner_portal_url")
    private String learnerPortalUrl;

    @JsonProperty("admin_portal_url")
    private String adminPortalUrl;

    @JsonProperty("teacher_portal_url")
    private String teacherPortalUrl;

    /**
     * Roles whose portal URL was adopted into the institute row by THIS read,
     * because the chosen host had just gone active. Lets the settings page say
     * "your learner portal is now live on …" at the moment it becomes true,
     * instead of the change appearing silently.
     */
    @JsonProperty("roles_adopted_now")
    private List<String> rolesAdoptedNow;

    @JsonProperty("routing_entries")
    private List<RoutingEntry> routingEntries;

    @Data
    @Builder
    public static class RoutingEntry {
        @JsonProperty("id")
        private String id;

        @JsonProperty("role")
        private String role;

        @JsonProperty("domain")
        private String domain;

        @JsonProperty("subdomain")
        private String subdomain;

        /**
         * Live Cloudflare Pages custom-domain status for this host, e.g.
         * "active", "pending", "initializing". Null when Pages provisioning
         * isn't configured or the host isn't attached to a Pages project yet.
         */
        @JsonProperty("pages_status")
        private String pagesStatus;

        /**
         * CNAME target the customer must point this host at (i.e.
         * "<project>.pages.dev") when it's an external domain awaiting DNS.
         * Informational for in-zone hosts (Cloudflare creates their DNS itself).
         */
        @JsonProperty("pages_cname_target")
        private String pagesCnameTarget;

        /**
         * The admin picked this host as the portal URL for the roles it serves.
         * An intent, not a fact — see {@code is_portal_url}.
         */
        @JsonProperty("is_primary")
        private boolean isPrimary;

        /**
         * This host is what {@code institutes.<role>_portal_base_url} actually
         * holds right now, i.e. the domain outbound learner links use. Differs
         * from {@code is_primary} while a chosen host is still pending — that is
         * the state worth showing an admin, because it is the one they cannot
         * otherwise explain.
         */
        @JsonProperty("is_portal_url")
        private boolean isPortalUrl;

        /**
         * Sub-organisation this domain serves, or null for a parent-institute
         * portal. See {@code PortalRoutingConfig#subOrgId} for why it matters.
         */
        @JsonProperty("sub_org_id")
        private String subOrgId;

        // ── Branding ──────────────────────────────────────────────────────
        @JsonProperty("tab_text")
        private String tabText;

        @JsonProperty("tab_icon_file_id")
        private String tabIconFileId;

        @JsonProperty("theme")
        private String theme;

        @JsonProperty("font_family")
        private String fontFamily;

        // ── Routes ────────────────────────────────────────────────────────
        @JsonProperty("redirect")
        private String redirect;

        @JsonProperty("after_login_route")
        private String afterLoginRoute;

        @JsonProperty("admin_portal_after_logout_route")
        private String adminPortalAfterLogoutRoute;

        @JsonProperty("home_icon_click_route")
        private String homeIconClickRoute;

        // ── Auth ──────────────────────────────────────────────────────────
        @JsonProperty("allow_signup")
        private Boolean allowSignup;

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

        @JsonProperty("convert_username_password_to_lowercase")
        private Boolean convertUsernamePasswordToLowercase;

        // ── Legal / Links ─────────────────────────────────────────────────
        @JsonProperty("privacy_policy_url")
        private String privacyPolicyUrl;

        @JsonProperty("terms_and_condition_url")
        private String termsAndConditionUrl;

        @JsonProperty("play_store_app_link")
        private String playStoreAppLink;

        @JsonProperty("app_store_app_link")
        private String appStoreAppLink;

        @JsonProperty("windows_app_link")
        private String windowsAppLink;

        @JsonProperty("mac_app_link")
        private String macAppLink;

        // ── Phone input preferences ───────────────────────────────────────
        @JsonProperty("comma_separated_preferred_country")
        private String commaSeparatedPreferredCountry;

        @JsonProperty("phone_country_geo_mode")
        private String phoneCountryGeoMode;

        // ── Logo / institute-name display ─────────────────────────────────
        @JsonProperty("hide_institute_name")
        private Boolean hideInstituteName;

        @JsonProperty("logo_width_px")
        private Integer logoWidthPx;

        @JsonProperty("logo_height_px")
        private Integer logoHeightPx;

        @JsonProperty("stack_name_below_logo")
        private Boolean stackNameBelowLogo;
    }
}
