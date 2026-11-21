package vacademy.io.admin_core_service.features.ai_models.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.ai_models.ModelDefaults;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The managed paths of LlmGatewayRouter (chat / callModel) against a local fake of every
 * gateway: Isoquant under /iq/v1, OpenRouter under /or/v1, ai_service's Anthropic bridge
 * under /ai-service/.
 */
class LlmGatewayRouterChatTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String GLM = ModelDefaults.GLM_DEFAULT;
    private static final String GEMINI = ModelDefaults.NON_GLM_FALLBACK;
    private static final String ROUTES = "\"{\\\"z-ai/glm-5.3-flash\\\": \\\"isoquant\\\"}\"";
    private static final String SONNET = "anthropic/claude-sonnet-4.5";
    /** Prod's string form, with a Claude model routed to the Anthropic key pool. */
    private static final String ANTHROPIC_ROUTES =
            "\"{\\\"z-ai/glm-5.3-flash\\\": \\\"isoquant\\\", \\\"" + SONNET
                    + "\\\": {\\\"router\\\": \\\"anthropic\\\", \\\"model\\\": \\\"claude-sonnet-4-5\\\"}}\"";

    /** One request the fake saw. */
    record Seen(String gateway, JsonNode body, String auth, String path, String internalToken) {}

    private volatile String routesSetting = ROUTES;

    /** (gateway, request body) -> {status, response body}. */
    private volatile BiFunction<String, JsonNode, Object[]> responder;
    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private String base;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String gateway = path.startsWith("/iq/") ? "isoquant"
                    : path.startsWith("/ai-service/") ? "anthropic" : "openrouter";
            JsonNode body = MAPPER.readTree(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            seen.add(new Seen(gateway, body, exchange.getRequestHeaders().getFirst(HttpHeaders.AUTHORIZATION), path,
                    exchange.getRequestHeaders().getFirst("X-Internal-Service-Token")));
            Object[] reply = responder.apply(gateway, body);
            byte[] out = ((String) reply[1]).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders((Integer) reply[0], out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    /** Routes setting + ai_model_defaults rows, both through the one JdbcTemplate. */
    private JdbcTemplate db(Map<String, String[]> defaults) {
        return new JdbcTemplate() {
            @Override
            @SuppressWarnings("unchecked")
            public <T> List<T> queryForList(String sql, Class<T> elementType, Object... args) {
                return (List<T>) List.of(routesSetting);
            }

            @Override
            public List<Map<String, Object>> queryForList(String sql, Object... args) {
                String[] row = defaults.get((String) args[0]);
                if (row == null) {
                    return List.of();
                }
                Map<String, Object> out = new HashMap<>();
                out.put("default_model_id", row[0]);
                out.put("fallback_model_id", row[1]);
                return List.of(out);
            }
        };
    }

    private LlmGatewayRouter router(Map<String, String[]> defaults, String isoquantKey) {
        JdbcTemplate jdbc = db(defaults);
        return new LlmGatewayRouter(jdbc, MAPPER, new AiModelDefaultsResolver(jdbc),
                isoquantKey, base + "/iq/v1", "or-key", base + "/or/v1");
    }

    /** Anthropic routes on, with the ai_service bridge configured (or not, when token is blank). */
    private LlmGatewayRouter bridgeRouter(String internalToken) {
        routesSetting = ANTHROPIC_ROUTES;
        JdbcTemplate jdbc = db(Map.of());
        return new LlmGatewayRouter(jdbc, MAPPER, new AiModelDefaultsResolver(jdbc),
                "iq-key", base + "/iq/v1", "or-key", base + "/or/v1", base + "/", internalToken);
    }

    private static String completion(String content) {
        return "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
                + (content == null ? "null" : "\"" + content + "\"")
                + "},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":7}}";
    }

    private static Map<String, Object> payload(int maxTokens) {
        Map<String, Object> p = new HashMap<>();
        p.put("model", "ignored/replaced-per-attempt");
        p.put("messages", List.of(Map.of("role", "system", "content", "be brief"),
                Map.of("role", "user", "content", "hi")));
        p.put("max_tokens", maxTokens);
        p.put("usage", Map.of("include", true));
        return p;
    }

    @Test
    void glmOnIsoquantGetsHeadroomLowEffortAndNoOpenRouterKeys() {
        responder = (gw, body) -> new Object[]{200, completion("hello")};
        LlmGatewayRouter router = router(Map.of("chatbot_flow", new String[]{GLM, GEMINI}), "iq-key");

        LlmGatewayRouter.LlmResult result = router.chat("chatbot_flow", payload(500), Duration.ofSeconds(5), null);

        assertEquals(GLM, result.modelId(), "billed under the registry id");
        assertEquals("hello", result.content());
        assertEquals(11, result.promptTokens());
        assertEquals(7, result.completionTokens());
        assertEquals(1, seen.size());
        Seen s = seen.get(0);
        assertEquals("isoquant", s.gateway());
        assertEquals("glm-5.3-flash", s.body().get("model").asText());
        assertEquals("low", s.body().get("reasoning_effort").asText());
        assertEquals(5000, s.body().get("max_tokens").asInt(), "max(500,3000)+min(max(500,2000),12000)");
        assertFalse(s.body().has("reasoning"));
        assertFalse(s.body().has("usage"), "'usage' is OpenRouter-only");
        assertEquals("Bearer iq-key", s.auth());
    }

    @Test
    void gatewayFailureRetriesTheSameModelOnOpenRouterAndCoolsDown() {
        responder = (gw, body) -> "isoquant".equals(gw)
                ? new Object[]{503, "{\"error\":{\"message\":\"overloaded\"}}"}
                : new Object[]{200, completion("from openrouter")};
        LlmGatewayRouter router = router(Map.of(), "iq-key");

        LlmGatewayRouter.LlmResult result = router.chat("admin_agent", payload(16000), Duration.ofSeconds(5), null);

        assertEquals(GLM, result.modelId());
        assertEquals("from openrouter", result.content());
        assertEquals(List.of("isoquant", "openrouter"), seen.stream().map(Seen::gateway).toList());
        JsonNode or = seen.get(1).body();
        assertEquals(GLM, or.get("model").asText(), "same registry model on OpenRouter");
        assertEquals("low", or.path("reasoning").path("effort").asText(), "low on the failover leg too");
        assertEquals(28000, or.get("max_tokens").asInt(), "16000 + 12000");
        assertEquals("Bearer or-key", seen.get(1).auth());
        assertTrue(router.resolve(GLM).isOpenRouter(), "Isoquant cools down after a gateway failure");
    }

    @Test
    void modelErrorMovesToTheNextModelWithItsOwnPayload() {
        responder = (gw, body) -> body.get("model").asText().contains("glm")
                ? new Object[]{400, "{\"error\":{\"message\":\"bad tool schema\"}}"}
                : new Object[]{200, completion("gemini here")};
        LlmGatewayRouter router = router(Map.of("engagement", new String[]{GLM, GEMINI}), "iq-key");

        LlmGatewayRouter.LlmResult result = router.chat("engagement", payload(500), Duration.ofSeconds(5), null);

        assertEquals(GEMINI, result.modelId(), "usage belongs to the model that answered");
        assertEquals(List.of("isoquant", "openrouter"), seen.stream().map(Seen::gateway).toList(),
                "a 400 is the request's fault: no OpenRouter retry of GLM, straight to the next model");
        JsonNode gemini = seen.get(1).body();
        assertEquals(GEMINI, gemini.get("model").asText());
        assertEquals(500, gemini.get("max_tokens").asInt(), "no GLM headroom for other models");
        assertFalse(gemini.has("reasoning"), "no effort unless the caller asks");
        assertFalse(router.resolve(GLM).isOpenRouter(), "a 400 does not cool the gateway down");
    }

    @Test
    void emptyCompletionCountsAsAFailure() {
        responder = (gw, body) -> body.get("model").asText().contains("glm")
                ? new Object[]{200, completion(null)}
                : new Object[]{200, completion("ok")};
        LlmGatewayRouter router = router(Map.of(), "iq-key");
        assertEquals(GEMINI, router.chat("workflow_draft", payload(500), Duration.ofSeconds(5), null).modelId());
    }

    @Test
    void toolCallsWithoutContentAreUsable() {
        String toolReply = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":null,"
                + "\"tool_calls\":[{\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"x\",\"arguments\":\"{}\"}}]},"
                + "\"finish_reason\":\"tool_calls\"}]}";
        responder = (gw, body) -> new Object[]{200, toolReply};
        LlmGatewayRouter.LlmResult result = router(Map.of(), "iq-key")
                .chat("admin_agent", payload(500), Duration.ofSeconds(5), null);
        assertTrue(result.hasToolCalls());
        assertEquals(GLM, result.modelId());
        assertEquals(1, seen.size());
    }

    @Test
    void explicitPickGoesFirstAndCallerEffortIsMappedForIsoquant() {
        responder = (gw, body) -> new Object[]{200, completion("ok")};
        LlmGatewayRouter router = router(Map.of(), "iq-key");
        router.chat(List.of(GLM, GEMINI), payload(32000), Duration.ofSeconds(5), "medium", null);
        JsonNode sent = seen.get(0).body();
        assertEquals("high", sent.get("reasoning_effort").asText(), "Isoquant has no medium");
        assertEquals(44000, sent.get("max_tokens").asInt());
    }

    @Test
    void withoutAnIsoquantKeyGlmGoesToOpenRouterWithLowEffort() {
        responder = (gw, body) -> new Object[]{200, completion("ok")};
        router(Map.of(), "").chat("parent_assistant", payload(500), Duration.ofSeconds(5), null);
        assertEquals("openrouter", seen.get(0).gateway());
        assertEquals("low", seen.get(0).body().path("reasoning").path("effort").asText());
        assertEquals(5000, seen.get(0).body().get("max_tokens").asInt());
    }

    @Test
    void everyModelFailingThrowsWithTheChain() {
        responder = (gw, body) -> new Object[]{400, "{\"error\":{\"message\":\"nope\"}}"};
        LlmGatewayRouter router = router(Map.of(), "iq-key");
        LlmGatewayRouter.LlmChainException e = assertThrows(LlmGatewayRouter.LlmChainException.class,
                () -> router.chat("admin_agent", payload(500), Duration.ofSeconds(5), null));
        assertTrue(e.getMessage().contains(GLM) && e.getMessage().contains(GEMINI), e.getMessage());
    }

    @Test
    void spentBudgetStopsTheWalk() {
        responder = (gw, body) -> new Object[]{400, "{}"};
        LlmGatewayRouter router = router(Map.of(), "iq-key");
        assertThrows(LlmGatewayRouter.LlmChainException.class,
                () -> router.chat(List.of(GLM, GEMINI), payload(500), Duration.ofSeconds(5), null, Duration.ZERO));
        assertTrue(seen.isEmpty());
    }

    @Test
    void headroomAndUserTurnHelpers() {
        assertEquals(16000, LlmGatewayRouter.withReasoningHeadroom(Map.of()).get("max_tokens"),
                "unspecified = 8000 visible + 8000 reasoning");
        assertEquals(5000, LlmGatewayRouter.withReasoningHeadroom(Map.of("max_tokens", 100)).get("max_tokens"));
        assertEquals(24000, LlmGatewayRouter.withReasoningHeadroom(Map.of("max_tokens", 12000)).get("max_tokens"));

        Map<String, Object> systemOnly = Map.of("messages", List.of(Map.of("role", "system", "content", "x")));
        List<?> fixed = (List<?>) LlmGatewayRouter.ensureUserTurn(systemOnly).get("messages");
        assertEquals(2, fixed.size());
        assertEquals("user", ((Map<?, ?>) fixed.get(1)).get("role"));
        Map<String, Object> withUser = payload(1);
        assertTrue(withUser == LlmGatewayRouter.ensureUserTurn(withUser));

        assertEquals("low", LlmGatewayRouter.gatewayEffort("low"));
        assertEquals("high", LlmGatewayRouter.gatewayEffort("medium"));
        assertEquals("max", LlmGatewayRouter.gatewayEffort("MAX"));
        assertEquals("low", LlmGatewayRouter.gatewayEffort("minimal"));
    }

    // ── Anthropic bridge ([C6]) ─────────────────────────────────────────────

    private static Map<String, Object> toolPayload() {
        Map<String, Object> p = payload(900);
        p.put("temperature", 0.7);
        p.put("tools", List.of(Map.of("type", "function", "function",
                Map.of("name", "lookup", "description", "find", "parameters", Map.of("type", "object")))));
        p.put("tool_choice", "auto");
        p.put("provider", Map.of("order", List.of("x")));
        return p;
    }

    @Test
    void anthropicRouteGoesToTheBridgeWithTheRegistryIdAndTheInternalToken() {
        responder = (gw, body) -> new Object[]{200, completion("from claude")};
        LlmGatewayRouter router = bridgeRouter("svc-token");

        LlmGatewayRouter.LlmResult result =
                router.chat(List.of(SONNET), toolPayload(), Duration.ofSeconds(5), null, null);

        assertEquals(SONNET, result.modelId(), "usage stays under the registry id");
        assertEquals("from claude", result.content());
        assertEquals(1, seen.size());
        Seen s = seen.get(0);
        assertEquals("anthropic", s.gateway());
        assertEquals(LlmGatewayRouter.ANTHROPIC_BRIDGE_PATH, s.path());
        assertEquals("svc-token", s.internalToken());
        assertEquals(SONNET, s.body().get("model").asText(), "the bridge maps registry id -> Anthropic id itself");
        assertEquals(900, s.body().get("max_tokens").asInt(), "no GLM headroom for Claude");
        assertEquals("lookup", s.body().path("tools").path(0).path("function").path("name").asText());
        assertEquals("auto", s.body().get("tool_choice").asText());
        assertEquals(0.7, s.body().get("temperature").asDouble());
        assertFalse(s.body().has("usage"), "'usage' is OpenRouter-only");
        assertFalse(s.body().has("provider"), "'provider' is OpenRouter-only");
        assertFalse(s.body().has("reasoning"));
        assertFalse(s.body().has("reasoning_effort"));
        assertEquals(null, s.auth(), "no OpenRouter key leaves admin_core on the bridge leg");
    }

    @Test
    void callerReasoningReachesTheBridgeAndTheFailoverLeg() {
        responder = (gw, body) -> "anthropic".equals(gw)
                ? new Object[]{503, "{\"error\":{\"message\":\"busy\"}}"}
                : new Object[]{200, completion("from openrouter")};
        LlmGatewayRouter router = bridgeRouter("svc-token");

        router.callModel(SONNET, payload(900), Duration.ofSeconds(5), "high").block();

        assertEquals(List.of("anthropic", "openrouter"), seen.stream().map(Seen::gateway).toList());
        Seen bridge = seen.get(0);
        assertEquals("high", bridge.body().path("reasoning").path("effort").asText(),
                "the bridge understands the OpenRouter reasoning shape");
        assertFalse(bridge.body().has("reasoning_effort"));
        assertEquals("high", seen.get(1).body().path("reasoning").path("effort").asText(), "same on OpenRouter");
    }

    @Test
    void bridge5xxFallsBackToOpenRouterAndCoolsDown() {
        responder = (gw, body) -> "anthropic".equals(gw)
                ? new Object[]{502, "{\"error\":{\"message\":\"upstream\",\"type\":\"api_error\",\"code\":502}}"}
                : new Object[]{200, completion("from openrouter")};
        LlmGatewayRouter router = bridgeRouter("svc-token");

        LlmGatewayRouter.LlmResult result =
                router.chat(List.of(SONNET), toolPayload(), Duration.ofSeconds(5), null, null);

        assertEquals(SONNET, result.modelId());
        assertEquals("from openrouter", result.content());
        assertEquals(List.of("anthropic", "openrouter"), seen.stream().map(Seen::gateway).toList());
        JsonNode or = seen.get(1).body();
        assertEquals(SONNET, or.get("model").asText(), "same registry model on OpenRouter");
        assertEquals("Bearer or-key", seen.get(1).auth());
        assertEquals("lookup", or.path("tools").path(0).path("function").path("name").asText());
        assertTrue(router.resolve(SONNET).isOpenRouter(), "the bridge cools down after a failure");
        assertFalse(router.resolve(GLM).isOpenRouter(), "an Anthropic cooldown leaves Isoquant alone");
    }

    @Test
    void unreachableBridgeFallsBackToOpenRouter() {
        responder = (gw, body) -> new Object[]{200, completion("ok")};
        routesSetting = ANTHROPIC_ROUTES;
        JdbcTemplate jdbc = db(Map.of());
        // Nothing listens on port 1: a transport error, not an HTTP status.
        LlmGatewayRouter router = new LlmGatewayRouter(jdbc, MAPPER, new AiModelDefaultsResolver(jdbc),
                "iq-key", base + "/iq/v1", "or-key", base + "/or/v1", "http://127.0.0.1:1", "svc-token");

        LlmGatewayRouter.LlmResult result =
                router.chat(List.of(SONNET), payload(500), Duration.ofSeconds(5), null, null);

        assertEquals("ok", result.content());
        assertEquals(List.of("openrouter"), seen.stream().map(Seen::gateway).toList());
    }

    @Test
    void bridge400IsTheRequestsFaultAndMovesToTheNextModel() {
        responder = (gw, body) -> "anthropic".equals(gw)
                ? new Object[]{400, "{\"error\":{\"message\":\"bad\",\"type\":\"invalid_request_error\",\"code\":400}}"}
                : new Object[]{200, completion("gemini here")};
        LlmGatewayRouter router = bridgeRouter("svc-token");

        LlmGatewayRouter.LlmResult result =
                router.chat(List.of(SONNET, GEMINI), payload(500), Duration.ofSeconds(5), null, null);

        assertEquals(GEMINI, result.modelId());
        assertEquals(List.of("anthropic", "openrouter"), seen.stream().map(Seen::gateway).toList());
        assertEquals(GEMINI, seen.get(1).body().get("model").asText(), "no OpenRouter retry of Claude on a 400");
        assertFalse(router.resolve(SONNET).isOpenRouter(), "a 400 does not cool the bridge down");
    }

    @Test
    void withoutTheInternalTokenAnAnthropicRouteStaysOnOpenRouter() {
        responder = (gw, body) -> new Object[]{200, completion("ok")};
        LlmGatewayRouter router = bridgeRouter("");

        assertFalse(router.anthropicBridgeConfigured());
        assertTrue(router.resolve(SONNET).isOpenRouter());
        router.chat(List.of(SONNET), payload(500), Duration.ofSeconds(5), null, null);
        assertEquals(List.of("openrouter"), seen.stream().map(Seen::gateway).toList());
        assertEquals(SONNET, seen.get(0).body().get("model").asText());
    }

    @Test
    void theRouteMapWithoutAnthropicIgnoresAConfiguredBridge() {
        responder = (gw, body) -> new Object[]{200, completion("ok")};
        JdbcTemplate jdbc = db(Map.of());
        LlmGatewayRouter router = new LlmGatewayRouter(jdbc, MAPPER, new AiModelDefaultsResolver(jdbc),
                "iq-key", base + "/iq/v1", "or-key", base + "/or/v1", base + "/", "svc-token");

        router.chat(List.of(SONNET), payload(500), Duration.ofSeconds(5), null, null);
        router.chat(List.of(GLM), payload(500), Duration.ofSeconds(5), null, null);

        assertEquals(List.of("openrouter", "isoquant"), seen.stream().map(Seen::gateway).toList(),
                "today's map: Claude on OpenRouter, GLM on Isoquant");
    }
}
