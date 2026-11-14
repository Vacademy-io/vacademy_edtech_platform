package vacademy.io.admin_core_service.features.assignment_ai_evaluation.client;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

/**
 * ai_service {@code POST /copy-check/grade} - the grader assessments use - for
 * assignment copies. Same contract and shared internal token as assessment_service's
 * AiServiceCopyCheckClient.
 */
@Component
public class AssignmentCopyCheckClient {

    /** ai_service answered 429: every grading slot on that pod is taken. */
    public static class AiServiceBusyException extends RuntimeException {
        public AiServiceBusyException(String message) {
            super(message);
        }
    }

    private final WebClient webClient;
    private final String internalToken;

    public AssignmentCopyCheckClient(
            @Value("${ai.service.url:http://ai-service:8077}") String aiServiceUrl,
            @Value("${internal.service.token:${ai.service.internal.token:}}") String internalToken) {
        this.internalToken = internalToken;
        // uvicorn speaks HTTP/1.1 only; the JDK client's h2c upgrade probe makes it drop the body.
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.webClient = WebClient.builder()
                .clientConnector(new JdkClientHttpConnector(jdkClient))
                .baseUrl(aiServiceUrl.replaceAll("/$", "") + "/ai-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /** Starts the run and returns ai_service's job id. */
    @SuppressWarnings("unchecked")
    public String submitGrade(Map<String, Object> body) {
        Map<String, Object> response;
        try {
            response = webClient.post()
                    .uri("/copy-check/grade")
                    .header("X-Internal-Service-Token", internalToken)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(Duration.ofSeconds(30))
                    .block();
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 429) {
                throw new AiServiceBusyException("ai_service is at capacity (429)");
            }
            throw e;
        }
        if (response == null || response.get("job_id") == null) {
            throw new IllegalStateException("ai_service returned no job_id");
        }
        return String.valueOf(response.get("job_id"));
    }
}
