package vacademy.io.assessment_service.features.open_evaluation.error;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.common.auth.apikey.ApiErrorWriter;

import java.io.IOException;
import java.util.Objects;

/**
 * Spring Security's refusal writer: the partner envelope on partner paths, the existing
 * {@code JsonAuthEntryPoint} body everywhere else (unchanged for the dashboard).
 *
 * <p>On partner paths {@code ApiKeyAuthFilter} answers missing/invalid keys itself, so this
 * only fires when a request reaches the URL rule without an {@code ApiKeyAuthentication}
 * (e.g. a filter misconfiguration), or on the container's {@code /error} dispatch of a partner
 * request: it answers 401 {@code invalid_api_key}, never the dashboard's 403 shape.
 */
public class OpenApiAuthEntryPoint implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final AuthenticationEntryPoint fallbackEntryPoint;
    private final AccessDeniedHandler fallbackDeniedHandler;

    public OpenApiAuthEntryPoint(AuthenticationEntryPoint fallbackEntryPoint, AccessDeniedHandler fallbackDeniedHandler) {
        this.fallbackEntryPoint = Objects.requireNonNull(fallbackEntryPoint);
        this.fallbackDeniedHandler = Objects.requireNonNull(fallbackDeniedHandler);
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
            throws IOException, ServletException {
        if (OpenApiPaths.isOpenEvaluationOrErrorFor(request)) {
            writeUnauthenticated(request, response);
            return;
        }
        fallbackEntryPoint.commence(request, response, ex);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex)
            throws IOException, ServletException {
        if (OpenApiPaths.isOpenEvaluationOrErrorFor(request)) {
            writeUnauthenticated(request, response);
            return;
        }
        fallbackDeniedHandler.handle(request, response, ex);
    }

    private static void writeUnauthenticated(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        ApiErrorWriter.write(request, response, HttpServletResponse.SC_UNAUTHORIZED, ApiErrorCode.INVALID_API_KEY,
                "This endpoint needs a valid API key in the X-API-Key header.", null);
    }
}
