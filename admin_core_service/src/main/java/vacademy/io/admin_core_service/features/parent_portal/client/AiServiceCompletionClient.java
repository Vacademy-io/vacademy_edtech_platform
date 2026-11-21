package vacademy.io.admin_core_service.features.parent_portal.client;

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
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * Thin client for ai_service's generic completion endpoint
 * ({@code POST /chat/v1/complete}). The LLM API key lives ONLY in ai_service —
 * admin_core never holds it. Returns {@code null} on any failure (unreachable,
 * empty content, error) so callers can fall back gracefully.
 *
 * <p>The endpoint is service-to-service only: every call carries
 * {@code X-Internal-Service-Token} (same secret as the credits / copy-check
 * clients). The model comes from the {@code parent_assistant} use case in
 * ai_model_defaults; ai_service ignores a body {@code model} unless the user is
 * platform staff.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiServiceCompletionClient {

    // ai_service mounts every route under api_base_path ("/ai-service"), matching
    // the other admin_core → ai_service callers (transcription, assessment, credits).
    @Value("${ai.service.url:http://localhost:8077}")
    private String aiServiceUrl;

    private static final String COMPLETE_PATH = "/ai-service/chat/v1/complete";
    private static final String USE_CASE = "parent_assistant";

    // Same resolution as AssignmentCopyCheckClient / CreditClient: INTERNAL_SERVICE_TOKEN
    // (relaxed binding) or the older ai.service.internal-token property.
    @Value("${internal.service.token:${ai.service.internal-token:}}")
    private String internalServiceToken;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    public String complete(String prompt, String model, String instituteId, String userId) {
        try {
            Map<String, Object> body = new HashMap<>();
            body.put("prompt", prompt);
            body.put("use_case", USE_CASE);
            if (model != null) body.put("model", model);
            if (instituteId != null) body.put("institute_id", instituteId);
            if (userId != null) body.put("user_id", userId);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-Internal-Service-Token", internalServiceToken == null ? "" : internalServiceToken);
            HttpEntity<String> entity = new HttpEntity<>(objectMapper.writeValueAsString(body), headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    trimTrailingSlash(aiServiceUrl) + COMPLETE_PATH, HttpMethod.POST, entity, String.class);

            if (response.getBody() == null) return null;
            JsonNode root = objectMapper.readTree(response.getBody());
            String content = root.path("content").asText(null);
            return (content == null || content.isBlank()) ? null : content;
        } catch (Exception e) {
            log.warn("[AiServiceCompletionClient] ai_service completion failed: {}", e.getMessage());
            return null;
        }
    }

    private String trimTrailingSlash(String url) {
        if (url == null) return "";
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}

