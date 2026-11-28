package vacademy.io.admin_core_service.features.learner_tracking.cbe;

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
 * ai_service {@code POST /ai-service/copy-check/v1/grade-cbe-sync}: grades one CBE question
 * slide answer synchronously, checking and charging the institute's credits itself
 * (tool key {@code cbe_answer_check}). Same base URL and shared internal token as
 * {@code AssignmentCopyCheckClient}. See docs/CBE_RESPONSE_QUESTION.md section 5.2.
 */
@Component
public class CbeGradingClient {

    static final String PATH = "/copy-check/v1/grade-cbe-sync";
    static final Duration TIMEOUT = Duration.ofSeconds(120);

    /** ai_service answered 402: the institute is out of AI credits. */
    public static class NoCreditsException extends RuntimeException {
        public NoCreditsException(String message) {
            super(message);
        }
    }

    /** Any other failure: an error status, a timeout, an unreadable reply. */
    public static class GradingFailedException extends RuntimeException {
        public GradingFailedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private final WebClient webClient;
    private final String internalToken;

    public CbeGradingClient(
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
                // a graded answer echoes criteria and feedback; the default 256 KB is tight
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }

    /**
     * @param body {@code institute_id, user_id, source_id, question_text, scenario_text,
     *             config, answer, max_marks}
     * @return the evaluation: {@code marks_awarded, max_marks, verdict, feedback,
     *         criteria_breakdown}. A reply wrapped as {@code {"evaluation": {...}}} is unwrapped.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> grade(Map<String, Object> body) {
        Map<String, Object> response;
        try {
            response = webClient.post()
                    .uri(PATH)
                    .header("X-Internal-Service-Token", internalToken)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(TIMEOUT)
                    .block();
        } catch (WebClientResponseException e) {
            if (e.getStatusCode().value() == 402) {
                throw new NoCreditsException("The institute is out of AI credits");
            }
            throw new GradingFailedException("ai_service answered " + e.getStatusCode().value(), e);
        } catch (RuntimeException e) {
            throw new GradingFailedException("ai_service grading failed: " + e.getMessage(), e);
        }
        if (response == null) {
            throw new GradingFailedException("ai_service returned no body", null);
        }
        Object wrapped = response.get("evaluation");
        if (wrapped instanceof Map<?, ?> evaluation) {
            return (Map<String, Object>) evaluation;
        }
        if (!response.containsKey("marks_awarded")) {
            throw new GradingFailedException("ai_service returned no marks", null);
        }
        return response;
    }
}
