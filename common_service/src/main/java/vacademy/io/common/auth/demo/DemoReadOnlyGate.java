package vacademy.io.common.auth.demo;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;

/**
 * The read-only demo user (docs/demo-stage/SPEC.md section 3).
 *
 * <p>A public demo hands every visitor the sign-in of one user who is ADMIN of a demo
 * institute and also holds the role {@link #ROLE}. For that user GET, HEAD and OPTIONS pass
 * (except the GETs in {@link DemoReadOnlyAllowList} that change something or cost money) and
 * every other request is refused unless its path is on the read allow-list.
 *
 * <p>Called from the JWT filters after the user is resolved. It reads only what the filter
 * already has (the token's claims and the loaded user), so it adds no query for anyone.
 * There is no root-user exception: {@code is_root_user} is set for ordinary admins.
 */
public final class DemoReadOnlyGate {

    public static final String ROLE = "DEMO_READ_ONLY";

    /** Request attribute the filters set to TRUE for every request made by the demo user. */
    public static final String REQUEST_ATTRIBUTE = "vacademy.demoReadOnly";

    /** The exact response body; ai_service answers with the same bytes. */
    public static final String REFUSAL_BODY =
            "{\"code\":\"DEMO_READ_ONLY\",\"message\":\"This is a demo. Changes are not saved.\"}";

    private DemoReadOnlyGate() {
    }

    /**
     * True when the caller is the demo user: the role is among the authorities loaded for
     * the request's institute, or the token's {@code authorities} claim lists it under ANY
     * institute. The claim is checked because the {@code clientId} header is chosen by the
     * caller: leaving it out, or naming another institute, must not switch the gate off.
     *
     * @param user             the user the filter resolved, may be null
     * @param authoritiesClaim the token's {@code authorities} claim
     *                         ({@code {instituteId: {roles: [...], permissions: [...]}}}), may be null
     */
    public static boolean holdsRole(CustomUserDetails user, Object authoritiesClaim) {
        if (user != null) {
            Collection<? extends GrantedAuthority> authorities = user.getAuthorities();
            if (authorities != null) {
                for (GrantedAuthority authority : authorities) {
                    if (authority != null && isRole(authority.getAuthority())) {
                        return true;
                    }
                }
            }
        }
        if (authoritiesClaim instanceof Map<?, ?> byInstitute) {
            for (Object entry : byInstitute.values()) {
                if (entry instanceof Map<?, ?> institute && institute.get("roles") instanceof Collection<?> roles) {
                    for (Object role : roles) {
                        if (role != null && isRole(role.toString())) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    private static boolean isRole(String name) {
        return name != null
                && ROLE.equals(name.trim().toUpperCase(Locale.ROOT).replace('-', '_').replace(' ', '_'));
    }

    /**
     * The decision for a request made by the demo user.
     *
     * @param method      HTTP method
     * @param requestUri  the raw request URI ({@code HttpServletRequest#getRequestURI})
     * @param queryString the raw query string, may be null
     * @return true when the request must be refused
     */
    public static boolean refuses(String method, String requestUri, String queryString) {
        String verb = method == null ? "" : method.toUpperCase(Locale.ROOT);
        if ("OPTIONS".equals(verb)) {
            return false;
        }
        if ("GET".equals(verb) || "HEAD".equals(verb)) {
            return DemoReadOnlyAllowList.isBlockedGet(requestUri, queryString);
        }
        return !DemoReadOnlyAllowList.isAllowedRead(verb, requestUri);
    }

    /** {@link #holdsRole} and {@link #refuses} together: true when this request must be refused. */
    public static boolean refuses(HttpServletRequest request, CustomUserDetails user, Object authoritiesClaim) {
        if (!holdsRole(user, authoritiesClaim)) {
            return false;
        }
        request.setAttribute(REQUEST_ATTRIBUTE, Boolean.TRUE);
        return refuses(request.getMethod(), request.getRequestURI(), request.getQueryString());
    }

    /**
     * True when the request being served was made by the demo user. For the few allowed
     * reads that would otherwise return a sign-in (a learner's or team member's password):
     * the handler leaves the password out when this is true. Checks the attribute the
     * filter set from the token (covers every institute the token names) and the loaded
     * user's authorities.
     */
    public static boolean isDemoCaller(CustomUserDetails user) {
        if (holdsRole(user, null)) {
            return true;
        }
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        return attributes != null
                && Boolean.TRUE.equals(attributes.getAttribute(REQUEST_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST));
    }

    public static void writeRefusal(HttpServletResponse response) throws IOException {
        byte[] body = REFUSAL_BODY.getBytes(StandardCharsets.UTF_8);
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
        response.flushBuffer();
    }
}
