package vacademy.io.admin_core_service.features.engagement.service;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Access guard for the Engagement Engine surface. Membership alone is not enough here:
 * the inbox holds AI-drafted message bodies, rationales, and other subjects' contact PII,
 * so a same-institute LEARNER passing the membership check must NOT be able to read it.
 * The founder locked this to institute admins (design D16), so we require the ADMIN role.
 *
 * <p>No root-user bypass. {@code users.is_root_user} is set by ordinary sign-up and invite
 * flows (~98% of accounts on prod, 2026-09-29), so InstituteAccessValidator's "root skips
 * every check" let almost any logged-in user read another institute's inbox, send its
 * tasks, edit its prompt or lift its kill switch. Membership comes from the authorities
 * instead: auth_service mints them for the {@code clientId}-header institute only, so
 * ADMIN in them, with {@code clientId == instituteId}, proves admin of exactly that one.
 */
@Component
public class EngagementAccessGuard {

    public void requireAdmin(CustomUserDetails user, String instituteId) {
        if (user == null) {
            throw new VacademyException("User authentication required");
        }
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Institute ID is required");
        }
        if (!instituteId.equals(currentClientIdHeader())) {
            throw new VacademyException("Access denied: user does not belong to institute " + instituteId);
        }
        Set<String> roles = user.getAuthorities() == null ? Set.of()
                : user.getAuthorities().stream()
                        .map(GrantedAuthority::getAuthority)
                        .filter(Objects::nonNull)
                        .map(String::toUpperCase)
                        .collect(Collectors.toSet());
        if (!roles.contains("ADMIN")) {
            throw new VacademyException("Engagement Engines require an institute ADMIN role");
        }
    }

    private static String currentClientIdHeader() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servletAttributes) {
            return servletAttributes.getRequest().getHeader("clientId");
        }
        return null;
    }
}
