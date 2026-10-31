package vacademy.io.assessment_service.features.open_evaluation;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.util.UriUtils;

import java.nio.charset.StandardCharsets;

/**
 * Paths of the AI Evaluation partner API (docs/AI_EVALUATION_PUBLIC_API.md section 7).
 * The public host {@code https://api.evalezy.com/v1/...} is rewritten by ingress to
 * {@link #BASE}{@code /...}, so this service only ever sees the long form.
 */
public final class OpenApiPaths {

    /** Every partner endpoint lives under this base. */
    public static final String BASE = "/assessment-service/open/evaluation/v1";

    /** {@link #BASE} with the trailing slash, for prefix matching. */
    public static final String PREFIX = BASE + "/";

    /** Prefix on which a present {@code X-API-Key} is authenticated at all (spec 6.4). */
    public static final String OPEN_PREFIX = "/assessment-service/open/";

    /** The OpenAPI document: public, no key. */
    public static final String OPENAPI_JSON = BASE + "/openapi.json";

    /** Ant pattern of every partner endpoint, for security and interceptor registration. */
    public static final String ANT_PATTERN = BASE + "/**";

    /** Product an evaluation key and the institute must have enabled. */
    public static final String PRODUCT = "evaluation";

    private OpenApiPaths() {
    }

    /** True when the request targets the partner API (raw or percent-decoded path). */
    public static boolean isOpenEvaluation(HttpServletRequest request) {
        if (request == null) {
            return false;
        }
        return isOpenEvaluationUri(request.getRequestURI());
    }

    /**
     * {@link #isOpenEvaluation} that also sees through the container's error dispatch: on
     * {@code /error} the original partner path is in {@code jakarta.servlet.error.request_uri}.
     */
    public static boolean isOpenEvaluationOrErrorFor(HttpServletRequest request) {
        if (isOpenEvaluation(request)) {
            return true;
        }
        if (request == null) {
            return false;
        }
        Object original = request.getAttribute(RequestDispatcher.ERROR_REQUEST_URI);
        return original instanceof String uri && isOpenEvaluationUri(uri);
    }

    private static boolean isOpenEvaluationUri(String raw) {
        if (raw == null) {
            return false;
        }
        if (raw.startsWith(PREFIX) || raw.equals(BASE)) {
            return true;
        }
        if (raw.indexOf('%') >= 0) {
            try {
                String decoded = UriUtils.decode(raw, StandardCharsets.UTF_8);
                return decoded.startsWith(PREFIX) || decoded.equals(BASE);
            } catch (IllegalArgumentException malformed) {
                return false;
            }
        }
        return false;
    }
}
