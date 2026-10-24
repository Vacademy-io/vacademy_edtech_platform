package vacademy.io.assessment_service.features.assessment.client;

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
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** AiServiceLlmClient against a real local HTTP server standing in for ai_service. */
class AiServiceLlmClientTest {

    private static final List<Map<String, String>> MESSAGES = List.of(
            Map.of("role", "system", "content", "sys"),
            Map.of("role", "user", "content", "hello"));

    private final ObjectMapper mapper = new ObjectMapper();
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
        return new AiServiceLlmClient("http://127.0.0.1:" + server.getAddress().getPort() + "/", token, mapper);
    }

    @Test
    void sends_use_case_token_and_record_usage_only_and_reads_the_answer() throws Exception {
        responseBody.set("{\"content\":\"{\\\"ok\\\":true}\",\"model\":\"z-ai/glm-5.3-flash\","
                + "\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34}}");

        AiServiceLlmClient.Completion c = client("secret").complete("class_report", MESSAGES, true, 12000, "low",
                "inst-1", Duration.ofSeconds(5));

        assertThat(c.content()).isEqualTo("{\"ok\":true}");
        assertThat(c.model()).isEqualTo("z-ai/glm-5.3-flash");
        assertThat(c.usage()).containsEntry("prompt_tokens", 12).containsEntry("completion_tokens", 34);
        assertThat(seenPath.get()).isEqualTo("/ai-service/internal/llm/v1/complete");
        assertThat(seenToken.get()).isEqualTo("secret");

        JsonNode body = mapper.readTree(seenBody.get());
        assertThat(body.path("use_case").asText()).isEqualTo("class_report");
        assertThat(body.path("record_usage_only").asBoolean()).isTrue();
        assertThat(body.path("response_format").path("type").asText()).isEqualTo("json_object");
        assertThat(body.path("max_tokens").asInt()).isEqualTo(12000);
        assertThat(body.path("reasoning_effort").asText()).isEqualTo("low");
        assertThat(body.path("institute_id").asText()).isEqualTo("inst-1");
        assertThat(body.path("messages")).hasSize(2);
        assertThat(body.has("model")).isFalse();
    }

    @Test
    void optional_fields_are_left_out_when_null() {
        Map<String, Object> body = AiServiceLlmClient.buildBody("evaluation", MESSAGES, false, null, null, null);
        assertThat(body).containsOnlyKeys("use_case", "messages", "record_usage_only");
        assertThat(body.get("record_usage_only")).isEqualTo(true);
    }

    @Test
    void blank_token_is_unavailable_without_calling_ai_service() {
        AiServiceLlmClient c = client("  ");
        assertThat(c.isConfigured()).isFalse();
        assertThatThrownBy(() -> c.complete("evaluation", MESSAGES, true, null, null, null, Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
        assertThat(calls.get()).isZero();
    }

    @Test
    void endpoint_not_deployed_is_unavailable() {
        status.set(404);
        responseBody.set("{\"detail\":\"Not Found\"}");
        assertThatThrownBy(() -> client("secret").complete("evaluation", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }

    @Test
    void refused_token_is_unavailable() {
        status.set(401);
        responseBody.set("{\"detail\":\"Invalid internal service token\"}");
        assertThatThrownBy(() -> client("wrong").complete("evaluation", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }

    @Test
    void ai_service_without_a_token_is_unavailable() {
        status.set(503);
        responseBody.set("{\"detail\":\"Internal service token is not configured on this server\"}");
        assertThatThrownBy(() -> client("secret").complete("evaluation", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }

    @Test
    void server_error_is_a_completion_failure_not_unavailable() {
        status.set(502);
        responseBody.set("{\"detail\":\"all models failed\"}");
        assertThatThrownBy(() -> client("secret").complete("evaluation", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class)
                .hasMessageContaining("502");
    }

    @Test
    void empty_content_is_a_completion_failure() {
        responseBody.set("{\"content\":\"\",\"model\":\"z-ai/glm-5.3-flash\",\"usage\":{}}");
        assertThatThrownBy(() -> client("secret").complete("evaluation", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class)
                .hasMessageContaining("empty");
    }

    @Test
    void truncated_answer_is_a_completion_failure() {
        responseBody.set("{\"content\":\"{\\\"a\\\":\",\"model\":\"m\",\"usage\":{},\"finish_reason\":\"length\"}");
        assertThatThrownBy(() -> client("secret").complete("class_report", MESSAGES, true, null, null, null,
                Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class)
                .hasMessageContaining("truncated");
    }

    @Test
    void unreachable_ai_service_is_unavailable() {
        int port = server.getAddress().getPort();
        server.stop(0);
        AiServiceLlmClient c = new AiServiceLlmClient("http://127.0.0.1:" + port, "secret", mapper);
        assertThatThrownBy(() -> c.complete("evaluation", MESSAGES, true, null, null, null, Duration.ofSeconds(5)))
                .isInstanceOf(AiServiceLlmClient.UnavailableException.class);
    }

    @Test
    void chat_completion_shape_keeps_legacy_parsers_working() throws Exception {
        AiServiceLlmClient c = client("secret");
        String shaped = c.toChatCompletionBody(new AiServiceLlmClient.Completion(
                "{\"marks_awarded\":3}", "z-ai/glm-5.3-flash", Map.of("prompt_tokens", 1), null));
        JsonNode root = mapper.readTree(shaped);
        assertThat(root.path("choices").path(0).path("message").path("content").asText())
                .isEqualTo("{\"marks_awarded\":3}");
        assertThat(root.path("choices").path(0).path("finish_reason").asText()).isEqualTo("stop");
        assertThat(root.path("model").asText()).isEqualTo("z-ai/glm-5.3-flash");
    }
}
