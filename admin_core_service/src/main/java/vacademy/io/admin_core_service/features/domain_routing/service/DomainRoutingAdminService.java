package vacademy.io.admin_core_service.features.domain_routing.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingUpsertRequest;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.enums.PhoneCountryGeoMode;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;

import java.util.Optional;

@Service
@RequiredArgsConstructor
public class DomainRoutingAdminService {

        /**
         * What an auth flag becomes when nobody has said otherwise.
         *
         * <p>NULL was never a third state anyone designed — it is just "the caller
         * didn't send this field". The problem is that the two screens reading it
         * disagree about what it means: the login pages treat a null
         * {@code allow_*} as PERMITTED ({@code allowSignup !== false}), while the
         * white-label wizard renders the same null as an OFF switch
         * ({@code checked={!!config[field]}}). So an admin configured a portal
         * seeing every method switched off, saved, and shipped one with all of them
         * on. Writing the value down removes the disagreement.
         *
         * <p>The auth METHODS default to true because that is what null already did
         * in production — this records the behaviour rather than changing it.
         * Self-signup defaults to false because it is the one flag where the safe
         * answer is "off until somebody asks for it", and because it is already
         * explicitly false on the overwhelming majority of rows.
         */
        private static final boolean DEFAULT_ALLOW_SIGNUP = false;
        private static final boolean DEFAULT_ALLOW_AUTH_METHOD = true;

        /**
         * Phone auth is the exception to {@link #DEFAULT_ALLOW_AUTH_METHOD}, and it
         * has to be, because it is the one flag the frontends read as
         * {@code allowPhoneAuth === true} rather than {@code !== false} — on the
         * login page of BOTH dashboards, and in step-two-form / useInviteForm where
         * it decides whether a learner account is created with a phone number as its
         * username. Null therefore already means OFF for phone, and defaulting it to
         * true would not be recording existing behaviour the way the others do: it
         * would switch phone login on for every portal that never chose it, and
         * change how their learners get enrolled.
         */
        private static final boolean DEFAULT_ALLOW_PHONE_AUTH = false;

        private final InstituteDomainRoutingRepository repository;

        /**
         * Resolves a nullable flag: what the caller sent, else what the row already
         * holds, else the default.
         *
         * <p>Falling back to {@code existing} matters on update — the generic CRUD
         * callers post partial payloads, and coercing their omissions straight to
         * the default would silently switch off a method an institute had turned on.
         */
        private static Boolean flagOrDefault(Boolean requested, Boolean existing, boolean fallback) {
                if (requested != null) {
                        return requested;
                }
                return existing != null ? existing : fallback;
        }

        /**
         * Resolves the sub-org linkage on update: null leaves the stored mapping
         * alone, a blank string clears it, anything else sets it.
         *
         * <p>Null CANNOT mean "clear" here. The white-label wizard posts a routing
         * config that had no sub-org field at all, so every save through it was
         * blanking {@code sub_org_id} on the row it was editing. That is not a
         * cosmetic loss: the row's {@code institute_id} is the PARENT institute, so
         * this id is the only thing that tells one sub-org's portal from another's.
         * Losing it reverts the portal to parent branding AND disables the
         * {@code portalSubOrgId} check in loginFlowHandler, after which any sub-org
         * admin can sign in on any sibling sub-org's portal.
         */
        private static String subOrgIdOrKeep(String requested, String existing) {
                if (requested == null) {
                        return existing;
                }
                String trimmed = requested.trim();
                return trimmed.isEmpty() ? null : trimmed;
        }

        public InstituteDomainRouting create(DomainRoutingUpsertRequest request) {
                validate(request);
                InstituteDomainRouting entity = InstituteDomainRouting.builder()
                                .domain(request.getDomain().trim())
                                .subdomain(request.getSubdomain().trim())
                                .role(request.getRole().trim())
                                .instituteId(request.getInstituteId().trim())
                                .redirect(request.getRedirect() == null ? null : request.getRedirect().trim())
                                .privacyPolicyUrl(request.getPrivacyPolicyUrl() == null ? null
                                                : request.getPrivacyPolicyUrl().trim())
                                .afterLoginRoute(request.getAfterLoginRoute() == null ? null
                                                : request.getAfterLoginRoute().trim())
                                .adminPortalAfterLogoutRoute(request.getAdminPortalAfterLogoutRoute() == null ? null
                                                : request.getAdminPortalAfterLogoutRoute().trim())
                                .homeIconClickRoute(
                                                request.getHomeIconClickRoute() == null ? null
                                                                : request.getHomeIconClickRoute().trim())
                                .termsAndConditionUrl(
                                                request.getTermsAndConditionUrl() == null ? null
                                                                : request.getTermsAndConditionUrl().trim())
                                .theme(request.getTheme() == null ? null : request.getTheme().trim())
                                .tabText(request.getTabText() == null ? null : request.getTabText().trim())
                                .allowSignup(flagOrDefault(request.getAllowSignup(), null, DEFAULT_ALLOW_SIGNUP))
                                .tabIconFileId(request.getTabIconFileId() == null ? null
                                                : request.getTabIconFileId().trim())
                                .fontFamily(request.getFontFamily() == null ? null : request.getFontFamily().trim())
                                .allowGoogleAuth(flagOrDefault(request.getAllowGoogleAuth(), null,
                                                DEFAULT_ALLOW_AUTH_METHOD))
                                .allowGithubAuth(flagOrDefault(request.getAllowGithubAuth(), null,
                                                DEFAULT_ALLOW_AUTH_METHOD))
                                .allowEmailOtpAuth(flagOrDefault(request.getAllowEmailOtpAuth(), null,
                                                DEFAULT_ALLOW_AUTH_METHOD))
                                .allowPhoneAuth(flagOrDefault(request.getAllowPhoneAuth(), null,
                                                DEFAULT_ALLOW_PHONE_AUTH))
                                .allowUsernamePasswordAuth(flagOrDefault(request.getAllowUsernamePasswordAuth(), null,
                                                DEFAULT_ALLOW_AUTH_METHOD))
                                .playStoreAppLink(request.getPlayStoreAppLink() == null ? null
                                                : request.getPlayStoreAppLink().trim())
                                .appStoreAppLink(request.getAppStoreAppLink() == null ? null
                                                : request.getAppStoreAppLink().trim())
                                .windowsAppLink(request.getWindowsAppLink() == null ? null
                                                : request.getWindowsAppLink().trim())
                                .macAppLink(request.getMacAppLink() == null ? null : request.getMacAppLink().trim())
                                .convertUsernamePasswordToLowercase(
                                                request.getConvertUsernamePasswordToLowercase() != null
                                                                ? request.getConvertUsernamePasswordToLowercase()
                                                                : false)
                                .subOrgId(subOrgIdOrKeep(request.getSubOrgId(), null))
                                .commaSeparatedPreferredCountry(
                                                request.getCommaSeparatedPreferredCountry() == null ? null
                                                                : request.getCommaSeparatedPreferredCountry().trim())
                                .phoneCountryGeoMode(
                                                PhoneCountryGeoMode.normalizeForStorage(
                                                                request.getPhoneCountryGeoMode()))
                                .hideInstituteName(request.getHideInstituteName())
                                .logoWidthPx(request.getLogoWidthPx())
                                .logoHeightPx(request.getLogoHeightPx())
                                .stackNameBelowLogo(request.getStackNameBelowLogo())
                                .applyNamingSetting(Boolean.TRUE.equals(request.getApplyNamingSetting()))
                                .rootCatalogueTag(normalizeRootTag(request.getRootCatalogueTag()))
                                .primary(Boolean.TRUE.equals(request.getPrimary()))
                                .build();
                return repository.save(entity);
        }

        public Optional<InstituteDomainRouting> get(String id) {
                return repository.findById(id);
        }

        public Optional<InstituteDomainRouting> update(String id, DomainRoutingUpsertRequest request) {
                validate(request);
                return repository.findById(id).map(existing -> {
                        existing.setDomain(request.getDomain().trim());
                        existing.setSubdomain(request.getSubdomain().trim());
                        existing.setRole(request.getRole().trim());
                        existing.setInstituteId(request.getInstituteId().trim());
                        existing.setAfterLoginRoute(
                                        request.getAfterLoginRoute() == null ? null
                                                        : request.getAfterLoginRoute().trim());
                        existing.setAdminPortalAfterLogoutRoute(request.getAdminPortalAfterLogoutRoute() == null ? null
                                        : request.getAdminPortalAfterLogoutRoute().trim());
                        existing.setHomeIconClickRoute(
                                        request.getHomeIconClickRoute() == null ? null
                                                        : request.getHomeIconClickRoute().trim());
                        existing.setRedirect(request.getRedirect() == null ? null : request.getRedirect().trim());
                        existing.setPrivacyPolicyUrl(
                                        request.getPrivacyPolicyUrl() == null ? null
                                                        : request.getPrivacyPolicyUrl().trim());
                        existing.setTermsAndConditionUrl(
                                        request.getTermsAndConditionUrl() == null ? null
                                                        : request.getTermsAndConditionUrl().trim());
                        existing.setTheme(request.getTheme() == null ? null : request.getTheme().trim());
                        existing.setTabText(request.getTabText() == null ? null : request.getTabText().trim());
                        existing.setAllowSignup(flagOrDefault(request.getAllowSignup(),
                                        existing.getAllowSignup(), DEFAULT_ALLOW_SIGNUP));
                        existing.setTabIconFileId(
                                        request.getTabIconFileId() == null ? null : request.getTabIconFileId().trim());
                        existing.setFontFamily(request.getFontFamily() == null ? null : request.getFontFamily().trim());
                        existing.setAllowGoogleAuth(flagOrDefault(request.getAllowGoogleAuth(),
                                        existing.getAllowGoogleAuth(), DEFAULT_ALLOW_AUTH_METHOD));
                        existing.setAllowGithubAuth(flagOrDefault(request.getAllowGithubAuth(),
                                        existing.getAllowGithubAuth(), DEFAULT_ALLOW_AUTH_METHOD));
                        existing.setAllowEmailOtpAuth(flagOrDefault(request.getAllowEmailOtpAuth(),
                                        existing.getAllowEmailOtpAuth(), DEFAULT_ALLOW_AUTH_METHOD));
                        existing.setAllowPhoneAuth(flagOrDefault(request.getAllowPhoneAuth(),
                                        existing.getAllowPhoneAuth(), DEFAULT_ALLOW_PHONE_AUTH));
                        existing.setAllowUsernamePasswordAuth(flagOrDefault(request.getAllowUsernamePasswordAuth(),
                                        existing.getAllowUsernamePasswordAuth(), DEFAULT_ALLOW_AUTH_METHOD));
                        existing.setPlayStoreAppLink(
                                        request.getPlayStoreAppLink() == null ? null
                                                        : request.getPlayStoreAppLink().trim());
                        existing.setAppStoreAppLink(
                                        request.getAppStoreAppLink() == null ? null
                                                        : request.getAppStoreAppLink().trim());
                        existing.setWindowsAppLink(request.getWindowsAppLink() == null ? null
                                        : request.getWindowsAppLink().trim());
                        existing.setMacAppLink(request.getMacAppLink() == null ? null : request.getMacAppLink().trim());
                        existing.setConvertUsernamePasswordToLowercase(
                                        request.getConvertUsernamePasswordToLowercase() != null
                                                        ? request.getConvertUsernamePasswordToLowercase()
                                                        : false);
                        existing.setSubOrgId(subOrgIdOrKeep(request.getSubOrgId(), existing.getSubOrgId()));
                        existing.setCommaSeparatedPreferredCountry(
                                        request.getCommaSeparatedPreferredCountry() == null ? null
                                                        : request.getCommaSeparatedPreferredCountry().trim());
                        // Keep on null, like subOrgId and primary below, rather than
                        // blanking. The white-label wizard is the only thing that can set
                        // this, and it round-trips through THIS method — so a caller that
                        // predates the field (the generic CRUD, a script, a stale frontend
                        // bundle saving an unrelated change) would otherwise silently reset
                        // a portal's chosen mode by simply not mentioning it. Nothing is
                        // lost: clearing to null and choosing INSTITUTE_FIRST mean the same
                        // thing, and the wizard always sends a concrete value.
                        if (StringUtils.hasText(request.getPhoneCountryGeoMode())) {
                                existing.setPhoneCountryGeoMode(
                                                PhoneCountryGeoMode.normalizeForStorage(
                                                                request.getPhoneCountryGeoMode()));
                        }
                        existing.setHideInstituteName(request.getHideInstituteName());
                        existing.setLogoWidthPx(request.getLogoWidthPx());
                        existing.setLogoHeightPx(request.getLogoHeightPx());
                        existing.setStackNameBelowLogo(request.getStackNameBelowLogo());
                        existing.setApplyNamingSetting(
                                        Boolean.TRUE.equals(request.getApplyNamingSetting()));
                        // Null means "not my business" rather than "false": the generic CRUD
                        // callers never send this field, and coercing their null to false would
                        // silently demote the row the white-label wizard chose as the portal URL.
                        if (request.getPrimary() != null) {
                                existing.setPrimary(request.getPrimary());
                        }
                        // Same contract as primary: absent means untouched, so a caller that
                        // predates the field cannot silently un-mount a root catalogue.
                        if (request.getRootCatalogueTag() != null) {
                                existing.setRootCatalogueTag(normalizeRootTag(request.getRootCatalogueTag()));
                        }
                        return repository.save(existing);
                });
        }

        public void delete(String id) {
                repository.deleteById(id);
        }

        private void validate(DomainRoutingUpsertRequest request) {
                if (!StringUtils.hasText(request.getDomain()) || !StringUtils.hasText(request.getSubdomain())
                                || !StringUtils.hasText(request.getRole())
                                || !StringUtils.hasText(request.getInstituteId())) {
                        throw new IllegalArgumentException(
                                        "All fields domain, subdomain, role, instituteId are required");
                }
        }

        /** Trim, strip any leading slash, and turn blank into null (= not mounted). */
        private static String normalizeRootTag(String raw) {
                if (raw == null) return null;
                String t = raw.trim().replaceFirst("^/+", "");
                return t.isEmpty() ? null : t;
        }
}
