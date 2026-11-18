package vacademy.io.admin_core_service.features.engagement.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Starts and polls an AI plan draft on ai_service's service-to-service routes
 * ({@code /engagement/plan/internal/draft/jobs}) for a teacher who answered the weekly
 * planning email from its link, so there is no user JWT to forward. The draft is
 * billed to the institute and attributed to the teacher, as in the teacher's wizard.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class EngagementPlanningDraftClient {

    private static final String JOBS = "/ai-service/engagement/plan/internal/draft/jobs";

    @Value("${ai.service.url:http://localhost:8077}")
    private String aiServiceUrl;

    @Value("${internal.service.token:${ai.service.internal-token:}}")
    private String internalServiceToken;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    /** The job view ({task_id, status, result, error, ...}). Throws {@link DraftRefused} on a 4xx. */
    public JsonNode start(Map<String, Object> brief) {
        return call(HttpMethod.POST, base() + JOBS, brief);
    }

    public JsonNode get(String taskId, String instituteId) {
        String url = base() + JOBS + "/" + URLEncoder.encode(taskId, StandardCharsets.UTF_8)
                + "?institute_id=" + URLEncoder.encode(instituteId, StandardCharsets.UTF_8);
        return call(HttpMethod.GET, url, null);
    }

    private JsonNode call(HttpMethod method, String url, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Internal-Service-Token", internalServiceToken == null ? "" : internalServiceToken);
        try {
            HttpEntity<String> entity = new HttpEntity<>(
                    body == null ? null : objectMapper.writeValueAsString(body), headers);
            ResponseEntity<String> response = restTemplate.exchange(url, method, entity, String.class);
            return objectMapper.readTree(response.getBody() == null ? "{}" : response.getBody());
        } catch (HttpStatusCodeException e) {
            String detail = e.getStatusText();
            try {
                JsonNode err = objectMapper.readTree(e.getResponseBodyAsString());
                if (err.hasNonNull("detail")) detail = err.get("detail").asText();
            } catch (Exception ignored) {
                // keep the status text
            }
            if (e.getStatusCode().is4xxClientError()) {
                throw new DraftRefused(e.getStatusCode().value(), detail);
            }
            throw new IllegalStateException("ai_service " + e.getStatusCode().value() + ": " + detail);
        } catch (DraftRefused e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("ai_service unreachable: " + e.getMessage(), e);
        }
    }

    private String base() {
        String u = aiServiceUrl == null ? "" : aiServiceUrl.strip();
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }

    /** ai_service refused the brief (no credits = 402, bad brief = 400/422). Retrying will not help. */
    public static class DraftRefused extends RuntimeException {
        private final int status;

        public DraftRefused(int status, String detail) {
            super(detail);
            this.status = status;
        }

        public int status() {
            return status;
        }
    }
}
