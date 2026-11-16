package vacademy.io.admin_core_service.features.commerce.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.EnumSet;
import java.util.HashSet;
import java.util.Set;

/**
 * The only access check for {@code /commerce/v1} staff endpoints.
 *
 * <p>Order: membership of THIS institute, the commerce feature, a commerce role (or ADMIN),
 * then the location. Membership is the test of
 * {@code InstituteAccessValidator.requireInstituteAdmin}: auth_service mints the authorities
 * for the clientId-header institute only, so a non-empty list plus a header equal to the
 * institute proves membership of exactly that one.
 *
 * <p>The root flag is never read here: access needs membership of the institute and a
 * commerce role.
 */
@Component
public class CommerceAccessGuard {

    private static final String ADMIN = "ADMIN";

    private final CapabilityResolver capabilityResolver;
    private final CommerceStaffLocationRepository staffLocationRepository;

    public CommerceAccessGuard(CapabilityResolver capabilityResolver,
                               CommerceStaffLocationRepository staffLocationRepository) {
        this.capabilityResolver = capabilityResolver;
        this.staffLocationRepository = staffLocationRepository;
    }

    /** Member of the institute, feature granted, and ADMIN or one of {@code allowedRoles}. */
    public void require(CustomUserDetails user, String instituteId, CommerceFeature feature,
                        Set<CommerceRole> allowedRoles) {
        requireMember(user, instituteId);
        requireFeature(instituteId, feature);
        requireRole(authorityNames(user), allowedRoles);
    }

    /**
     * As {@link #require(CustomUserDetails, String, CommerceFeature, Set)}, and a caller who is
     * not an institute ADMIN must be assigned to {@code locationId} in
     * {@code commerce_staff_location}. A blank location is refused for a non-admin.
     */
    public void require(CustomUserDetails user, String instituteId, CommerceFeature feature,
                        Set<CommerceRole> allowedRoles, String locationId) {
        require(user, instituteId, feature, allowedRoles);
        if (authorityNames(user).contains(ADMIN)) {
            return;
        }
        if (locationId == null || locationId.isBlank()
                || !staffLocationRepository.existsByInstituteIdAndUserIdAndLocationId(
                        instituteId, user.getUserId(), locationId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "you are not assigned to this location");
        }
    }

    /** For public storefront endpoints: the institute has the feature, nothing about the caller. */
    public void requireFeature(String instituteId, CommerceFeature feature) {
        if (feature == null || !capabilityResolver.isFeatureGranted(instituteId, feature.key())) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED,
                    "commerce is not enabled for this institute");
        }
    }

    /**
     * For work no person starts (jobs, automatic refunds): whether the institute has the
     * feature. Never throws.
     */
    public boolean featureOn(String instituteId, CommerceFeature feature) {
        try {
            return feature != null && capabilityResolver.isFeatureGranted(instituteId, feature.key());
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The commerce roles the principal carries. Says nothing about membership. */
    public static Set<CommerceRole> rolesOf(CustomUserDetails user) {
        Set<String> names = authorityNames(user);
        Set<CommerceRole> out = EnumSet.noneOf(CommerceRole.class);
        for (CommerceRole role : CommerceRole.values()) {
            if (names.contains(role.authority())) {
                out.add(role);
            }
        }
        return out;
    }

    /**
     * True when the caller is a member of this institute (the root flag is not consulted) and holds at least
     * one commerce role. No feature check: used where shop staff must be let in although they
     * are not general staff (the capability {@code /me} read).
     */
    public static boolean holdsCommerceRole(CustomUserDetails user, String instituteId) {
        return isMember(user, instituteId) && !rolesOf(user).isEmpty();
    }

    private static void requireMember(CustomUserDetails user, String instituteId) {
        if (!isMember(user, instituteId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ACCESS_DENIED,
                    "you do not belong to this institute");
        }
    }

    private static boolean isMember(CustomUserDetails user, String instituteId) {
        return user != null
                && user.getUserId() != null
                && instituteId != null && !instituteId.isBlank()
                && !authorityNames(user).isEmpty()
                && instituteId.equals(currentClientIdHeader());
    }

    private static void requireRole(Set<String> authorityNames, Set<CommerceRole> allowedRoles) {
        if (authorityNames.contains(ADMIN)) {
            return;
        }
        if (allowedRoles != null) {
            for (CommerceRole role : allowedRoles) {
                if (authorityNames.contains(role.authority())) {
                    return;
                }
            }
        }
        throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                "your role does not allow this action");
    }

    private static Set<String> authorityNames(CustomUserDetails user) {
        Set<String> names = new HashSet<>();
        if (user != null && user.getAuthorities() != null) {
            for (GrantedAuthority authority : user.getAuthorities()) {
                if (authority != null && authority.getAuthority() != null) {
                    names.add(authority.getAuthority().trim().toUpperCase());
                }
            }
        }
        return names;
    }

    private static String currentClientIdHeader() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            return servletAttributes.getRequest().getHeader("clientId");
        }
        return null;
    }
}
