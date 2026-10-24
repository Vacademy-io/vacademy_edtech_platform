package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiGradingResponseDto;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Service for handling AI API communication via OpenRouter
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiClientService {

        private final ObjectMapper objectMapper;
        private final AiServiceLlmClient aiServiceLlmClient;

        @Value("${openrouter.api.key}")
        private String openRouterApiKey;

        private static final String API_URL = "https://openrouter.ai";
        private static final int RESPONSE_TIMEOUT_SECONDS = 60;
        private static final int MAX_RETRIES_PER_MODEL = 2;
        /** ai_service model-registry use case for grading and answer extraction. */
        static final String USE_CASE = "evaluation";
        /** GLM reasons before answering, so the registry path gets more room than the direct one. */
        private static final int REGISTRY_TIMEOUT_SECONDS = 120;
        /** The pre-registry default; only used when ai_service's registry is unreachable. */
        static final String LEGACY_FREE_MODEL = "mistralai/devstral-2512:free";

        /**
         * Create WebClient for OpenRouter API
         */
        public WebClient createWebClient() {
                return WebClient.builder()
                                .baseUrl(API_URL)
                                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + openRouterApiKey)
                                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                                .defaultHeader("HTTP-Referer", "https://vacademy.io")
                                .defaultHeader("X-Title", "Vacademy Assessment Evaluator")
                                .build();
        }

        /**
         * Call AI for grading with the given prompt and model
         */
        public Mono<AiGradingResponseDto> callAiForGrading(String prompt, String model, WebClient webClient) {
                log.info("Sending AI grading request with prompt length: {}", prompt.length());

                return completion("You are an expert evaluator. Grade the student's answer based strictly on the provided rubric.",
                                prompt, model, webClient, RESPONSE_TIMEOUT_SECONDS, "grading")
                                .doOnNext(response -> log.info("Received AI response, length: {}", response.length()))
                                .map(this::parseGradingResponse)
                                .doOnNext(result -> {
                                        if (result != null) {
                                                log.debug("Successfully parsed AI grading response");
                                        } else {
                                                log.warn("Failed to parse AI grading response");
                                        }
                                })
                                .retryWhen(retrySpec())
                                .doOnError(error -> log.error("AI call failed after retries: {}", error.getMessage()))
                                .onErrorResume(e -> {
                                        log.error("AI call failed: {}", e.getMessage());
                                        return Mono.empty();
                                });
        }

        /**
         * Call AI for answer extraction (used by AiAnswerExtractionService)
         */
        public Mono<String> callAiForExtraction(String prompt, String model, WebClient webClient) {
                return completion("You are an expert at extracting answers from Markdown documents with LaTeX equations. Extract answers accurately without evaluating them.",
                                prompt, model, webClient, RESPONSE_TIMEOUT_SECONDS, "answer extraction")
                                .retryWhen(retrySpec());
        }

        /**
         * Call AI for batch extraction (used by AiAnswerExtractionService)
         */
        public Mono<String> callAiForBatchExtraction(String prompt, String model, WebClient webClient) {
                return completion("You are an expert at extracting answers from Markdown documents. Extract ALL answers accurately in a single response.",
                                prompt, model, webClient, 60, "BATCH answer extraction")
                                .retryWhen(retrySpec());
        }

        /**
         * The per-call retry: two more tries 2 s apart, except for a policy refusal
         * (AI usage limit / plan), which is final - retrying cannot succeed and only
         * repeats a refused call. A refusal is also never sent to the direct OpenRouter
         * path: {@link #completion} falls back only on UnavailableException.
         * Package-private for tests.
         */
        static Retry retrySpec() {
                return Retry.fixedDelay(MAX_RETRIES_PER_MODEL, Duration.ofSeconds(2))
                                .filter(error -> !AiServiceLlmClient.isPolicyRefusal(error));
        }

        /**
         * One chat completion, returned in the OpenRouter chat-completions shape so the
         * parsers below read both paths the same way.
         *
         * <p>An explicit model (the assessment's preferred model) is still honoured and
         * called directly on OpenRouter. Without one, ai_service's {@code evaluation}
         * use case picks the model ({@code record_usage_only}: no credits charged there).
         * Only when ai_service's registry is unreachable — no model ran — does it fall
         * back to the old free model.
         */
        private Mono<String> completion(String systemPrompt, String prompt, String model, WebClient webClient,
                        int directTimeoutSeconds, String purpose) {
                List<Map<String, String>> messages = List.of(
                                Map.of("role", "system", "content", systemPrompt),
                                Map.of("role", "user", "content", prompt));
                if (model != null && !model.isEmpty()) {
                        log.info("Using AI model: {} for {}", model, purpose);
                        return direct(messages, model, webClient, directTimeoutSeconds);
                }
                log.info("Using ai_service use case '{}' for {}", USE_CASE, purpose);
                return Mono.defer(() -> aiServiceLlmClient.completeAsync(USE_CASE, messages, true, null, "low", null,
                                                Duration.ofSeconds(REGISTRY_TIMEOUT_SECONDS)))
                                .doOnNext(c -> log.info("ai_service answered {} with model {}", purpose, c.model()))
                                .map(aiServiceLlmClient::toChatCompletionBody)
                                .onErrorResume(AiServiceLlmClient.UnavailableException.class, e -> {
                                        log.warn("ai_service model registry unavailable for {} ({}); using {} directly",
                                                        purpose, e.getMessage(), LEGACY_FREE_MODEL);
                                        return direct(messages, LEGACY_FREE_MODEL, webClient, directTimeoutSeconds);
                                });
        }

        private Mono<String> direct(List<Map<String, String>> messages, String model, WebClient webClient,
                        int timeoutSeconds) {
                Map<String, Object> payload = Map.of(
                                "model", model,
                                "messages", messages,
                                "response_format", Map.of("type", "json_object"));
                return webClient.post()
                                .uri("/api/v1/chat/completions")
                                .bodyValue(payload)
                                .retrieve()
                                .bodyToMono(String.class)
                                .timeout(Duration.ofSeconds(timeoutSeconds));
        }

        /**
         * Parse AI grading response
         */
        private AiGradingResponseDto parseGradingResponse(String responseBody) {
                try {
                        log.info("Parsing AI response, raw response length: {}", responseBody.length());
                        JsonNode root = objectMapper.readTree(responseBody);
                        JsonNode contentNode = root.path("choices").path(0).path("message").path("content");
                        String contentString = contentNode.asText();

                        log.info("Extracted content from AI response, length: {}", contentString.length());

                        if (contentString.startsWith("```json")) {
                                contentString = contentString.replace("```json", "").replace("```", "").trim();
                                log.debug("Cleaned JSON content from markdown, new length: {}", contentString.length());
                        } else if (contentString.startsWith("```")) {
                                contentString = contentString.replace("```", "").trim();
                                log.debug("Cleaned content from markdown, new length: {}", contentString.length());
                        }

                        AiGradingResponseDto result = objectMapper.readValue(contentString, AiGradingResponseDto.class);

                        log.info("Successfully parsed AI grading response: marks={}, feedback length={}",
                                        result.getMarksAwarded(),
                                        result.getFeedback() != null ? result.getFeedback().length() : 0);
                        return result;
                } catch (Exception e) {
                        log.error("Failed to parse grading response: {}", e.getMessage());
                        log.debug("Raw response that failed to parse: {}", responseBody);
                        return null;
                }
        }

        /**
         * Extract content from AI response (used for extraction responses)
         */
        public String extractContentFromResponse(String response) throws Exception {
                JsonNode root = objectMapper.readTree(response);
                JsonNode content = root.path("choices").get(0).path("message").path("content");
                String contentString = content.asText();

                // Clean markdown if present
                if (contentString.startsWith("```json")) {
                        contentString = contentString.replace("```json", "").replace("```", "").trim();
                } else if (contentString.startsWith("```")) {
                        contentString = contentString.replace("```", "").trim();
                }

                return contentString;
        }
}
