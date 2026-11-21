package vacademy.io.admin_core_service.features.ai_models.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.ai_models.ModelDefaults;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;

/**
 * Per-model LLM gateway routing for admin_core - the Java side of ai_service's
 * {@code llm_router.py}, reading the same {@code llm.model_routes} platform setting
 * (for example {@code {"z-ai/glm-5.3-flash": "isoquant"}}).
 *
 * OpenRouter stays the default. A model routed to Isoquant goes there only while
 * the key is configured and the gateway is not cooling down after a failure, so a
 * missing key or an Isoquant outage degrades to OpenRouter instead of failing.
 *
 * A model routed to "anthropic" goes to ai_service's internal bridge
 * ({@value #ANTHROPIC_BRIDGE_PATH}), which holds the Anthropic key pool and does its own
 * OpenRouter failover. admin_core never holds an Anthropic key, nor the ai_service-only
 * LLM_KEY_ENCRYPTION_KEY that decrypts the stored ones. Without an ai_service URL
 * and internal token the route is skipped (OpenRouter, as before); a bridge failure gets
 * the same one OpenRouter try and cooldown as an Isoquant failure.
 *
 * Callers keep their OpenRouter payload and registry model id; {@link #post} turns
 * the payload into the gateway's shape. Usage must still be recorded and charged
 * under the registry id - that is what ai_models prices.
 *
 * <p>Entry points, most to least managed:
 * <ul>
 *   <li>{@link #chat(String, Map, Duration, String)} - walks a use case's model chain
 *       (ai_model_defaults) and returns the body plus the registry id that answered;</li>
 *   <li>{@link #callModel} - one registry model, Isoquant first with one OpenRouter try
 *       on a gateway failure; for callers that run their own per-model retry loop;</li>
 *   <li>{@link #postBlocking} / {@link #post} - one leg, no failover.</li>
 * </ul>
 * GLM models always reason and the reasoning counts against max_tokens, so the managed
 * paths add headroom ({@link #withReasoningHeadroom}) and send effort "low" on both legs
 * unless the caller asks for another effort.
 */
@Slf4j
@Component
public class LlmGatewayRouter {

    public static final String OPENROUTER = "openrouter";
    public static final String ISOQUANT = "isoquant";
    public static final String ANTHROPIC = "anthropic";

    /** ai_service's OpenAI-shaped bridge to the Anthropic key pool (X-Internal-Service-Token). */
    static final String ANTHROPIC_BRIDGE_PATH = "/ai-service/internal/llm/v1/chat/completions";

    static final String ROUTES_SETTING_KEY = "llm.model_routes";

    private static final Duration ROUTES_TTL = Duration.ofSeconds(30);
    private static final Duration GATEWAY_COOLDOWN = Duration.ofSeconds(120);

    /**
     * Isoquant's GLM accepts only these, and DEFAULTS TO max when nothing is sent -
     * so a request that says nothing must still say "low".
     */
    private static final List<String> ISOQUANT_EFFORTS = List.of("low", "high", "max");
    private static final String ISOQUANT_DEFAULT_EFFORT = "low";

    /** Statuses where the same request may succeed on OpenRouter. 400 is the request's own fault. */
    private static final Set<Integer> FAILOVER_STATUSES = Set.of(401, 402, 403, 404, 408, 429);

    /** OpenRouter-only request fields a direct gateway would reject or ignore. */
    private static final Set<String> OPENROUTER_ONLY_KEYS =
            Set.of("reasoning", "provider", "transforms", "models", "route", "usage", "plugins");

    /** Reasoning headroom for GLM, same numbers as ai_service's apply_reasoning_mode. */
    static final int REASONING_ON_MIN_TOKENS = 3000;
    static final int REASONING_ALLOWANCE_MIN = 2000;
    static final int REASONING_ALLOWANCE_MAX = 12000;
    /**
     * A GLM request that names no max_tokens is treated as asking for this many visible
     * tokens. Without a cap a provider would use its own (large) default, so this keeps
     * long reports intact while still bounding the call.
     */
    static final int UNSPECIFIED_MAX_TOKENS = 8000;

    private static final String DEFAULT_EFFORT = "low";

    /**
     * @param gateway         OPENROUTER, ISOQUANT or ANTHROPIC
     * @param wireModel       the id the gateway expects (Isoquant uses bare names; the
     *                        Anthropic bridge takes the registry id and maps it itself)
     * @param reasoningEffort effort to send; null sends none
     */
    public record Route(String gateway, String wireModel, String reasoningEffort) {
        public boolean isOpenRouter() {
            return OPENROUTER.equals(gateway);
        }
    }

    /**
     * What a managed call returned.
     *
     * @param body             the raw chat-completions JSON (tool calls, finish_reason, usage)
     * @param modelId          the REGISTRY id that answered - record and charge usage under it
     * @param content          choices[0].message.content, or null
     * @param finishReason     choices[0].finish_reason, or null
     * @param hasToolCalls     true when the message carries tool_calls
     * @param promptTokens     usage.prompt_tokens (0 when absent)
     * @param completionTokens usage.completion_tokens (0 when absent)
     */
    public record LlmResult(String body, String modelId, String content, String finishReason,
                            boolean hasToolCalls, int promptTokens, int completionTokens) {

        /** Something a caller can use: text, or a tool call to run. */
        public boolean isUsable() {
            return hasToolCalls || (content != null && !content.isBlank());
        }

        static LlmResult parse(String body, String modelId, ObjectMapper mapper) {
            try {
                JsonNode root = mapper.readTree(body);
                JsonNode choice = root.path("choices").path(0);
                if (choice.isMissingNode()) {
                    throw new IllegalStateException("no choices in the response from " + modelId
                            + errorSuffix(root));
                }
                JsonNode message = choice.path("message");
                JsonNode contentNode = message.path("content");
                String content = contentNode.isMissingNode() || contentNode.isNull() ? null : contentNode.asText();
                JsonNode toolCalls = message.path("tool_calls");
                boolean hasToolCalls = toolCalls.isArray() && !toolCalls.isEmpty();
                JsonNode finish = choice.path("finish_reason");
                JsonNode usage = root.path("usage");
                return new LlmResult(body, modelId, content,
                        finish.isMissingNode() || finish.isNull() ? null : finish.asText(),
                        hasToolCalls,
                        usage.path("prompt_tokens").asInt(0),
                        usage.path("completion_tokens").asInt(0));
            } catch (IllegalStateException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException("unreadable response from " + modelId + ": " + e.getMessage(), e);
            }
        }

        private static String errorSuffix(JsonNode root) {
            JsonNode error = root.path("error");
            return error.isMissingNode() ? "" : " (" + error.path("message").asText(error.toString()) + ")";
        }
    }

    /** Every model in the chain failed; the cause is the last model's failure. */
    public static class LlmChainException extends RuntimeException {
        public LlmChainException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final AiModelDefaultsResolver modelDefaults;
    private final String isoquantApiKey;
    private final WebClient isoquantClient;
    private final String openRouterApiKey;
    private final WebClient openRouterClient;
    /** Null when ai_service's URL or internal token is not configured: anthropic routes are skipped. */
    private final WebClient anthropicBridgeClient;

    private final Map<String, Long> cooldownUntil = new ConcurrentHashMap<>();
    private volatile Map<String, Route> routes = Collections.emptyMap();
    private volatile long routesLoadedAt = 0L;

    /** Routing only (no OpenRouter key): enough for {@link #resolve} and {@link #post}. */
    public LlmGatewayRouter(JdbcTemplate jdbcTemplate,
                            ObjectMapper objectMapper,
                            String isoquantApiKey,
                            String isoquantBaseUrl) {
        this(jdbcTemplate, objectMapper, new AiModelDefaultsResolver(jdbcTemplate),
                isoquantApiKey, isoquantBaseUrl, "", "https://openrouter.ai/api/v1");
    }

    /** No Anthropic bridge: anthropic routes are skipped. */
    public LlmGatewayRouter(JdbcTemplate jdbcTemplate,
                            ObjectMapper objectMapper,
                            AiModelDefaultsResolver modelDefaults,
                            String isoquantApiKey,
                            String isoquantBaseUrl,
                            String openRouterApiKey,
                            String openRouterBaseUrl) {
        this(jdbcTemplate, objectMapper, modelDefaults, isoquantApiKey, isoquantBaseUrl,
                openRouterApiKey, openRouterBaseUrl, "", "");
    }

    /**
     * @param aiServiceUrl  ai_service base URL (the bridge path is appended); blank = no bridge
     * @param internalToken X-Internal-Service-Token for the bridge, the same secret CreditClient
     *                      sends; blank = no bridge
     */
    @Autowired
    public LlmGatewayRouter(JdbcTemplate jdbcTemplate,
                            ObjectMapper objectMapper,
                            AiModelDefaultsResolver modelDefaults,
                            @Value("${isoquant.api.key:}") String isoquantApiKey,
                            @Value("${isoquant.base.url:https://api.isoquant.ai/v1}") String isoquantBaseUrl,
                            @Value("${openrouter.api.key:}") String openRouterApiKey,
                            @Value("${openrouter.base.url:https://openrouter.ai/api/v1}") String openRouterBaseUrl,
                            @Value("${ai.service.url:}") String aiServiceUrl,
                            @Value("${ai.service.internal-token:${internal.service.token:}}") String internalToken) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.modelDefaults = modelDefaults;
        this.isoquantApiKey = isoquantApiKey == null ? "" : isoquantApiKey.trim();
        this.openRouterApiKey = openRouterApiKey == null ? "" : openRouterApiKey.trim();
        this.openRouterClient = WebClient.builder()
                .baseUrl(openRouterBaseUrl.replaceAll("/+$", ""))
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + this.openRouterApiKey)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader("HTTP-Referer", "https://vacademy.io")
                .defaultHeader("X-Title", "Vacademy")
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
        this.isoquantClient = WebClient.builder()
                .baseUrl(isoquantBaseUrl.replaceAll("/+$", ""))
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + this.isoquantApiKey)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                // Zero data retention: learner content must not be kept by the gateway.
                .defaultHeader("Isoquant-ZDR", "required")
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
        String bridgeBase = aiServiceUrl == null ? "" : aiServiceUrl.trim().replaceAll("/+$", "");
        String token = internalToken == null ? "" : internalToken.trim();
        this.anthropicBridgeClient = bridgeBase.isEmpty() || token.isEmpty() ? null : WebClient.builder()
                .baseUrl(bridgeBase)
                .defaultHeader("X-Internal-Service-Token", token)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }

    /** True when anthropic routes can be served (ai_service URL and internal token are set). */
    public boolean anthropicBridgeConfigured() {
        return anthropicBridgeClient != null;
    }

    /**
     * Where a call for this registry model goes right now. Never null: anything
     * unrouted, unconfigured or cooling down resolves to OpenRouter.
     */
    public Route resolve(String modelId) {
        Route route = currentRoutes().get(modelId);
        if (route == null) {
            return new Route(OPENROUTER, modelId, null);
        }
        if (ISOQUANT.equals(route.gateway()) && isoquantApiKey.isEmpty()) {
            return openRouterFallback(modelId, route);
        }
        if (ANTHROPIC.equals(route.gateway()) && anthropicBridgeClient == null) {
            return openRouterFallback(modelId, route);
        }
        Long until = cooldownUntil.get(route.gateway());
        if (until != null && until > System.currentTimeMillis()) {
            return openRouterFallback(modelId, route);
        }
        return route;
    }

    /**
     * The OpenRouter leg for a routed model. Keeps the route's effort so a GLM
     * failover does not run at OpenRouter's heavy default reasoning.
     */
    public Route openRouterFallback(String modelId, Route route) {
        return new Route(OPENROUTER, modelId, route == null ? null : route.reasoningEffort());
    }

    /**
     * Send an OpenRouter-shaped chat payload to a non-OpenRouter gateway. The model
     * is swapped for the wire id and reasoning becomes the gateway's effort field.
     */
    public Mono<String> post(Route route, Map<String, Object> openRouterPayload, Duration timeout) {
        boolean anthropic = ANTHROPIC.equals(route.gateway());
        if (!ISOQUANT.equals(route.gateway()) && !anthropic) {
            return Mono.error(new IllegalArgumentException("No client for gateway " + route.gateway()));
        }
        if (anthropic && anthropicBridgeClient == null) {
            return Mono.error(new IllegalStateException("ai_service URL or internal token is not configured"));
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        openRouterPayload.forEach((k, v) -> {
            // The Anthropic bridge speaks the OpenRouter "reasoning" shape (its adapter maps it
            // to thinking / effort), so a caller's reasoningEffort reaches Claude on either leg.
            if (!OPENROUTER_ONLY_KEYS.contains(k) || (anthropic && "reasoning".equals(k))) {
                payload.put(k, v);
            }
        });
        payload.put("model", route.wireModel());
        if (route.reasoningEffort() != null) {
            payload.put("reasoning_effort", route.reasoningEffort());
        }
        if (anthropic) {
            return anthropicBridgeClient.post()
                    .uri(ANTHROPIC_BRIDGE_PATH)
                    .bodyValue(payload)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(timeout);
        }
        return isoquantClient.post()
                .uri("/chat/completions")
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(timeout);
    }

    /**
     * OpenRouter's form of the route's effort, for the failover leg. Returns the
     * payload unchanged when the route carries no effort.
     */
    public static Map<String, Object> withOpenRouterReasoning(Map<String, Object> payload, Route route) {
        if (route == null || route.reasoningEffort() == null) {
            return payload;
        }
        Map<String, Object> copy = new LinkedHashMap<>(payload);
        copy.put("reasoning", Map.of("effort", route.reasoningEffort()));
        return copy;
    }

    // ── Managed calls ────────────────────────────────────────────────────────

    /** {@link #chat(List, Map, Duration, String, Duration)} over a use case's chain. */
    public LlmResult chat(String useCase, Map<String, Object> openRouterPayload, Duration attemptTimeout,
                          String reasoningEffort) {
        return chat(modelDefaults.resolve(useCase).models(), openRouterPayload, attemptTimeout, reasoningEffort, null);
    }

    /**
     * Walk the chain until a model answers with something usable. Per model: Isoquant when
     * routed, the same model on OpenRouter when the gateway fails (with a cooldown), then on
     * any other failure - an error status, an unreadable or empty answer - the next model.
     * Blocking: never call it on a Reactor thread.
     *
     * @param chain             registry ids, in order (an explicit pick goes first)
     * @param openRouterPayload OpenRouter-shaped request; its "model" is replaced per attempt
     * @param attemptTimeout    per gateway attempt
     * @param reasoningEffort   null = "low" for GLM and nothing for other models
     * @param totalBudget       optional cap on the whole walk (null = none); a model is not
     *                          started once it is spent
     * @throws LlmChainException when every model failed
     */
    public LlmResult chat(List<String> chain, Map<String, Object> openRouterPayload, Duration attemptTimeout,
                          String reasoningEffort, Duration totalBudget) {
        if (chain == null || chain.isEmpty()) {
            throw new LlmChainException("No models to try", null);
        }
        long deadline = totalBudget == null ? Long.MAX_VALUE : System.currentTimeMillis() + totalBudget.toMillis();
        List<String> tried = new ArrayList<>();
        RuntimeException last = null;
        for (String model : chain) {
            if (model == null || model.isBlank()) {
                continue;
            }
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0) {
                log.warn("[LLM-Gateway] Time budget spent after {}; not trying {}", tried, model);
                break;
            }
            Duration timeout = attemptTimeout.toMillis() <= remaining ? attemptTimeout : Duration.ofMillis(remaining);
            tried.add(model);
            try {
                String body = callModel(model, openRouterPayload, timeout, reasoningEffort).block();
                if (body == null || body.isBlank()) {
                    throw new IllegalStateException("empty body from " + model);
                }
                LlmResult result = LlmResult.parse(body, model, objectMapper);
                if (!result.isUsable()) {
                    throw new IllegalStateException("no content from " + model
                            + " (finish_reason=" + result.finishReason() + ")");
                }
                if (tried.size() > 1) {
                    log.info("[LLM-Gateway] Answered by {} after {} failed", model, tried.subList(0, tried.size() - 1));
                }
                return result;
            } catch (RuntimeException e) {
                last = e;
                log.warn("[LLM-Gateway] {} failed: {}", model, describe(e));
            }
        }
        throw new LlmChainException("All models failed: " + tried + (last == null ? "" : " - last error: " + describe(last)), last);
    }

    /**
     * One registry model: Isoquant when routed (one OpenRouter try on a gateway failure),
     * else OpenRouter. Applies GLM reasoning headroom and effort. Deferred, so a retry
     * re-resolves the route and honours a cooldown. Emits the raw response body.
     */
    public Mono<String> callModel(String modelId, Map<String, Object> openRouterPayload, Duration timeout,
                                  String reasoningEffort) {
        return Mono.defer(() -> {
            boolean glm = ModelDefaults.isGlm(modelId);
            String effort = reasoningEffort != null && !reasoningEffort.isBlank()
                    ? reasoningEffort.trim().toLowerCase()
                    : (glm ? DEFAULT_EFFORT : null);
            Map<String, Object> payload = new LinkedHashMap<>(openRouterPayload);
            payload.put("model", modelId);
            if (glm) {
                payload = withReasoningHeadroom(ensureUserTurn(payload));
            }
            if (effort != null) {
                payload.put("reasoning", Map.of("effort", effort));
            }
            Route route = resolve(modelId);
            if (route.isOpenRouter()) {
                Map<String, Object> body = effort != null ? payload : withOpenRouterReasoning(payload, route);
                return postOpenRouter(body, timeout);
            }
            Route gatewayRoute = route.reasoningEffort() == null
                    ? route
                    : new Route(route.gateway(), route.wireModel(),
                            effort != null ? gatewayEffort(effort) : route.reasoningEffort());
            Map<String, Object> openRouterBody = effort != null ? payload
                    : withOpenRouterReasoning(payload, openRouterFallback(modelId, route));
            return post(gatewayRoute, payload, timeout)
                    .onErrorResume(LlmGatewayRouter::isGatewayFailure, error -> {
                        coolDown(route.gateway(), error);
                        return postOpenRouter(openRouterBody, timeout);
                    });
        });
    }

    /** One leg, blocking, no failover. An OpenRouter route carries its effort as reasoning. */
    public String postBlocking(Route route, Map<String, Object> openRouterPayload, Duration timeout) {
        if (route.isOpenRouter()) {
            Map<String, Object> payload = new LinkedHashMap<>(openRouterPayload);
            payload.put("model", route.wireModel());
            return postOpenRouter(withOpenRouterReasoning(payload, route), timeout).block();
        }
        return post(route, openRouterPayload, timeout).block();
    }

    private Mono<String> postOpenRouter(Map<String, Object> payload, Duration timeout) {
        if (openRouterApiKey.isEmpty()) {
            return Mono.error(new IllegalStateException("OPENROUTER_API_KEY is not configured"));
        }
        return openRouterClient.post()
                .uri("/chat/completions")
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(timeout);
    }

    /**
     * GLM output budget: max(requested, 3000) + min(max(requested, 2000), 12000). The
     * reasoning is billed as completion tokens and counts against max_tokens, so without
     * this a 500-token chatbot reply can come back empty.
     */
    static Map<String, Object> withReasoningHeadroom(Map<String, Object> payload) {
        Map<String, Object> copy = new LinkedHashMap<>(payload);
        Object raw = copy.get("max_tokens");
        int requested = raw instanceof Number n ? n.intValue() : UNSPECIFIED_MAX_TOKENS;
        if (requested <= 0) {
            requested = UNSPECIFIED_MAX_TOKENS;
        }
        int allowance = Math.min(Math.max(requested, REASONING_ALLOWANCE_MIN), REASONING_ALLOWANCE_MAX);
        copy.put("max_tokens", Math.max(requested, REASONING_ON_MIN_TOKENS) + allowance);
        return copy;
    }

    /**
     * GLM providers reject a conversation with no user turn (the agent sometimes speaks
     * first). Same fix as ai_service's ensure_user_turn: append a minimal one, never otherwise.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> ensureUserTurn(Map<String, Object> payload) {
        if (!(payload.get("messages") instanceof List<?> messages) || messages.isEmpty()) {
            return payload;
        }
        for (Object m : messages) {
            if (m instanceof Map<?, ?> msg) {
                Object role = msg.get("role");
                if ("user".equals(role) || "tool".equals(role)) {
                    return payload;
                }
            }
        }
        List<Object> withUser = new ArrayList<>((List<Object>) messages);
        withUser.add(Map.of("role", "user", "content", "Begin."));
        Map<String, Object> copy = new LinkedHashMap<>(payload);
        copy.put("messages", withUser);
        return copy;
    }

    /**
     * Isoquant takes low|high|max only. "medium" goes up to "high" (the prompt assistant
     * measured medium as the quality floor for Hindi rewrites); anything else is "low".
     */
    static String gatewayEffort(String effort) {
        if (effort == null) {
            return DEFAULT_EFFORT;
        }
        String e = effort.trim().toLowerCase();
        if (ISOQUANT_EFFORTS.contains(e)) {
            return e;
        }
        return "medium".equals(e) ? "high" : DEFAULT_EFFORT;
    }

    private static String describe(Throwable e) {
        Throwable t = e;
        if (t.getCause() != null && t.getClass().getName().startsWith("reactor.core.Exceptions")) {
            t = t.getCause();
        }
        if (t instanceof WebClientResponseException w) {
            String body = w.getResponseBodyAsString();
            return w.getStatusCode().value() + " " + (body.length() > 300 ? body.substring(0, 300) : body);
        }
        return t.getClass().getSimpleName() + ": " + t.getMessage();
    }

    /** Stop sending to this gateway for a while; calls resolve to OpenRouter meanwhile. */
    public void coolDown(String gateway, Throwable cause) {
        cooldownUntil.put(gateway, System.currentTimeMillis() + GATEWAY_COOLDOWN.toMillis());
        log.warn("[LLM-Gateway] {} failed ({}); using OpenRouter for {}s",
                gateway, cause.getMessage(), GATEWAY_COOLDOWN.toSeconds());
    }

    /** True when the gateway, not the request, is at fault - worth one try on OpenRouter. */
    public static boolean isGatewayFailure(Throwable error) {
        if (error instanceof WebClientResponseException webError) {
            int status = webError.getStatusCode().value();
            return status >= 500 || FAILOVER_STATUSES.contains(status);
        }
        return error instanceof TimeoutException || error instanceof WebClientRequestException;
    }

    private Map<String, Route> currentRoutes() {
        long now = System.currentTimeMillis();
        if (now - routesLoadedAt < ROUTES_TTL.toMillis()) {
            return routes;
        }
        try {
            List<String> rows = jdbcTemplate.queryForList(
                    "SELECT setting_value::text FROM ai_platform_settings WHERE setting_key = ?",
                    String.class, ROUTES_SETTING_KEY);
            routes = rows.isEmpty() ? Collections.emptyMap() : parseRoutes(rows.get(0), objectMapper);
        } catch (Exception e) {
            // Keep the last good map: a settings read blip must not move traffic.
            log.warn("[LLM-Gateway] Could not read {}: {}", ROUTES_SETTING_KEY, e.getMessage());
        }
        routesLoadedAt = now;
        return routes;
    }

    /**
     * Same grammar as ai_service's parse_routes: {model_id: "gateway"} or
     * {model_id: {"router": "...", "model": "...", "reasoning_effort": "low" | false}}.
     * The jsonb column holds the map either as an object or as a JSON string of it
     * (prod has the string form). Unknown gateways and bad efforts are skipped.
     *
     * An "anthropic" entry's "model" is the Anthropic API id, which only ai_service uses:
     * the bridge takes the registry id, so the Java route's wire model is the registry id
     * and it carries no effort.
     */
    static Map<String, Route> parseRoutes(String raw, ObjectMapper mapper) {
        if (raw == null || raw.isBlank()) {
            return Collections.emptyMap();
        }
        JsonNode root;
        try {
            root = mapper.readTree(raw);
            if (root != null && root.isTextual()) {
                root = mapper.readTree(root.asText());
            }
        } catch (Exception e) {
            log.error("[LLM-Gateway] {} is not valid JSON; every model stays on OpenRouter", ROUTES_SETTING_KEY);
            return Collections.emptyMap();
        }
        if (root == null || !root.isObject()) {
            return Collections.emptyMap();
        }
        Map<String, Route> out = new HashMap<>();
        Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            String modelId = field.getKey().trim();
            JsonNode entry = field.getValue();
            String gateway = entry.isTextual() ? entry.asText() : entry.path("router").asText("");
            gateway = gateway.trim().toLowerCase();
            if (OPENROUTER.equals(gateway)) {
                continue;
            }
            if (ANTHROPIC.equals(gateway)) {
                out.put(modelId, new Route(ANTHROPIC, modelId, null));
                continue;
            }
            if (!ISOQUANT.equals(gateway)) {
                log.warn("[LLM-Gateway] Unknown gateway '{}' for {}; it stays on OpenRouter", gateway, modelId);
                continue;
            }
            String wireModel = entry.path("model").asText("").trim();
            if (wireModel.isEmpty()) {
                wireModel = bareModelId(modelId);
            }
            JsonNode effortNode = entry.path("reasoning_effort");
            String effort;
            if (effortNode.isBoolean() && !effortNode.asBoolean()) {
                effort = null; // model without the parameter
            } else if (effortNode.isTextual()) {
                effort = effortNode.asText().trim().toLowerCase();
                if (!ISOQUANT_EFFORTS.contains(effort)) {
                    log.warn("[LLM-Gateway] Isoquant accepts reasoning_effort {}, not '{}'; {} stays on OpenRouter",
                            ISOQUANT_EFFORTS, effort, modelId);
                    continue;
                }
            } else {
                effort = ISOQUANT_DEFAULT_EFFORT;
            }
            out.put(modelId, new Route(ISOQUANT, wireModel, effort));
        }
        return Collections.unmodifiableMap(out);
    }

    /** "z-ai/glm-5.3-flash:batch" -> "glm-5.3-flash": direct gateways use the bare name. */
    static String bareModelId(String modelId) {
        String id = modelId.contains("/") ? modelId.substring(modelId.indexOf('/') + 1) : modelId;
        int colon = id.indexOf(':');
        return colon >= 0 ? id.substring(0, colon) : id;
    }
}
