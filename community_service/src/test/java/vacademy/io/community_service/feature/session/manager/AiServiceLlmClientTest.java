package vacademy.io.community_service.feature.session.manager;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** community's AiServiceLlmClient against a local HTTP server standing in for ai_service. */
class AiServiceLlmClientTest {

    private static final List<Map<String, String>> MESSAGES = List.of(Map.of("role", "user", "content", "hi"));

    private HttpServer server;
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> responseBody = new AtomicReference<>("{}");
    private final AtomicReference<String> seenPath = new AtomicReference<>();
    private final AtomicReference<String> seenToken = new AtomicReference<>();
    private final AtomicReference<String> seenBody = new AtomicReference<>();
    private final AtomicInteger calls = new AtomicInteger();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            seenPath.set(exchange.getRequestURI().getPath());
            seenToken.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Token"));
            seenBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private AiServiceLlmClient client(String token) {
        return new AiServiceLlmClient("http://127.0.0.1:" + server.getAddress().getPort() + "/", token);
    }

    @Test
    void posts_the_use_case_with_the_token_and_reads_the_answer() throws Exception {
        responseBody.set("{\"content\":\"{\\\"htmlSummary\\\":\\\"<p>x</p>\\\"}\",\"model\":\"z-ai/glm-5.3-flash\","
                + "\"usage\":{\"prompt_tokens\":5}}");

        AiServiceLlmClient.Completion c = client("secret").complete("live_session_summary", MESSAGES, true, 10024,
                "low", null);

        assertThat(c.content()).isEqualTo("{\"htmlSummary\":\"<p>x</p>\"}");
        assertThat(c.model()).isEqualTo("z-ai/glm-5.3-flash");
        assertThat(seenPath.get()).isEqualTo("/ai-service/internal/llm/v1/complete");
        assertThat(seenToken.get()).isEqualTo("secret");
        JsonNode body = new ObjectMapper().readTree(seenBody.get());
        assertThat(body.path("use_case").asText()).isEqualTo("live_session_summary");
        assertThat(body.path("record_usage_only").asBoolean()).isTrue();
        assertThat(body.path("max_tokens").asInt()).isEqualTo(10024);
        assertThat(body.path("reasoning_effort").asText()).isEqualTo("low");
        assertThat(body.path("response_format").path("type").asText()).isEqualTo("json_object");
        assertThat(body.has("institute_id")).isFalse();
        assertThat(body.has("model")).isFalse();
    }

    @Test
    void blank_token_is_unavailable_without_a_request() {
        AiServiceLlmClient c = client("");
        assertThat(c.isConfigured()).isFalse();
        assertThatThrownBy(() -> c.complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void missing_endpoint_and_refused_token_are_unavailable() {
        status.set(404);
        assertThatThrownBy(() -> client("s").complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
        status.set(403);
        assertThatThrownBy(() -> client("s").complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }

    @Test
    void server_error_and_empty_content_are_completion_failures() {
        status.set(500);
        responseBody.set("{\"detail\":\"boom\"}");
        assertThatThrownBy(() -> client("s").complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class)
                .hasMessageContaining("500");
        status.set(200);
        responseBody.set("{\"content\":\"  \",\"model\":\"m\"}");
        assertThatThrownBy(() -> client("s").complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class)
                .hasMessageContaining("empty");
    }

    @Test
    void unreachable_ai_service_is_unavailable() {
        int port = server.getAddress().getPort();
        server.stop(0);
        AiServiceLlmClient c = new AiServiceLlmClient("http://127.0.0.1:" + port, "s");
        assertThatThrownBy(() -> c.complete("live_session_summary", MESSAGES, true, null, null, null))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }
}
