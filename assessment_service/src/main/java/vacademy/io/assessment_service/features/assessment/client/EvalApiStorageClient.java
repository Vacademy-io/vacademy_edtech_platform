package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * media_service's private storage for the AI Evaluation partner API (contract C3,
 * {@code /media-service/internal/eval-api/v1}, HMAC internal auth). Objects live under
 * {@code eval-api/{institute_id}/}, which the public CDN cannot serve (gate G12).
 *
 * <ul>
 *   <li>{@link #presignUpload}: a presigned PUT bound to the content type and length,
 *       recorded as {@code file_metadata(source=AI_EVAL_API, source_id=institute)}.</li>
 *   <li>{@link #head}: what storage really holds for a file.</li>
 *   <li>{@link #signedUrl}: a short-lived signed GET (60–3,600 s).</li>
 * </ul>
 * A file media does not know (or that is not an eval-api file) is {@link NotFound}; media
 * refusing a request is {@link Refused}; anything else (unreachable, 401, 5xx) is
 * {@link Unavailable}, so callers can fail closed.
 */
@Slf4j
@Component
public class EvalApiStorageClient {

    static final String BASE_ROUTE = "/media-service/internal/eval-api/v1";
    public static final int MIN_EXPIRY_SECONDS = 60;
    public static final int MAX_EXPIRY_SECONDS = 3600;

    /** A file id as media issues it; anything else never reaches a URL. */
    private static final Pattern FILE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String mediaServiceBaseUrl;
    private final String clientName;

    public EvalApiStorageClient(InternalClientUtils internalClientUtils, ObjectMapper objectMapper,
            @Value("${media.service.baseurl}") String mediaServiceBaseUrl,
            @Value("${spring.application.name:assessment_service}") String clientName) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.mediaServiceBaseUrl = mediaServiceBaseUrl;
        this.clientName = clientName;
    }

    public record PresignedUpload(String fileId, String uploadUrl, String method, Map<String, String> headers,
            String expiresAt) {
    }

    public record FileHead(String fileId, boolean exists, Long sizeBytes, String contentType, String source,
            String sourceId) {
    }

    public record SignedUrl(String url, String expiresAt) {
    }

    /** media does not know the file, or it is not an eval-api file. */
    public static class NotFound extends RuntimeException {
        public NotFound(String message) {
            super(message);
        }
    }

    /** media refused the request (4xx other than 404), with its machine code when it sent one. */
    public static class Refused extends RuntimeException {
        private final int status;
        private final String code;

        public Refused(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }

        public int getStatus() {
            return status;
        }

        public String getCode() {
            return code;
        }
    }

    /** media could not be asked (unreachable, not registered, 5xx). */
    public static class Unavailable extends RuntimeException {
        public Unavailable(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public PresignedUpload presignUpload(String instituteId, String fileName, String contentType, long sizeBytes) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", instituteId);
        body.put("file_name", fileName);
        body.put("content_type", contentType);
        body.put("size_bytes", sizeBytes);
        Map<String, Object> out = call("POST", BASE_ROUTE + "/presign-upload", body);
        @SuppressWarnings("unchecked")
        Map<String, Object> headers = out.get("headers") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Map<String, String> flat = new LinkedHashMap<>();
        headers.forEach((k, v) -> flat.put(k, v == null ? null : String.valueOf(v)));
        return new PresignedUpload(str(out.get("file_id")), str(out.get("upload_url")),
                out.get("method") == null ? "PUT" : str(out.get("method")), flat, str(out.get("expires_at")));
    }

    public FileHead head(String fileId) {
        requireFileId(fileId);
        Map<String, Object> out = call("GET", BASE_ROUTE + "/files/" + fileId + "/head", null);
        return new FileHead(str(out.get("file_id")), Boolean.TRUE.equals(out.get("exists")), lng(out.get("size_bytes")),
                str(out.get("content_type")), str(out.get("source")), str(out.get("source_id")));
    }

    /** A signed GET valid for {@code expirySeconds}, clamped to 60..3600. */
    public SignedUrl signedUrl(String fileId, int expirySeconds) {
        requireFileId(fileId);
        int seconds = Math.max(MIN_EXPIRY_SECONDS, Math.min(MAX_EXPIRY_SECONDS, expirySeconds));
        Map<String, Object> out = call("GET", BASE_ROUTE + "/files/" + fileId + "/signed-url?expirySeconds=" + seconds,
                null);
        String url = str(out.get("url"));
        if (url == null || url.isBlank()) {
            throw new Unavailable("media returned no signed URL", null);
        }
        return new SignedUrl(url, str(out.get("expires_at")));
    }

    private Map<String, Object> call(String method, String route, Object body) {
        ResponseEntity<String> response;
        try {
            response = internalClientUtils.makeHmacRequest(clientName, method, mediaServiceBaseUrl, route, body);
        } catch (HttpStatusCodeException e) {
            int status = e.getStatusCode().value();
            if (status == 404) {
                throw new NotFound("media has no such eval-api file");
            }
            if (status >= 400 && status < 500 && status != 401 && status != 403) {
                Map<String, Object> err = parse(e.getResponseBodyAsString());
                throw new Refused(status, str(err.get("error")), str(err.get("message")));
            }
            log.error("[eval-api] media {} {} failed with {}", method, route.replaceAll("\\?.*$", ""), status);
            throw new Unavailable("media answered " + status, e);
        } catch (RuntimeException e) {
            log.error("[eval-api] media {} {} unreachable: {}", method, route.replaceAll("\\?.*$", ""), e.getMessage());
            throw new Unavailable("media unreachable", e);
        }
        return parse(response == null ? null : response.getBody());
    }

    private Map<String, Object> parse(String body) {
        if (body == null || body.isBlank()) {
            return Map.of();
        }
        try {
            Map<String, Object> map = objectMapper.readValue(body, new TypeReference<Map<String, Object>>() {
            });
            return map == null ? Map.of() : map;
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static void requireFileId(String fileId) {
        if (fileId == null || !FILE_ID.matcher(fileId).matches()) {
            throw new NotFound("not a media file id");
        }
    }

    private static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Long lng(Object value) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return value == null ? null : Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
