package vacademy.io.assessment_service.features.open_evaluation.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.common.auth.apikey.ApiErrorWriter;
import vacademy.io.common.auth.apikey.ApiKeyAuthentication;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.util.Map;
import java.util.Optional;

/**
 * Applies {@link ApiRateLimiter} to every partner request and sets
 * {@code RateLimit-Limit}, {@code RateLimit-Remaining}, {@code RateLimit-Reset} on every
 * response; a refusal is 429 {@code rate_limited} with {@code Retry-After} (spec 6.7, 11.5).
 *
 * <p>Runs after the security chain, so the caller is already an authenticated key. GET and
 * HEAD are reads; so are the POST lookups that only read ({@code …/search},
 * {@code /credits/quote}). Everything else is a write. Upload file counts are charged
 * separately by the upload endpoint ({@link ApiRateLimiter.Kind#UPLOAD}).
 */
@Component
public class OpenApiRateLimitInterceptor implements HandlerInterceptor {

    public static final String LIMIT = "RateLimit-Limit";
    public static final String REMAINING = "RateLimit-Remaining";
    public static final String RESET = "RateLimit-Reset";

    private final ApiRateLimiter limiter;

    public OpenApiRateLimitInterceptor(ApiRateLimiter limiter) {
        this.limiter = limiter;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        Optional<ApiKeyPrincipal> principal = ApiKeyAuthentication.current();
        if (principal.isEmpty()) {
            return true; // public paths (openapi.json); key paths never get here without a key
        }
        ApiRateLimiter.Decision decision = limiter.acquire(principal.get(), kindOf(request));
        writeHeaders(response, decision);
        if (!decision.allowed()) {
            response.setHeader("Retry-After", String.valueOf(decision.retryAfterSeconds()));
            ApiErrorWriter.write(request, response, 429, ApiErrorCode.RATE_LIMITED,
                    "Too many requests for this API key or institute. Retry after "
                            + decision.retryAfterSeconds() + " s.",
                    Map.of("retry_after_seconds", decision.retryAfterSeconds()));
            return false;
        }
        return true;
    }

    public static void writeHeaders(HttpServletResponse response, ApiRateLimiter.Decision decision) {
        if (decision.limit() <= 0) {
            return;
        }
        response.setHeader(LIMIT, String.valueOf(decision.limit()));
        response.setHeader(REMAINING, String.valueOf(decision.remaining()));
        response.setHeader(RESET, String.valueOf(decision.resetSeconds()));
    }

    static ApiRateLimiter.Kind kindOf(HttpServletRequest request) {
        String method = request.getMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
            return ApiRateLimiter.Kind.READ;
        }
        String uri = request.getRequestURI();
        if ("POST".equalsIgnoreCase(method) && uri != null
                && (uri.endsWith("/search") || uri.endsWith("/credits/quote"))) {
            return ApiRateLimiter.Kind.READ;
        }
        return ApiRateLimiter.Kind.WRITE;
    }
}
