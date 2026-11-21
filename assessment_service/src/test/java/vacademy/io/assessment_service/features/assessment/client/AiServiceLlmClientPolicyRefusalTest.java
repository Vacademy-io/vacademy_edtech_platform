package vacademy.io.assessment_service.features.assessment.client;

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
import static org.assertj.core.api.Assertions.catchThrowable;

/** ai_service's policy refusals (usage limit, plan) become a typed, terminal exception. */
class AiServiceLlmClientPolicyRefusalTest {

    static final String LIMIT_BODY = "{\"error\":\"AI_USAGE_LIMIT\",\"use_case\":\"class_report\","
            + "\"use_case_label\":\"Class AI report\",\"scope\":\"INSTITUTE\",\"period\":\"MONTH\",\"limit\":500,"
            + "\"used\":500.2,\"unit\":\"credits\",\"resets_at\":\"2026-11-01T00:00:00+05:30\",\"set_by\":\"INSTITUTE\","
            + "\"message\":\"Your institute has reached this month's limit for Class AI report.\"}";

    private static final List<Map<String, String>> MESSAGES = List.of(Map.of("role", "user", "content", "hi"));

    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private final AtomicInteger status = new AtomicInteger(429);
    private final AtomicReference<String> responseBody = new AtomicReference<>(LIMIT_BODY);
    private final AtomicInteger calls = new AtomicInteger();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
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

    private Throwable call() {
        AiServiceLlmClient client = new AiServiceLlmClient(
                "http://127.0.0.1:" + server.getAddress().getPort(), "secret", mapper);
        return catchThrowable(() -> client.complete("class_report", MESSAGES, true, null, null, "inst-1",
                Duration.ofSeconds(5)));
    }

    @Test
    void usage_limit_429_is_a_policy_refusal_carrying_the_message_and_body() {
        Throwable t = call();

        assertThat(t).isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class)
                .isNotInstanceOf(AiServiceLlmClient.CompletionException.class)
                .isNotInstanceOf(AiServiceLlmClient.UnavailableException.class)
                .hasMessage("Your institute has reached this month's limit for Class AI report.");
        AiServiceLlmClient.PolicyRefusalException r = (AiServiceLlmClient.PolicyRefusalException) t;
        assertThat(r.getHttpStatus()).isEqualTo(429);
        assertThat(r.getCode()).isEqualTo("AI_USAGE_LIMIT");
        assertThat(r.getBody()).containsEntry("scope", "INSTITUTE").containsEntry("period", "MONTH");
        assertThat(AiServiceLlmClient.isPolicyRefusal(t)).isTrue();
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void a_fastapi_detail_wrapper_is_read_too() {
        responseBody.set("{\"detail\":" + LIMIT_BODY + "}");
        assertThat(call()).isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class);
    }

    @Test
    void plan_402_is_a_policy_refusal() {
        status.set(402);
        responseBody.set("{\"error\":\"PLAN_MODEL_NOT_INCLUDED\",\"message\":\"Your plan does not include this model.\"}");
        Throwable t = call();
        assertThat(t).isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class)
                .hasMessage("Your plan does not include this model.");
    }

    @Test
    void any_other_429_or_402_stays_a_completion_failure_as_today() {
        status.set(429);
        responseBody.set("{\"detail\":\"Rate limit exceeded\"}");
        assertThat(call()).isInstanceOf(AiServiceLlmClient.CompletionException.class);

        status.set(402);
        responseBody.set("{\"detail\":\"Insufficient credits\"}");
        assertThat(call()).isInstanceOf(AiServiceLlmClient.CompletionException.class);

        status.set(429);
        responseBody.set("not json");
        assertThat(call()).isInstanceOf(AiServiceLlmClient.CompletionException.class);

        // the code only counts with its own status
        status.set(500);
        responseBody.set(LIMIT_BODY);
        assertThat(call()).isInstanceOf(AiServiceLlmClient.CompletionException.class);
    }

    @Test
    void a_refusal_without_a_message_gets_a_generic_one() {
        responseBody.set("{\"error\":\"AI_USAGE_LIMIT\"}");
        assertThat(call()).hasMessage(AiServiceLlmClient.DEFAULT_REFUSAL_MESSAGE);
    }

    @Test
    void parser_ignores_bodies_that_are_not_objects() {
        assertThat(AiServiceLlmClient.policyRefusal(429, "[1,2]", mapper)).isNull();
        assertThat(AiServiceLlmClient.policyRefusal(429, "", mapper)).isNull();
        assertThat(AiServiceLlmClient.policyRefusal(429, null, mapper)).isNull();
        assertThatThrownBy(() -> { throw AiServiceLlmClient.policyRefusal(429, LIMIT_BODY, mapper); })
                .isInstanceOf(RuntimeException.class);
    }
}
