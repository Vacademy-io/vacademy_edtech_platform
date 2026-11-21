package vacademy.io.admin_core_service.features.commerce.security;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffScopeRepository;
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
 *
 * <p>Institute-wide staff: an institute ADMIN, or a store manager or accountant whose
 * {@code commerce_staff_scope} row says {@code all_locations}. Only the accounts feature honours
 * the scope row in the location check; every other feature keeps the per-location rows.
 */
@Component
public class CommerceAccessGuard {

    private static final String ADMIN = "ADMIN";
    private static final Set<CommerceRole> WIDE_ROLES = EnumSet.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CapabilityResolver capabilityResolver;
    private final CommerceStaffLocationRepository staffLocationRepository;

    public CommerceAccessGuard(CapabilityResolver capabilityResolver,
                               CommerceStaffLocationRepository staffLocationRepository) {
        this.capabilityResolver = capabilityResolver;
        this.staffLocationRepository = staffLocationRepository;
    }

    /** Institute-wide scope rows; absent in guards built by hand, where only an ADMIN is institute-wide. */
    private CommerceStaffScopeRepository staffScopeRepository;

    @Autowired(required = false)
    public void setStaffScopeRepository(CommerceStaffScopeRepository staffScopeRepository) {
        this.staffScopeRepository = staffScopeRepository;
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
        if (feature == CommerceFeature.ACCOUNTS && isInstituteWide(user, instituteId)) {
            return;
        }
        if (locationId == null || locationId.isBlank()
                || !staffLocationRepository.existsByInstituteIdAndUserIdAndLocationId(
                        instituteId, user.getUserId(), locationId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "you are not assigned to this location");
        }
    }

    /**
     * As {@link #require(CustomUserDetails, String, CommerceFeature, Set)}, and the caller must be
     * institute-wide ({@link #isInstituteWide}). Refusals in order: ACCESS_DENIED, FEATURE_DISABLED,
     * ROLE_NOT_ALLOWED, then INSTITUTE_WIDE_REQUIRED.
     */
    public void requireInstituteWide(CustomUserDetails user, String instituteId, CommerceFeature feature,
                                     Set<CommerceRole> allowedRoles) {
        require(user, instituteId, feature, allowedRoles);
        if (!isInstituteWide(user, instituteId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.INSTITUTE_WIDE_REQUIRED,
                    "this needs a manager or accountant who acts for every location");
        }
    }

    /**
     * Whether the caller acts for every location of the institute: an institute ADMIN, or a store
     * manager or accountant with a {@code commerce_staff_scope} row whose {@code all_locations} is
     * true. A scope row on any other role counts for nothing. No membership or feature check: call
     * it after {@code require}.
     */
    public boolean isInstituteWide(CustomUserDetails user, String instituteId) {
        if (authorityNames(user).contains(ADMIN)) {
            return true;
        }
        Set<CommerceRole> roles = rolesOf(user);
        roles.retainAll(WIDE_ROLES);
        return !roles.isEmpty()
                && staffScopeRepository != null
                && user.getUserId() != null
                && staffScopeRepository.existsByInstituteIdAndUserIdAndAllLocationsTrue(instituteId, user.getUserId());
    }

    /**
     * As {@link #require(CustomUserDetails, String, CommerceFeature, Set)} for {@code feature} and
     * {@code roles}, or else for {@code orFeature} and {@code orRoles}: a read two modules share
     * (the billing counter's settings read locations and bill books). When neither passes, the
     * refusal of the first is thrown.
     */
    public void requireEither(CustomUserDetails user, String instituteId, CommerceFeature feature,
                              Set<CommerceRole> roles, CommerceFeature orFeature, Set<CommerceRole> orRoles) {
        try {
            require(user, instituteId, feature, roles);
        } catch (CommerceAccessDeniedException first) {
            try {
                require(user, instituteId, orFeature, orRoles);
            } catch (CommerceAccessDeniedException second) {
                throw first;
            }
        }
    }

    /** For public storefront endpoints: the institute has the feature, nothing about the caller. */
    public void requireFeature(String instituteId, CommerceFeature feature) {
        if (feature == null || !capabilityResolver.isFeatureGranted(instituteId, feature.key())) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED,
                    "commerce is not enabled for this institute");
        }
    }

    /** Whether an institute has a feature, as work no person starts sees it. */
    public enum FeatureState {
        /** Granted. */
        ON,
        /** Not granted. */
        OFF,
        /** The resolver failed: neither on nor off; the caller tries again later. */
        UNKNOWN
    }

    /**
     * For work no person starts (jobs, automatic refunds): whether the institute has the
     * feature. Never throws.
     */
    public boolean featureOn(String instituteId, CommerceFeature feature) {
        return featureState(instituteId, feature) == FeatureState.ON;
    }

    /**
     * As {@link #featureOn}, telling "off" apart from "could not be read" ({@link FeatureState#UNKNOWN}
     * when the resolver throws). Never throws.
     */
    public FeatureState featureState(String instituteId, CommerceFeature feature) {
        if (feature == null) {
            return FeatureState.OFF;
        }
        try {
            return capabilityResolver.isFeatureGranted(instituteId, feature.key()) ? FeatureState.ON : FeatureState.OFF;
        } catch (RuntimeException e) {
            return FeatureState.UNKNOWN;
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
