package vacademy.io.admin_core_service.features.commerce.security;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * Access to the setup screens that belong to no single feature (Settings opens on
 * "any commerce feature"). The caller must be a member of the institute,
 * the institute must have at least one commerce feature, and the caller must hold one of the
 * roles. Every check is the one of {@link CommerceAccessGuard}; nothing is relaxed.
 */
@Component
@RequiredArgsConstructor
public class CommerceSetupAccess {

    private final CommerceAccessGuard accessGuard;

    public void require(CustomUserDetails user, String instituteId, Set<CommerceRole> allowedRoles) {
        CommerceAccessDeniedException featureDisabled = null;
        for (CommerceFeature feature : CommerceFeature.values()) {
            try {
                accessGuard.require(user, instituteId, feature, allowedRoles);
                return;
            } catch (CommerceAccessDeniedException e) {
                if (!CommerceAccessDeniedException.FEATURE_DISABLED.equals(e.getCode())) {
                    throw e;
                }
                featureDisabled = e;
            }
        }
        throw featureDisabled != null ? featureDisabled
                : new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED,
                        "commerce is not enabled for this institute");
    }
}
