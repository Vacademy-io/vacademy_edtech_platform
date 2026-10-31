package vacademy.io.admin_core_service.features.ai_models.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LlmGatewayRouterTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The exact jsonb text prod holds today: the map stored as a JSON string. */
    private static final String PROD_SETTING = "\"{\\\"z-ai/glm-5.3-flash\\\": \\\"isoquant\\\"}\"";

    private static JdbcTemplate settingsReturning(String raw) {
        return new JdbcTemplate() {
            @Override
            @SuppressWarnings("unchecked")
            public <T> List<T> queryForList(String sql, Class<T> elementType, Object... args) {
                return raw == null ? List.of() : (List<T>) List.of(raw);
            }
        };
    }

    @Test
    void parsesTheProdStringFormWithLowEffort() {
        Map<String, LlmGatewayRouter.Route> routes = LlmGatewayRouter.parseRoutes(PROD_SETTING, MAPPER);
        assertEquals(new LlmGatewayRouter.Route("isoquant", "glm-5.3-flash", "low"), routes.get("z-ai/glm-5.3-flash"));
    }

    @Test
    void parsesObjectEntriesAndSkipsBadOnes() {
        String raw = "{\"z-ai/glm-5.3-flash\": {\"router\": \"isoquant\", \"reasoning_effort\": \"high\"},"
                + " \"qwen/qwen3.6-27b\": {\"router\": \"isoquant\", \"reasoning_effort\": false, \"model\": \"qwen3.6-27b-x\"},"
                + " \"a/b\": \"somewhere-else\", \"c/d\": {\"router\": \"isoquant\", \"reasoning_effort\": \"medium\"},"
                + " \"e/f\": \"openrouter\"}";
        Map<String, LlmGatewayRouter.Route> routes = LlmGatewayRouter.parseRoutes(raw, MAPPER);
        assertEquals("high", routes.get("z-ai/glm-5.3-flash").reasoningEffort());
        assertEquals("qwen3.6-27b-x", routes.get("qwen/qwen3.6-27b").wireModel());
        assertNull(routes.get("qwen/qwen3.6-27b").reasoningEffort());
        assertFalse(routes.containsKey("a/b"), "unknown gateway stays on OpenRouter");
        assertFalse(routes.containsKey("c/d"), "Isoquant has no 'medium'");
        assertFalse(routes.containsKey("e/f"));
        assertTrue(LlmGatewayRouter.parseRoutes("not json", MAPPER).isEmpty());
        assertTrue(LlmGatewayRouter.parseRoutes("[1]", MAPPER).isEmpty());
    }

    @Test
    void anthropicRoutesAreAcceptedAndUnknownGatewaysStillSkipped() {
        String raw = "{\"anthropic/claude-sonnet-4.5\": {\"router\": \"anthropic\", \"model\": \"claude-sonnet-4-5\"},"
                + " \"anthropic/claude-opus-5.5\": \"Anthropic\","
                + " \"anthropic/claude-haiku-5.5\": {\"router\": \"anthropic\", \"reasoning_effort\": \"medium\"},"
                + " \"x/y\": \"bedrock\", \"z-ai/glm-5.3-flash\": \"isoquant\"}";
        Map<String, LlmGatewayRouter.Route> routes = LlmGatewayRouter.parseRoutes(raw, MAPPER);
        assertEquals(new LlmGatewayRouter.Route("anthropic", "anthropic/claude-sonnet-4.5", null),
                routes.get("anthropic/claude-sonnet-4.5"),
                "the bridge takes the registry id; the Anthropic id is ai_service's business");
        assertEquals(new LlmGatewayRouter.Route("anthropic", "anthropic/claude-opus-5.5", null),
                routes.get("anthropic/claude-opus-5.5"), "plain string form, any case");
        assertNull(routes.get("anthropic/claude-haiku-5.5").reasoningEffort(), "no effort on the bridge leg");
        assertFalse(routes.containsKey("x/y"), "unknown gateway stays on OpenRouter");
        assertEquals(new LlmGatewayRouter.Route("isoquant", "glm-5.3-flash", "low"), routes.get("z-ai/glm-5.3-flash"));
        assertEquals(4, routes.size());
    }

    @Test
    void anthropicRouteNeedsTheBridgeConfigured() {
        String raw = "{\"anthropic/claude-sonnet-4.5\": \"anthropic\"}";
        // Routing-only constructor: no ai_service URL or token.
        LlmGatewayRouter noBridge = new LlmGatewayRouter(settingsReturning(raw), MAPPER, "k", "http://unused");
        assertFalse(noBridge.anthropicBridgeConfigured());
        LlmGatewayRouter.Route r = noBridge.resolve("anthropic/claude-sonnet-4.5");
        assertTrue(r.isOpenRouter());
        assertEquals("anthropic/claude-sonnet-4.5", r.wireModel());
        assertNull(r.reasoningEffort());

        LlmGatewayRouter urlOnly = new LlmGatewayRouter(settingsReturning(raw), MAPPER,
                new AiModelDefaultsResolver(settingsReturning(raw)), "k", "http://unused", "or", "http://unused",
                "http://ai-service:8077", " ");
        assertTrue(urlOnly.resolve("anthropic/claude-sonnet-4.5").isOpenRouter(), "blank token = no bridge");

        LlmGatewayRouter bridged = new LlmGatewayRouter(settingsReturning(raw), MAPPER,
                new AiModelDefaultsResolver(settingsReturning(raw)), "k", "http://unused", "or", "http://unused",
                "http://ai-service:8077", "tok");
        assertTrue(bridged.anthropicBridgeConfigured());
        assertEquals("anthropic", bridged.resolve("anthropic/claude-sonnet-4.5").gateway());
        bridged.coolDown("anthropic", new RuntimeException("boom"));
        assertTrue(bridged.resolve("anthropic/claude-sonnet-4.5").isOpenRouter());
    }

    @Test
    void bareModelIdDropsVendorAndVariant() {
        assertEquals("glm-5.3-flash", LlmGatewayRouter.bareModelId("z-ai/glm-5.3-flash:batch"));
        assertEquals("glm-5.3-flash", LlmGatewayRouter.bareModelId("glm-5.3-flash"));
    }

    @Test
    void resolveFallsBackToOpenRouterWithoutKeyOrDuringCooldown() {
        LlmGatewayRouter noKey = new LlmGatewayRouter(settingsReturning(PROD_SETTING), MAPPER, "", "http://unused");
        LlmGatewayRouter.Route r = noKey.resolve("z-ai/glm-5.3-flash");
        assertTrue(r.isOpenRouter());
        assertEquals("z-ai/glm-5.3-flash", r.wireModel());
        assertEquals("low", r.reasoningEffort(), "a GLM failover must not run at OpenRouter's heavy default");

        LlmGatewayRouter keyed = new LlmGatewayRouter(settingsReturning(PROD_SETTING), MAPPER, "k", "http://unused");
        assertEquals("isoquant", keyed.resolve("z-ai/glm-5.3-flash").gateway());
        LlmGatewayRouter.Route luna = keyed.resolve("openai/gpt-5.6-luna");
        assertTrue(luna.isOpenRouter());
        assertNull(luna.reasoningEffort(), "unrouted models are sent exactly as before");

        keyed.coolDown("isoquant", new RuntimeException("boom"));
        assertTrue(keyed.resolve("z-ai/glm-5.3-flash").isOpenRouter());
    }

    @Test
    void missingSettingRowMeansNoRoutes() {
        LlmGatewayRouter router = new LlmGatewayRouter(settingsReturning(null), MAPPER, "k", "http://unused");
        assertTrue(router.resolve("z-ai/glm-5.3-flash").isOpenRouter());
    }

    @Test
    void openRouterReasoningOnlyWhenTheRouteHasAnEffort() {
        Map<String, Object> payload = Map.of("model", "z-ai/glm-5.3-flash");
        Map<String, Object> withEffort = LlmGatewayRouter.withOpenRouterReasoning(payload,
                new LlmGatewayRouter.Route("openrouter", "z-ai/glm-5.3-flash", "low"));
        assertEquals(Map.of("effort", "low"), withEffort.get("reasoning"));
        assertEquals(payload, LlmGatewayRouter.withOpenRouterReasoning(payload,
                new LlmGatewayRouter.Route("openrouter", "openai/gpt-5.6-luna", null)));
    }

    @Test
    void postSendsTheIsoquantShape() throws Exception {
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> zdr = new AtomicReference<>();
        AtomicReference<String> auth = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            path.set(exchange.getRequestURI().getPath());
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            zdr.set(exchange.getRequestHeaders().getFirst("Isoquant-ZDR"));
            auth.set(exchange.getRequestHeaders().getFirst(HttpHeaders.AUTHORIZATION));
            byte[] out = "{\"choices\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/";
            LlmGatewayRouter router = new LlmGatewayRouter(settingsReturning(PROD_SETTING), MAPPER, "iq-key", base);
            LlmGatewayRouter.Route route = router.resolve("z-ai/glm-5.3-flash");
            Map<String, Object> payload = Map.of(
                    "model", "z-ai/glm-5.3-flash",
                    "messages", List.of(Map.of("role", "user", "content", "hi")),
                    "max_tokens", 12000,
                    "response_format", Map.of("type", "json_object"),
                    "reasoning", Map.of("effort", "high"));

            assertEquals("{\"choices\":[]}", router.post(route, payload, Duration.ofSeconds(5)).block());

            JsonNode sent = MAPPER.readTree(body.get());
            assertEquals("/v1/chat/completions", path.get());
            assertEquals("glm-5.3-flash", sent.get("model").asText());
            assertEquals("low", sent.get("reasoning_effort").asText());
            assertFalse(sent.has("reasoning"), "OpenRouter-only field must not reach Isoquant");
            assertEquals(12000, sent.get("max_tokens").asInt());
            assertEquals("json_object", sent.path("response_format").path("type").asText());
            assertEquals("required", zdr.get());
            assertEquals("Bearer iq-key", auth.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void onlyGatewayFaultsFailOver() {
        assertFalse(LlmGatewayRouter.isGatewayFailure(
                WebClientResponseException.create(HttpStatus.BAD_REQUEST.value(), "", null, null, null)));
        assertTrue(LlmGatewayRouter.isGatewayFailure(
                WebClientResponseException.create(HttpStatus.TOO_MANY_REQUESTS.value(), "", null, null, null)));
        assertTrue(LlmGatewayRouter.isGatewayFailure(
                WebClientResponseException.create(HttpStatus.BAD_GATEWAY.value(), "", null, null, null)));
        assertTrue(LlmGatewayRouter.isGatewayFailure(new TimeoutException()));
        assertFalse(LlmGatewayRouter.isGatewayFailure(new IllegalStateException("parse")));
    }
}
