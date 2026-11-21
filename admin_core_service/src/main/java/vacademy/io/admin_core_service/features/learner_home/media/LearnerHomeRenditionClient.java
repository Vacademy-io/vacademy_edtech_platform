package vacademy.io.admin_core_service.features.learner_home.media;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Asks the media service for the WebP renditions of one learner-home image. Only the file id and
 * its owner (the institute) travel; the media service refuses a file that was not uploaded as
 * learner-home media for that institute. Same protocol as the commerce rendition client.
 */
@Component
public class LearnerHomeRenditionClient {

    static final String ROUTE = "/media-service/internal/image-renditions";
    private static final int WIDEST = 1600;

    public record Result(int width, int height, Map<Integer, String> urls) {
    }

    /** Why renditions were not made; publish turns it into a warning. */
    public static class RenditionFailed extends Exception {
        private final String code;

        public RenditionFailed(String code, String message) {
            super(message);
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String clientName;
    private final String mediaServerBaseUrl;

    public LearnerHomeRenditionClient(InternalClientUtils internalClientUtils, ObjectMapper objectMapper,
                                      @Value("${spring.application.name}") String clientName,
                                      @Value("${media.server.baseurl}") String mediaServerBaseUrl) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.clientName = clientName;
        this.mediaServerBaseUrl = mediaServerBaseUrl;
    }

    public Result generate(String fileId, String instituteId) throws RenditionFailed {
        String body;
        try {
            Map<String, Object> request = new LinkedHashMap<>();
            request.put("file_id", fileId);
            request.put("owner_ids", List.of(instituteId));
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.POST.name(),
                    mediaServerBaseUrl, ROUTE, request);
            body = response.getBody();
        } catch (RestClientResponseException e) {
            String code = "MEDIA_SERVICE_" + e.getStatusCode().value();
            try {
                JsonNode node = objectMapper.readTree(e.getResponseBodyAsString());
                if (node != null && node.hasNonNull("code")) code = node.get("code").asText();
            } catch (Exception ignored) {
                // keep the status code
            }
            throw new RenditionFailed(code, e.getStatusText());
        } catch (RuntimeException e) {
            throw new RenditionFailed("MEDIA_SERVICE_UNREACHABLE", e.getMessage());
        }
        return parse(body);
    }

    Result parse(String body) throws RenditionFailed {
        try {
            JsonNode node = objectMapper.readTree(body == null ? "" : body);
            int width = node.path("width").asInt(0);
            int height = node.path("height").asInt(0);
            Map<Integer, String> urls = new TreeMap<>();
            for (JsonNode r : node.path("renditions")) {
                int w = r.path("width").asInt(0);
                String url = r.path("url").asText("");
                if (w < 1 || w > WIDEST || w > width || !(url.startsWith("https://") || url.startsWith("http://"))) {
                    throw new RenditionFailed("BAD_RESPONSE", "unexpected rendition in the answer");
                }
                urls.put(w, url);
            }
            if (width < 1 || height < 1 || urls.isEmpty()) {
                throw new RenditionFailed("BAD_RESPONSE", "the answer names no renditions");
            }
            return new Result(width, height, urls);
        } catch (RenditionFailed e) {
            throw e;
        } catch (Exception e) {
            throw new RenditionFailed("BAD_RESPONSE", "the answer could not be read");
        }
    }
}
