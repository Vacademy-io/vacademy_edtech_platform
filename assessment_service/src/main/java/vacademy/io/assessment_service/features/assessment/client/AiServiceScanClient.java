package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanAnalysis;

import java.net.http.HttpClient;
import java.time.Duration;

/**
 * WebClient wrapper for ai_service's scan station routes (contracts C1 and C2):
 * POST /copy-check/scan/analyse-load and POST /copy-check/scan/build. Both are
 * synchronous and can take minutes (ai_service keeps its own 240 s budget), so
 * they run only on the scan station's own pool, never on a request thread.
 *
 * <p>Errors come back typed, so the runner can tell "try again later" from "give up":
 * <ul>
 *   <li>429 (busy), a 503 marked retryable, other 5xx, a timeout or no connection:
 *       {@link ScanRetryableException} ({@link ScanBusyException} for the 429);</li>
 *   <li>404: {@link ScanDisabledException}, the route is switched off on ai_service;</li>
 *   <li>any other 4xx, or a 503 marked not retryable: {@link ScanRejectedException}.</li>
 * </ul>
 */
@Component
@Slf4j
public class AiServiceScanClient {

    private static final String TOKEN_HEADER = "X-Internal-Service-Token";
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(300);

    private final WebClient webClient;
    private final String internalToken;
    private final Duration timeout;
    private final ObjectMapper mapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    @Autowired
    public AiServiceScanClient(
            @Value("${ai.service.base.url:http://ai-service:8077}") String aiServiceBaseUrl,
            @Value("${internal.service.token:${ai.service.internal.token:}}") String internalToken) {
        this(aiServiceBaseUrl, internalToken, DEFAULT_TIMEOUT);
    }

    AiServiceScanClient(String aiServiceBaseUrl, String internalToken, Duration timeout) {
        this.internalToken = internalToken;
        this.timeout = timeout;
        // ai_service runs uvicorn (HTTP/1.1 only); the JDK client's default h2c
        // upgrade probe makes it drop the body. See AiServiceCopyCheckClient.
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.webClient = WebClient.builder()
                .clientConnector(new JdkClientHttpConnector(jdkClient))
                .baseUrl(aiServiceBaseUrl.replaceAll("/$", "") + "/ai-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                // a 300-page load's answer is a few hundred KB of JSON
                .codecs(c -> c.defaultCodecs().maxInMemorySize(16 * 1024 * 1024))
                .build();
    }

    /** The analyse-load answer, parsed, plus the body exactly as it came (stored verbatim). */
    public record Analysed(String json, ScanAnalysis.Result result) {
    }

    /** POST /copy-check/scan/analyse-load (C1). */
    public Analysed analyseLoad(ScanAnalysis.AnalyseRequest request) {
        String body = post("/copy-check/scan/analyse-load", request);
        try {
            return new Analysed(body, mapper.readValue(body, ScanAnalysis.Result.class));
        } catch (Exception e) {
            throw new ScanRejectedException(200, "ai_service answered analyse-load with unreadable JSON");
        }
    }

    /** POST /copy-check/scan/build (C2). A copy that could not be made carries its own error. */
    public ScanAnalysis.BuildResult build(ScanAnalysis.BuildRequest request) {
        String body = post("/copy-check/scan/build", request);
        try {
            return mapper.readValue(body, ScanAnalysis.BuildResult.class);
        } catch (Exception e) {
            throw new ScanRejectedException(200, "ai_service answered build with unreadable JSON");
        }
    }

    private String post(String path, Object request) {
        String json;
        try {
            json = mapper.writeValueAsString(request);
        } catch (Exception e) {
            throw new IllegalArgumentException("scan request could not be written: " + e.getMessage(), e);
        }
        try {
            return webClient.post()
                    .uri(path)
                    .header(TOKEN_HEADER, internalToken)
                    .bodyValue(json)
                    .exchangeToMono(resp -> {
                        int code = resp.statusCode().value();
                        if (resp.statusCode().is2xxSuccessful()) {
                            return resp.bodyToMono(String.class).defaultIfEmpty("");
                        }
                        return resp.bodyToMono(String.class).defaultIfEmpty("")
                                .flatMap(text -> Mono.<String>error(toError(code, text)));
                    })
                    .timeout(timeout)
                    .block();
        } catch (ScanClientException e) {
            throw e;
        } catch (Exception e) {
            // timeout, refused connection, reset: the call may simply be retried later
            throw new ScanRetryableException("ai_service did not answer " + path + ": " + rootMessage(e));
        }
    }

    private ScanClientException toError(int code, String text) {
        if (code == 429) {
            return new ScanBusyException("ai_service is busy (429)");
        }
        if (code == 404) {
            return new ScanDisabledException("the scan station is switched off on ai_service (404)");
        }
        if (code == 503) {
            return retryableFlag(text)
                    ? new ScanRetryableException("ai_service is temporarily unavailable (503)")
                    : new ScanRejectedException(code, "ai_service refused the scan (503): " + snippet(text));
        }
        if (code >= 500) {
            return new ScanRetryableException("ai_service failed (" + code + ")");
        }
        return new ScanRejectedException(code, "ai_service refused the scan (" + code + "): " + snippet(text));
    }

    private boolean retryableFlag(String text) {
        try {
            JsonNode n = mapper.readTree(text);
            JsonNode r = n == null ? null : n.has("retryable") ? n.get("retryable")
                    : n.has("detail") ? n.get("detail").get("retryable") : null;
            return r != null && r.asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    private static String snippet(String text) {
        if (text == null) return "";
        String t = text.replaceAll("\\s+", " ").trim();
        return t.length() > 300 ? t.substring(0, 300) + "..." : t;
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        return m == null || m.isBlank() ? t.getClass().getSimpleName() : m;
    }

    // ---------------------------------------------------------------- errors

    public abstract static class ScanClientException extends RuntimeException {
        protected ScanClientException(String message) {
            super(message);
        }
    }

    /** Worth trying again later: a 5xx, a timeout, no connection. */
    public static class ScanRetryableException extends ScanClientException {
        public ScanRetryableException(String message) {
            super(message);
        }
    }

    /** 429: every scan slot on ai_service is taken. */
    public static class ScanBusyException extends ScanRetryableException {
        public ScanBusyException(String message) {
            super(message);
        }
    }

    /** 404: the route is off on ai_service (env COPY_CHECK_SCAN_STATION). Nothing is wrong with the load. */
    public static class ScanDisabledException extends ScanClientException {
        public ScanDisabledException(String message) {
            super(message);
        }
    }

    /** Any other refusal; trying again will not help. */
    public static class ScanRejectedException extends ScanClientException {
        private final int status;

        public ScanRejectedException(int status, String message) {
            super(message);
            this.status = status;
        }

        public int getStatus() {
            return status;
        }
    }
}
