package vacademy.io.admin_core_service.features.migration.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.servlet.HandlerMapping;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * Access rule for every migration endpoint. They create users, memberships and payments, so
 * being signed in is not enough:
 * <ul>
 *   <li>/migration/v2/{instituteId}/... : an admin of that institute, or a platform super admin.</li>
 *   <li>everything else (Keap staging uploads, Keap runs, setup): a platform super admin only.
 *       Those work on one shared staging area and take the target institute from the request
 *       body, so no institute role can scope them.</li>
 * </ul>
 * Runs before each handler in this package (a {@code @ModelAttribute} in a package-scoped advice).
 */
@ControllerAdvice(basePackageClasses = MigrationAccessGuard.class)
@RequiredArgsConstructor
public class MigrationAccessGuard {

    private final InstituteAccessValidator instituteAccessValidator;

    @ModelAttribute
    public void requireMigrationAccess(HttpServletRequest request) {
        Object principal = request.getAttribute("user");
        CustomUserDetails user = principal instanceof CustomUserDetails c ? c : null;
        if (user == null) {
            throw new VacademyException("Sign in required");
        }
        @SuppressWarnings("unchecked")
        Map<String, String> vars = (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        String instituteId = vars != null ? vars.get("instituteId") : null;
        if (request.getRequestURI().contains("/migration/v2/") && instituteId != null) {
            instituteAccessValidator.requireInstituteAdminOrSuperAdmin(user, instituteId);
            return;
        }
        if (!instituteAccessValidator.isPlatformSuperAdmin(user)) {
            throw new VacademyException("Only Vacademy super admins can run this migration");
        }
    }
}
