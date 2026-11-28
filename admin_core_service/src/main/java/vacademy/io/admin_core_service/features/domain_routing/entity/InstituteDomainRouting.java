package vacademy.io.admin_core_service.features.domain_routing.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

@Entity
@Table(name = "institute_domain_routing")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InstituteDomainRouting {

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "domain", nullable = false)
    private String domain;

    @Column(name = "subdomain", nullable = false)
    private String subdomain;

    // Role name such as ADMIN, TEACHER, LEARNER
    @Column(name = "role", nullable = false)
    private String role;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "redirect")
    private String redirect;

    @Column(name = "privacy_policy_url", length = 500)
    private String privacyPolicyUrl;

    @Column(name = "after_login_route")
    private String afterLoginRoute;

    @Column(name = "admin_portal_after_logout_route")
    private String adminPortalAfterLogoutRoute;

    @Column(name = "home_icon_click_route")
    private String homeIconClickRoute;

    @Column(name = "terms_and_condition_url", length = 500)
    private String termsAndConditionUrl;

    @Column(name = "theme")
    private String theme;

    @Column(name = "tab_text")
    private String tabText;

    @Column(name = "allow_signup")
    private Boolean allowSignup;

    @Column(name = "tab_icon_file_id")
    private String tabIconFileId;

    @Column(name = "font_family")
    private String fontFamily;

    @Column(name = "allow_google_auth")
    private Boolean allowGoogleAuth;

    @Column(name = "allow_github_auth")
    private Boolean allowGithubAuth;

    @Column(name = "allow_email_otp_auth")
    private Boolean allowEmailOtpAuth;

    @Column(name = "allow_phone_auth")
    private Boolean allowPhoneAuth;

    @Column(name = "allow_username_password_auth")
    private Boolean allowUsernamePasswordAuth;

    @Column(name = "play_store_app_link", length = 500)
    private String playStoreAppLink;

    @Column(name = "app_store_app_link", length = 500)
    private String appStoreAppLink;

    @Column(name = "windows_app_link", length = 500)
    private String windowsAppLink;

    @Column(name = "mac_app_link", length = 500)
    private String macAppLink;

    @Column(name = "convert_username_password_to_lowercase", nullable = false)
    private boolean convertUsernamePasswordToLowercase;

    @Column(name = "sub_org_id")
    private String subOrgId;

    @Column(name = "comma_separated_preferred_country", length = 500)
    private String commaSeparatedPreferredCountry;

    /**
     * How phone inputs on this portal pick their country code — one of
     * {@link vacademy.io.admin_core_service.features.domain_routing.enums.PhoneCountryGeoMode}.
     *
     * <p>
     * Null means INSTITUTE_FIRST: {@link #commaSeparatedPreferredCountry} wins,
     * and the country the visitor is actually in is consulted only when no
     * preferred countries are configured.
     */
    @Column(name = "phone_country_geo_mode", length = 30)
    private String phoneCountryGeoMode;

    @Column(name = "hide_institute_name")
    private Boolean hideInstituteName;

    @Column(name = "logo_width_px")
    private Integer logoWidthPx;

    @Column(name = "logo_height_px")
    private Integer logoHeightPx;

    @Column(name = "stack_name_below_logo")
    private Boolean stackNameBelowLogo;

    @Column(name = "apply_naming_setting", nullable = false)
    private boolean applyNamingSetting;

    /**
     * True when this host is the institute's chosen portal URL for the roles it
     * serves — i.e. the one that belongs in
     * <code>institutes.&lt;role&gt;_portal_base_url</code> and therefore in every
     * outbound learner link.
     *
     * <p>It is an intent, not a fact: the host is only copied into the institute
     * row once Cloudflare reports it ACTIVE. Until then the institute keeps
     * whatever origin it had, because a pending Pages domain does not serve.
     * See {@code PortalUrlReconciler}.
     */
    @Column(name = "is_primary", nullable = false)
    private boolean primary;

    /**
     * Tag of the course catalogue that answers on this host's ROOT. When set,
     * the learner app renders that catalogue at <code>/</code> and its pages at
     * <code>/&lt;page-route&gt;</code>, and forwards the legacy
     * <code>/&lt;tag&gt;/...</code> URLs to the clean ones. Null keeps the
     * classic behaviour where <code>/</code> redirects to {@link #redirect}.
     * Only meaningful for LEARNER rows.
     */
    @Column(name = "root_catalogue_tag")
    private String rootCatalogueTag;
}
