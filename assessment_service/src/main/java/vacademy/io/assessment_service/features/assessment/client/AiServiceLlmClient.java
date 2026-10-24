package vacademy.io.assessment_service.features.assessment.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Chat completions through ai_service's model registry
 * ({@code POST /ai-service/internal/llm/v1/complete}).
 *
 * <p>assessment_service has no Isoquant key and a different DB from
 * {@code ai_model_defaults}, so it names a USE CASE ({@code class_report},
 * {@code evaluation}) and ai_service picks the model, walks its fallback chain and
 * records token usage. {@code record_usage_only} is always true: ai_service does NOT
 * charge credits for these calls, the caller keeps its own credit charge (no double
 * charge).
 *
 * <p>Two failure kinds, and callers treat them differently:
 * <ul>
 *   <li>{@link UnavailableException}: the call never reached a model — the token is
 *       not configured, ai_service does not have the endpoint yet (404/405, a deploy
 *       before ai_service), the token was refused (401/403), or the connection
 *       failed. Safe to fall back to the legacy direct OpenRouter path.</li>
 *   <li>{@link CompletionException}: the call reached ai_service and failed (5xx, a
 *       timeout, an empty or truncated answer). A model may already have run.</li>
 *   <li>{@link PolicyRefusalException}: ai_service refused the work on purpose (an AI usage
 *       limit, 429 {@code AI_USAGE_LIMIT}; or a plan that does not include the model, 402
 *       {@code PLAN_MODEL_NOT_INCLUDED}). No model ran, and the work must NOT be re-run on
 *       the direct OpenRouter path or retried: that would do refused work unbilled. It is
 *       neither of the two types above, so a {@code catch}/{@code onErrorResume} for them
 *       never swallows it.</li>
 * </ul>
 */
@Service
@Slf4j
public class AiServiceLlmClient {

    public static final String PATH = "/internal/llm/v1/complete";

    private final WebClient webClient;
    private final String internalToken;
    private final ObjectMapper objectMapper;

    @Autowired
    public AiServiceLlmClient(
            @Value("${ai.service.base.url:http://ai-service:8077}") String aiServiceBaseUrl,
            @Value("${internal.service.token:${ai.service.internal.token:}}") String internalToken,
            ObjectMapper objectMapper) {
        this.internalToken = internalToken;
        this.objectMapper = objectMapper;
        // ai_service runs uvicorn (HTTP/1.1 only); the JDK client's default h2c
        // upgrade probe makes its parser drop the body. Same as AiServiceCreditClient.
        HttpClient jdkClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.webClient = WebClient.builder()
                .clientConnector(new JdkClientHttpConnector(jdkClient))
                .baseUrl(aiServiceBaseUrl.replaceAll("/$", "") + "/ai-service")
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024))
                .build();
        if (!isConfigured()) {
            log.warn("[ai-llm] INTERNAL_SERVICE_TOKEN is not set: AI grading and class reports will use the "
                    + "legacy direct OpenRouter path instead of ai_service's model defaults.");
        }
    }

    /** One completion as ai_service returned it. {@code finishReason} is null when not sent. */
    public record Completion(String content, String model, Map<String, Object> usage, String finishReason) {
    }

    /** The call never reached a model; the caller may safely use its legacy path. */
    public static class UnavailableException extends RuntimeException {
        public UnavailableException(String message) {
            super(message);
        }
    }

    /** The call reached ai_service and failed; a model may already have run. */
    public static class CompletionException extends RuntimeException {
        public CompletionException(String message) {
            super(message);
        }

        public CompletionException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * ai_service refused the work by policy (usage limit or plan). Terminal: never fall back
     * to another provider and never retry. {@link #getMessage()} is the user-facing sentence.
     */
    public static class PolicyRefusalException extends RuntimeException {
        private final int httpStatus;
        private final String code;
        private final Map<String, Object> body;

        public PolicyRefusalException(int httpStatus, String code, String message, Map<String, Object> body) {
            super(message);
            this.httpStatus = httpStatus;
            this.code = code;
            this.body = body == null ? Map.of() : body;
        }

        public int getHttpStatus() {
            return httpStatus;
        }

        /** AI_USAGE_LIMIT or PLAN_MODEL_NOT_INCLUDED. */
        public String getCode() {
            return code;
        }

        /** The refusal body as ai_service sent it (use_case, scope, period, limit, used, resets_at ...). */
        public Map<String, Object> getBody() {
            return body;
        }
    }

    public static final String CODE_AI_USAGE_LIMIT = "AI_USAGE_LIMIT";
    public static final String CODE_PLAN_MODEL_NOT_INCLUDED = "PLAN_MODEL_NOT_INCLUDED";
    static final String DEFAULT_REFUSAL_MESSAGE =
            "You've reached the AI usage limit set for this feature. Please try again later.";

    /** True for the policy refusal, so Reactor retry filters can skip it. */
    public static boolean isPolicyRefusal(Throwable t) {
        return t instanceof PolicyRefusalException;
    }

    public boolean isConfigured() {
        return internalToken != null && !internalToken.isBlank();
    }

    /** Blocking {@link #completeAsync}; the timeout is the whole call. */
    public Completion complete(String useCase, List<Map<String, String>> messages, boolean jsonObject,
                               Integer maxTokens, String reasoningEffort, String instituteId, Duration timeout) {
        return completeAsync(useCase, messages, jsonObject, maxTokens, reasoningEffort, instituteId, timeout)
                .block();
    }

    /**
     * @param useCase         the {@code ai_model_defaults} key (e.g. {@code evaluation})
     * @param jsonObject      sends {@code response_format: {type: json_object}}
     * @param maxTokens       null lets ai_service choose
     * @param reasoningEffort null lets ai_service choose
     * @param instituteId     attributes the usage row; may be null
     */
    public Mono<Completion> completeAsync(String useCase, List<Map<String, String>> messages, boolean jsonObject,
                                          Integer maxTokens, String reasoningEffort, String instituteId,
                                          Duration timeout) {
        if (!isConfigured()) {
            return Mono.error(new UnavailableException("INTERNAL_SERVICE_TOKEN is not configured"));
        }
        Map<String, Object> body = buildBody(useCase, messages, jsonObject, maxTokens, reasoningEffort, instituteId);
        return webClient.post()
                .uri(PATH)
                .header("X-Internal-Service-Token", internalToken)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(timeout != null ? timeout : Duration.ofSeconds(120))
                .map(this::parse)
                .onErrorMap(e -> classify(useCase, e));
    }

    /** The request body; package-private for tests. */
    static Map<String, Object> buildBody(String useCase, List<Map<String, String>> messages, boolean jsonObject,
                                         Integer maxTokens, String reasoningEffort, String instituteId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("use_case", useCase);
        body.put("messages", messages);
        if (jsonObject) body.put("response_format", Map.of("type", "json_object"));
        if (maxTokens != null) body.put("max_tokens", maxTokens);
        if (reasoningEffort != null) body.put("reasoning_effort", reasoningEffort);
        if (instituteId != null && !instituteId.isBlank()) body.put("institute_id", instituteId);
        // The caller charges its own credits; ai_service only records token usage.
        body.put("record_usage_only", true);
        return body;
    }

    @SuppressWarnings("unchecked")
    Completion parse(String responseBody) {
        JsonNode root;
        try {
            root = objectMapper.readTree(responseBody);
        } catch (Exception e) {
            throw new CompletionException("ai_service returned an unreadable body", e);
        }
        String content = root.path("content").isTextual() ? root.path("content").asText() : "";
        String finishReason = root.path("finish_reason").isTextual() ? root.path("finish_reason").asText() : null;
        if ("length".equalsIgnoreCase(finishReason)) {
            throw new CompletionException("ai_service completion was truncated at the token cap");
        }
        if (content.isBlank()) {
            throw new CompletionException("ai_service returned an empty completion");
        }
        String model = root.path("model").isTextual() ? root.path("model").asText() : null;
        Map<String, Object> usage = root.path("usage").isObject()
                ? objectMapper.convertValue(root.path("usage"), Map.class)
                : Map.of();
        return new Completion(content, model, usage, finishReason);
    }

    private Throwable classify(String useCase, Throwable e) {
        if (e instanceof UnavailableException || e instanceof CompletionException
                || e instanceof PolicyRefusalException) return e;
        if (e instanceof WebClientResponseException wre) {
            HttpStatus status = HttpStatus.resolve(wre.getStatusCode().value());
            if (status == HttpStatus.NOT_FOUND || status == HttpStatus.METHOD_NOT_ALLOWED) {
                log.warn("[ai-llm] {} not available on ai_service ({}); using the legacy path", PATH, status);
                return new UnavailableException("ai_service has no " + PATH + " (" + status.value() + ")");
            }
            if (status == HttpStatus.UNAUTHORIZED || status == HttpStatus.FORBIDDEN) {
                log.error("[ai-llm] ai_service refused the internal token ({}); check INTERNAL_SERVICE_TOKEN",
                        status.value());
                return new UnavailableException("ai_service refused the internal token (" + status.value() + ")");
            }
            String errorBody = wre.getResponseBodyAsString();
            PolicyRefusalException refusal = policyRefusal(wre.getStatusCode().value(), errorBody, objectMapper);
            if (refusal != null) {
                log.info("[ai-llm] ai_service refused {} by policy ({} {}): {}", useCase,
                        refusal.getHttpStatus(), refusal.getCode(), refusal.getMessage());
                return refusal;
            }
            if (status == HttpStatus.SERVICE_UNAVAILABLE && errorBody != null
                    && errorBody.contains("Internal service token is not configured")) {
                // require_internal_service_token rejects before any model runs.
                log.error("[ai-llm] ai_service has no INTERNAL_SERVICE_TOKEN configured; using the legacy path");
                return new UnavailableException("ai_service has no internal token configured");
            }
            return new CompletionException("ai_service " + useCase + " completion failed: HTTP "
                    + wre.getStatusCode().value() + " " + abbreviate(errorBody), e);
        }
        if (e instanceof WebClientRequestException) {
            // Connection refused / reset before a response: no model ran.
            return new UnavailableException("ai_service unreachable: " + e.getMessage());
        }
        return new CompletionException("ai_service " + useCase + " completion failed: " + e.getMessage(), e);
    }

    /**
     * The policy refusal in an error response, or null. Only 429 + {@code AI_USAGE_LIMIT} and
     * 402 + {@code PLAN_MODEL_NOT_INCLUDED} count; the code is read from the top-level
     * {@code error} or from FastAPI's {@code detail} wrapper. Package-private for tests.
     */
    @SuppressWarnings("unchecked")
    static PolicyRefusalException policyRefusal(int status, String errorBody, ObjectMapper mapper) {
        if ((status != 429 && status != 402) || errorBody == null || errorBody.isBlank()) {
            return null;
        }
        Map<String, Object> root;
        try {
            Object parsed = mapper.readValue(errorBody, Object.class);
            if (!(parsed instanceof Map<?, ?> m)) return null;
            root = (Map<String, Object>) m;
        } catch (Exception e) {
            return null;
        }
        Map<String, Object> refusal = root;
        if (!(root.get("error") instanceof String) && root.get("detail") instanceof Map<?, ?> d) {
            refusal = (Map<String, Object>) d;
        }
        Object code = refusal.get("error");
        boolean limit = status == 429 && CODE_AI_USAGE_LIMIT.equals(code);
        boolean plan = status == 402 && CODE_PLAN_MODEL_NOT_INCLUDED.equals(code);
        if (!limit && !plan) {
            return null;
        }
        Object m = refusal.get("message");
        String message = m instanceof String s && !s.isBlank() ? s.trim() : DEFAULT_REFUSAL_MESSAGE;
        return new PolicyRefusalException(status, (String) code, message, refusal);
    }

    /**
     * The completion in the OpenRouter chat-completions shape, so code written against
     * {@code choices[0].message.content} keeps parsing it unchanged.
     */
    public String toChatCompletionBody(Completion completion) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("role", "assistant");
        message.put("content", completion.content());
        Map<String, Object> choice = new LinkedHashMap<>();
        choice.put("index", 0);
        choice.put("message", message);
        choice.put("finish_reason", completion.finishReason() != null ? completion.finishReason() : "stop");
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("model", completion.model());
        root.put("choices", List.of(choice));
        root.put("usage", completion.usage() != null ? completion.usage() : Map.of());
        try {
            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new CompletionException("Could not re-shape the ai_service completion", e);
        }
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() <= 300 ? s : s.substring(0, 300) + "…";
    }
}
