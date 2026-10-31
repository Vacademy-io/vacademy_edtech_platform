package vacademy.io.common.auth.apikey;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import vacademy.io.common.tracing.RequestIds;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Writes the public API error envelope from a filter, where no controller advice runs:
 * <pre>
 * {"error":{"code":"invalid_api_key","message":"…","request_id":"req_…","details":{…}}}
 * </pre>
 * and echoes {@code X-Request-Id}.
 */
public final class ApiErrorWriter {

    public static final String MISSING_API_KEY = "missing_api_key";
    public static final String INVALID_API_KEY = "invalid_api_key";
    public static final String PRODUCT_NOT_ENABLED = "product_not_enabled";
    public static final String INSUFFICIENT_SCOPE = "insufficient_scope";
    public static final String AUTH_UNAVAILABLE = "auth_unavailable";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ApiErrorWriter() {
    }

    /** The envelope as a map, for callers (e.g. controller advice) that serialise it themselves. */
    public static Map<String, Object> envelope(String code, String message, String requestId,
            Map<String, ?> details) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code);
        error.put("message", message);
        error.put("request_id", requestId);
        if (details != null && !details.isEmpty()) {
            error.put("details", details);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        return body;
    }

    public static void write(HttpServletRequest request, HttpServletResponse response, int status, String code,
            String message, Map<String, ?> details) throws IOException {
        String requestId = RequestIds.resolve(request);
        byte[] body = MAPPER.writeValueAsBytes(envelope(code, message, requestId, details));
        response.setStatus(status);
        response.setHeader(RequestIds.HEADER, requestId);
        response.setHeader("Cache-Control", "no-store");
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentLength(body.length);
        response.getOutputStream().write(body);
        response.flushBuffer();
    }
}
