package vacademy.io.assessment_service.features.assessment.omr.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ai_service {@code POST /omr/v1/read}: counts the pages of an uploaded scan, or reads
 * the given pages of it with OMRChecker. Same transport as AiServiceCopyCheckClient
 * (HTTP/1.1 for uvicorn, shared internal token).
 */
@Component
@Slf4j
public class AiServiceOmrClient {

    private final WebClient webClient;
    private final String internalToken;

    public AiServiceOmrClient(
            @Value("${ai.service.base.url:http://ai-service:8077}") String aiServiceBaseUrl,
            @Value("${internal.service.token:${ai.service.internal.token:}}") String internalToken) {
        this.internalToken = internalToken;
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.webClient = WebClient.builder()
                .clientConnector(new JdkClientHttpConnector(jdkClient))
                .baseUrl(aiServiceBaseUrl.replaceAll("/$", "") + "/ai-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                // A 25-page read answers with ~25 small page objects; the images go to media.
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }

    /** Every OMR slot on the ai_service pod is taken; the sheets stay queued for the next pass. */
    public static class OmrBusyException extends RuntimeException {
        public OmrBusyException(String message) {
            super(message);
        }
    }

    /** The file itself is unusable (not a PDF/image, too large, could not be downloaded). */
    public static class OmrFileException extends RuntimeException {
        public OmrFileException(String message) {
            super(message);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReadResponse(@JsonProperty("page_count") Integer pageCount,
                               @JsonProperty("pages") List<PageResult> pages) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PageResult(@JsonProperty("page_no") Integer pageNo,
                             @JsonProperty("status") String status,
                             @JsonProperty("error") String error,
                             @JsonProperty("rotated") Boolean rotated,
                             @JsonProperty("values") Map<String, String> values,
                             @JsonProperty("low_confidence") List<String> lowConfidence,
                             @JsonProperty("sheet_file_id") String sheetFileId,
                             @JsonProperty("marked_file_id") String markedFileId,
                             @JsonProperty("name_crop_file_id") String nameCropFileId) {
    }

    public int countPages(String fileUrl, String fileKind) {
        Map<String, Object> body = new HashMap<>();
        body.put("file_url", fileUrl);
        body.put("file_kind", fileKind);
        body.put("pages", List.of());
        ReadResponse r = call(body, Duration.ofSeconds(120));
        if (r.pageCount() == null) throw new IllegalStateException("ai_service returned no page count");
        return r.pageCount();
    }

    public ReadResponse read(String fileUrl, String fileKind, List<Integer> pages, Map<String, Object> template,
                             Map<String, Object> marker, Map<String, Object> layout, String fileNamePrefix) {
        Map<String, Object> body = new HashMap<>();
        body.put("file_url", fileUrl);
        body.put("file_kind", fileKind);
        body.put("pages", pages);
        body.put("template", template);
        body.put("marker", marker);
        body.put("layout", layout);
        body.put("file_name_prefix", fileNamePrefix);
        // ~1-2 s of CPU per page plus three small uploads; 25 pages stay well inside this.
        return call(body, Duration.ofSeconds(300));
    }

    private ReadResponse call(Map<String, Object> body, Duration timeout) {
        try {
            ReadResponse r = webClient.post()
                    .uri("/omr/v1/read")
                    .header("X-Internal-Service-Token", internalToken)
                    .bodyValue(body)
                    .retrieve()
                    .onStatus(s -> s.value() == 429, resp -> Mono.error(new OmrBusyException("ai_service OMR is at capacity (429)")))
                    .onStatus(s -> s.value() == 422, resp -> resp.bodyToMono(String.class)
                            .defaultIfEmpty("the file could not be read")
                            .flatMap(msg -> Mono.error(new OmrFileException(detail(msg)))))
                    .bodyToMono(ReadResponse.class)
                    .timeout(timeout)
                    .block();
            if (r == null) throw new IllegalStateException("ai_service returned nothing for OMR read");
            return r;
        } catch (OmrBusyException | OmrFileException e) {
            throw e;
        } catch (WebClientResponseException e) {
            throw new IllegalStateException("ai_service OMR read failed: " + e.getStatusCode().value());
        }
    }

    /** FastAPI error body {"detail": "..."} -> the message. */
    private static String detail(String body) {
        int i = body.indexOf("\"detail\"");
        if (i < 0) return body.length() > 300 ? body.substring(0, 300) : body;
        int start = body.indexOf('"', body.indexOf(':', i) + 1);
        int end = start < 0 ? -1 : body.indexOf('"', start + 1);
        return start >= 0 && end > start ? body.substring(start + 1, end) : body;
    }
}
