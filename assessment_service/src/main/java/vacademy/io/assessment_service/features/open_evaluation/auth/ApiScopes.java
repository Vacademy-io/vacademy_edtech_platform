package vacademy.io.assessment_service.features.open_evaluation.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.Optional;

/**
 * Scope check for partner endpoints (spec 6.2, 6.5), used as
 * {@code @PreAuthorize("@apiScopes.has('evaluation:write')")}.
 *
 * <p>True only for an {@link ApiKeyAuthentication} carrying the scope — never for a JWT,
 * never by authority string. On refusal the missing scope is left on the request so the
 * exception handler can answer 403 {@code insufficient_scope} with
 * {@code details.required_scope}.
 */
@Component("apiScopes")
public class ApiScopes {

    public static final String READ = "evaluation:read";
    public static final String WRITE = "evaluation:write";
    public static final String REVIEW = "evaluation:review";
    public static final String FINALIZE = "evaluation:finalize";
    public static final String WEBHOOKS_MANAGE = "webhooks:manage";
    public static final String REVIEW_LINKS = "evaluation:review_links";

    /** Request attribute naming the scope a refused call needed. */
    public static final String REQUIRED_SCOPE_ATTRIBUTE = ApiScopes.class.getName() + ".required";

    public boolean has(String scope) {
        Optional<ApiKeyPrincipal> principal = ApiKeyAuthentication.current();
        if (principal.isPresent() && principal.get().hasScope(scope)) {
            return true;
        }
        HttpServletRequest request = currentRequest();
        if (request != null) {
            request.setAttribute(REQUIRED_SCOPE_ATTRIBUTE, scope);
        }
        return false;
    }

    private static HttpServletRequest currentRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servlet) {
            return servlet.getRequest();
        }
        return null;
    }
}
