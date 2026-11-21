package vacademy.io.assessment_service.features.open_evaluation.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import vacademy.io.assessment_service.features.open_evaluation.OpenApiPaths;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.common.auth.apikey.ApiErrorWriter;

import java.io.IOException;
import java.util.function.BooleanSupplier;

/**
 * Kill switch for the partner API ({@code assessment.open-api.enabled}, default false; the
 * deploy plan ships the code dark and flips it after the pilot institute is enabled).
 * While off, every partner path answers 404 {@code not_found} before any key is hashed or
 * verified. Dashboard paths are never touched.
 *
 * <p>Not a Spring bean on purpose: a Filter bean would be auto-registered for every path
 * outside the security chain. Added to the chain by {@code ApplicationSecurityConfig}.
 */
public class OpenApiGateFilter extends OncePerRequestFilter {

    private final BooleanSupplier enabled;

    public OpenApiGateFilter(BooleanSupplier enabled) {
        this.enabled = enabled;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!enabled.getAsBoolean() && OpenApiPaths.isOpenEvaluation(request)) {
            ApiErrorWriter.write(request, response, HttpServletResponse.SC_NOT_FOUND, ApiErrorCode.NOT_FOUND,
                    "Not found.", null);
            return;
        }
        chain.doFilter(request, response);
    }
}
