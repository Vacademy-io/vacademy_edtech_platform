package vacademy.io.admin_core_service.features.commerce.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Asks the media service to make the renditions of one stored file. Only the file id and the
 * owners it may have been uploaded for (the institute and the product of the gallery row)
 * travel; the media service reads the file from its own storage, refuses a file that was not
 * uploaded as a product image for one of those owners, and answers with the public URLs.
 */
@Slf4j
@Component
public class CommerceRenditionClient {

    static final String ROUTE = "/media-service/internal/image-renditions";
    private static final int WIDEST = 1600;

    /** Width and height are those of the original as a viewer shows it. */
    public record Result(int width, int height, Map<Integer, String> urls, int pipelineVersion) {
    }

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String clientName;
    private final String mediaServerBaseUrl;

    public CommerceRenditionClient(InternalClientUtils internalClientUtils,
                                   ObjectMapper objectMapper,
                                   @Value("${spring.application.name}") String clientName,
                                   @Value("${media.server.baseurl}") String mediaServerBaseUrl) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.clientName = clientName;
        this.mediaServerBaseUrl = mediaServerBaseUrl;
    }

    public Result generate(String mediaId, List<String> ownerIds) throws CommerceRenditionException {
        String body;
        try {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("file_id", mediaId);
            request.put("owner_ids", ownerIds == null ? List.of() : ownerIds);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.POST.name(),
                    mediaServerBaseUrl, ROUTE, request);
            body = response.getBody();
        } catch (RestClientResponseException e) {
            throw refusal(e);
        } catch (RestClientException e) {
            // Timeout or no connection: the media service may still finish; a later try is cheap.
            throw new CommerceRenditionException("MEDIA_SERVICE_UNREACHABLE", true, e.getMessage());
        } catch (RuntimeException e) {
            throw new CommerceRenditionException("MEDIA_SERVICE_CALL_FAILED", true, e.getMessage());
        }
        return parse(body);
    }

    private CommerceRenditionException refusal(RestClientResponseException e) {
        String code = "MEDIA_SERVICE_" + e.getStatusCode().value();
        // 422 is the media service saying the file itself is the problem.
        boolean retryable = e.getStatusCode().value() != 422;
        String message = e.getStatusText();
        try {
            JsonNode node = objectMapper.readTree(e.getResponseBodyAsString());
            if (node != null && node.hasNonNull("code")) {
                code = node.get("code").asText();
                message = node.path("message").asText(message);
                if (node.has("retryable")) {
                    retryable = node.get("retryable").asBoolean(retryable);
                }
            }
        } catch (Exception parseFailure) {
            log.debug("Rendition refusal without a readable body: {}", parseFailure.getMessage());
        }
        return new CommerceRenditionException(code, retryable, message);
    }

    Result parse(String body) throws CommerceRenditionException {
        try {
            JsonNode node = objectMapper.readTree(body == null ? "" : body);
            int width = node.path("width").asInt(0);
            int height = node.path("height").asInt(0);
            Map<Integer, String> urls = new TreeMap<>();
            for (JsonNode rendition : node.path("renditions")) {
                int renditionWidth = rendition.path("width").asInt(0);
                String url = rendition.path("url").asText("");
                if (renditionWidth < 1 || renditionWidth > WIDEST || renditionWidth > width
                        || !(url.startsWith("https://") || url.startsWith("http://"))) {
                    throw new CommerceRenditionException("BAD_RESPONSE", true, "unexpected rendition in the answer");
                }
                urls.put(renditionWidth, url);
            }
            if (width < 1 || height < 1 || urls.isEmpty()) {
                throw new CommerceRenditionException("BAD_RESPONSE", true, "the answer names no renditions");
            }
            return new Result(width, height, urls, node.path("pipeline_version").asInt(0));
        } catch (CommerceRenditionException e) {
            throw e;
        } catch (Exception e) {
            throw new CommerceRenditionException("BAD_RESPONSE", true, "the answer could not be read");
        }
    }
}
