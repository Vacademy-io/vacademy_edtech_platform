package vacademy.io.common.auth.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.AccessRevokedException;
import vacademy.io.common.auth.filter.JwtAuthFilter;

import java.io.IOException;

/**
 * Writes a JSON body when Spring Security refuses a request.
 *
 * <p>
 * Without this, a denied request is re-dispatched to {@code /error}, which is
 * itself secured and therefore also denied — the caller gets HTTP 403 with a
 * zero-length body and no way to tell a permissions problem from an
 * unresolvable token, a missing required request param, or no mapping for that
 * method at all. Every one of those has cost real debugging time.
 *
 * <p>
 * The status code is deliberately left at 403 so no existing client branches
 * change behaviour; only the body is added. When {@link JwtAuthFilter} knows
 * why authentication did not stick, its reason is passed through.
 */
@Component
public class JsonAuthEntryPoint implements AuthenticationEntryPoint, AccessDeniedHandler {

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        write(request, response);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException accessDeniedException) throws IOException {
        write(request, response);
    }

    private void write(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        Object reason = request.getAttribute(JwtAuthFilter.AUTH_FAILURE_REASON);
        boolean hadBearer = request.getHeader("Authorization") != null
                && request.getHeader("Authorization").startsWith("Bearer ");

        String message;
        String code;
        if (AccessRevokedException.CODE.equals(reason)) {
            // Clients end the session on this code — and only on this one.
            code = "ACCESS_REVOKED";
            message = "Your access to this institute has been disabled. Please contact your institute admin.";
        } else if (reason instanceof String r) {
            code = "USER_NOT_RESOLVED";
            message = r;
        } else if (!hadBearer) {
            code = "UNAUTHENTICATED";
            message = "No credentials were presented for a protected endpoint.";
        } else {
            code = "ACCESS_DENIED";
            message = "The presented token does not grant access to this endpoint.";
        }

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(String.format(
                "{\"error\":\"%s\",\"message\":\"%s\",\"path\":\"%s\"}",
                code, message, escape(request.getRequestURI())));
    }

    private String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
