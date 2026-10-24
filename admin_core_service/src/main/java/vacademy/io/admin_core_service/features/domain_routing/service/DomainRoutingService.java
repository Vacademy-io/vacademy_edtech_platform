package vacademy.io.admin_core_service.features.domain_routing.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingResolveResponse;
import vacademy.io.admin_core_service.features.domain_routing.dto.NamingOverridesDto;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.enums.PhoneCountryGeoMode;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.enums.SettingKeyEnums;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class DomainRoutingService {

    private static final ObjectMapper NAMING_OBJECT_MAPPER = new ObjectMapper();

    private final InstituteDomainRoutingRepository routingRepository;
    private final InstituteRepository instituteRepository;

    public Optional<DomainRoutingResolveResponse> resolve(String domain, String subdomain) {
        if (!StringUtils.hasText(domain) || !StringUtils.hasText(subdomain)) {
            return Optional.empty();
        }

        return routingRepository.resolveMapping(domain.trim(), subdomain.trim())
                .flatMap(this::buildResponse);
    }

    /**
     * Resolve branding/theme for a fixed institute id rather than the request
     * host. Used by native flavors (e.g. Vacademy Admin) whose WebView has no
     * meaningful hostname but which are anchored to a single institute. When the
     * institute has several routing rows, an admin/teacher-facing row is
     * preferred; otherwise the first row is used.
     */
    public Optional<DomainRoutingResolveResponse> resolveByInstituteId(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            return Optional.empty();
        }

        List<InstituteDomainRouting> mappings = routingRepository.findByInstituteId(instituteId.trim());
        if (mappings.isEmpty()) {
            return Optional.empty();
        }

        // Deterministic order so a multi-row institute resolves the same branding
        // on every request/restart (findByInstituteId has no ORDER BY, and Postgres
        // row order is otherwise arbitrary). Prefer an admin/teacher-facing row,
        // then fall back to the lowest id.
        List<InstituteDomainRouting> ordered = mappings.stream()
                .sorted(Comparator.comparing(InstituteDomainRouting::getId,
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();

        InstituteDomainRouting mapping = ordered.stream()
                .filter(m -> {
                    String role = m.getRole();
                    if (role == null) {
                        return false;
                    }
                    String upper = role.toUpperCase();
                    return upper.contains("ADMIN") || upper.contains("TEACHER");
                })
                .findFirst()
                .orElse(ordered.get(0));

        return buildResponse(mapping);
    }

    private Optional<DomainRoutingResolveResponse> buildResponse(InstituteDomainRouting mapping) {
        Institute institute = null;

        if (StringUtils.hasText(mapping.getInstituteId())) {
            // Trim defensively: a stray trailing newline/space in the
            // institute_domain_routing.institute_id column would otherwise make
            // findById miss and 404 the whole row (seen on the admin-app row).
            Optional<Institute> instituteOpt =
                    instituteRepository.findById(mapping.getInstituteId().trim());
            if (instituteOpt.isEmpty()) {
                return Optional.empty();
            }
            institute = instituteOpt.get();
        }

        DomainRoutingResolveResponse.DomainRoutingResolveResponseBuilder responseBuilder = DomainRoutingResolveResponse
                .builder()
                .role(mapping.getRole())
                .redirect(mapping.getRedirect())
                .privacyPolicyUrl(mapping.getPrivacyPolicyUrl())
                .afterLoginRoute(mapping.getAfterLoginRoute())
                .adminPortalAfterLogoutRoute(mapping.getAdminPortalAfterLogoutRoute())
                .homeIconClickRoute(mapping.getHomeIconClickRoute())
                .termsAndConditionUrl(mapping.getTermsAndConditionUrl())
                .theme(mapping.getTheme())
                .tabText(mapping.getTabText())
                .allowSignup(mapping.getAllowSignup())
                .tabIconFileId(mapping.getTabIconFileId())
                .fontFamily(mapping.getFontFamily())
                .allowGoogleAuth(mapping.getAllowGoogleAuth())
                .allowGithubAuth(mapping.getAllowGithubAuth())
                .allowEmailOtpAuth(mapping.getAllowEmailOtpAuth())
                .allowPhoneAuth(mapping.getAllowPhoneAuth())
                .allowUsernamePasswordAuth(mapping.getAllowUsernamePasswordAuth())
                .playStoreAppLink(mapping.getPlayStoreAppLink())
                .appStoreAppLink(mapping.getAppStoreAppLink())
                .windowsAppLink(mapping.getWindowsAppLink())
                .macAppLink(mapping.getMacAppLink())
                .convertUsernamePasswordToLowercase(mapping.isConvertUsernamePasswordToLowercase())
                .commaSeparatedPreferredCountry(mapping.getCommaSeparatedPreferredCountry())
                .phoneCountryGeoMode(PhoneCountryGeoMode.fromNullable(mapping.getPhoneCountryGeoMode()).name())
                .hideInstituteName(mapping.getHideInstituteName())
                .logoWidthPx(mapping.getLogoWidthPx())
                .logoHeightPx(mapping.getLogoHeightPx())
                .stackNameBelowLogo(mapping.getStackNameBelowLogo())
                .rootCatalogueTag(mapping.getRootCatalogueTag());

        if (institute != null) {
            responseBuilder.instituteId(institute.getId())
                    .instituteName(institute.getInstituteName())
                    .instituteLogoFileId(institute.getLogoFileId())
                    .instituteThemeCode(institute.getInstituteThemeCode())
                    .learnerPortalUrl(institute.getLearnerPortalBaseUrl())
                    .instructorPortalUrl(institute.getAdminPortalBaseUrl());

            // Font: the domain routing row's fontFamily is the legacy per-domain
            // white-label override. The current way institutes pick a font is
            // Settings > Appearance, which writes THEME_SETTING.data.roles.fontFamily
            // on the institute record. Custom-domain learners resolve their branding
            // ONLY through this endpoint pre-login (institute_settings_json is fetched
            // post-login), so without this fallback the Appearance-tab font never
            // reaches them and the learner keeps the default typeface. The per-domain
            // override, when present, still wins.
            if (!StringUtils.hasText(mapping.getFontFamily())) {
                String themeFont = extractThemeFontFamily(institute.getSetting());
                if (StringUtils.hasText(themeFont)) {
                    responseBuilder.fontFamily(themeFont);
                }
            }

            // Opt-in per domain routing row so the JSON parse only runs for
            // tenants that actually need custom terminology on pre-login screens.
            if (mapping.isApplyNamingSetting()) {
                NamingOverridesDto namingOverrides = extractNamingOverrides(institute.getSetting());
                if (namingOverrides != null) {
                    responseBuilder.namingOverrides(namingOverrides);
                }
            }
        }

        // If sub-org is configured, override logo, name, and theme from sub-org institute
        if (StringUtils.hasText(mapping.getSubOrgId())) {
            responseBuilder.subOrgId(mapping.getSubOrgId());
            instituteRepository.findById(mapping.getSubOrgId()).ifPresent(subOrg -> {
                if (StringUtils.hasText(subOrg.getLogoFileId())) {
                    responseBuilder.instituteLogoFileId(subOrg.getLogoFileId());
                }
                if (StringUtils.hasText(subOrg.getInstituteName())) {
                    responseBuilder.instituteName(subOrg.getInstituteName());
                }
                if (StringUtils.hasText(subOrg.getInstituteThemeCode())) {
                    responseBuilder.instituteThemeCode(subOrg.getInstituteThemeCode());
                }
            });
        }

        return Optional.of(responseBuilder.build());
    }

    /**
     * Pull THEME_SETTING.data.roles.fontFamily out of the institute setting JSON —
     * the font an institute picks in Settings > Appearance. Returns null when the
     * setting is absent or malformed so callers fall back to the default typeface.
     */
    private String extractThemeFontFamily(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return null;
        }
        try {
            JsonNode root = NAMING_OBJECT_MAPPER.readTree(settingJson);
            String fontFamily = root.path("setting")
                    .path(SettingKeyEnums.THEME_SETTING.name())
                    .path("data")
                    .path("roles")
                    .path("fontFamily")
                    .asText(null);
            return StringUtils.hasText(fontFamily) ? fontFamily : null;
        } catch (Exception e) {
            log.warn("Failed to parse THEME_SETTING for domain routing response", e);
            return null;
        }
    }

    private NamingOverridesDto extractNamingOverrides(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return null;
        }
        try {
            JsonNode root = NAMING_OBJECT_MAPPER.readTree(settingJson);
            JsonNode entries = root.path("setting")
                    .path(SettingKeyEnums.NAMING_SETTING.name())
                    .path("data")
                    .path("data");
            if (!entries.isArray() || entries.isEmpty()) {
                return null;
            }

            String course = null;
            String coursePlural = null;
            String level = null;
            String session = null;
            String popularTag = null;
            for (JsonNode entry : entries) {
                String key = entry.path("key").asText(null);
                String customValue = entry.path("customValue").asText(null);
                if (!StringUtils.hasText(key) || !StringUtils.hasText(customValue)) {
                    continue;
                }
                if ("Course".equals(key)) {
                    course = customValue;
                } else if ("Course_plural".equals(key)) {
                    coursePlural = customValue;
                } else if ("Level".equals(key)) {
                    level = customValue;
                } else if ("Session".equals(key)) {
                    session = customValue;
                } else if ("PopularTag".equals(key)) {
                    popularTag = customValue;
                }
            }

            if (course == null && coursePlural == null && level == null
                    && session == null && popularTag == null) {
                return null;
            }
            return NamingOverridesDto.builder()
                    .course(course)
                    .coursePlural(coursePlural)
                    .level(level)
                    .session(session)
                    .popularTag(popularTag)
                    .build();
        } catch (Exception e) {
            log.warn("Failed to parse NAMING_SETTING for domain routing response", e);
            return null;
        }
    }
}
