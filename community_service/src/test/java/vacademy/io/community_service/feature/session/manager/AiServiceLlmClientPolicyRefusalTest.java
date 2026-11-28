package vacademy.io.community_service.feature.session.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.community_service.feature.session.dto.admin.DeepSeekResponse;

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
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * ai_service's policy refusals (usage limit, plan) become a typed, terminal exception in
 * community's client, and LiveSessionSummaryAiService never re-runs refused work on its
 * direct OpenRouter fallback.
 */
class AiServiceLlmClientPolicyRefusalTest {

    static final String LIMIT_BODY = "{\"error\":\"AI_USAGE_LIMIT\",\"use_case\":\"live_session_summary\","
            + "\"scope\":\"INSTITUTE\",\"period\":\"DAY\",\"limit\":50,\"used\":50,\"unit\":\"credits\","
            + "\"resets_at\":\"2026-10-16T00:00:00+05:30\",\"set_by\":\"INSTITUTE\","
            + "\"message\":\"Your institute has reached today's limit for live session summaries.\"}";

    private static final List<Map<String, String>> MESSAGES = List.of(Map.of("role", "user", "content", "hi"));

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

    private AiServiceLlmClient client() {
        return new AiServiceLlmClient("http://127.0.0.1:" + server.getAddress().getPort(), "secret");
    }

    @Test
    void usage_limit_429_is_a_policy_refusal() {
        Throwable t = catchThrowable(() -> client().complete("live_session_summary", MESSAGES, true, null, null, null));

        assertThat(t).isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class)
                .isNotInstanceOf(AiServiceLlmClient.CompletionException.class)
                .isNotInstanceOf(AiServiceLlmClient.UnavailableException.class)
                .hasMessage("Your institute has reached today's limit for live session summaries.");
        AiServiceLlmClient.PolicyRefusalException r = (AiServiceLlmClient.PolicyRefusalException) t;
        assertThat(r.getCode()).isEqualTo("AI_USAGE_LIMIT");
        assertThat(r.getHttpStatus()).isEqualTo(429);
        assertThat(r.getBody()).containsEntry("period", "DAY");
    }

    @Test
    void detail_wrapper_and_plan_402_are_refusals_too() {
        responseBody.set("{\"detail\":" + LIMIT_BODY + "}");
        assertThat(catchThrowable(() -> client().complete("u", MESSAGES, false, null, null, null)))
                .isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class);

        status.set(402);
        responseBody.set("{\"error\":\"PLAN_MODEL_NOT_INCLUDED\",\"message\":\"Not in your plan.\"}");
        assertThat(catchThrowable(() -> client().complete("u", MESSAGES, false, null, null, null)))
                .isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class)
                .hasMessage("Not in your plan.");
    }

    @Test
    void other_429_and_402_stay_completion_failures_as_today() {
        responseBody.set("{\"detail\":\"Rate limit exceeded\"}");
        assertThat(catchThrowable(() -> client().complete("u", MESSAGES, false, null, null, null)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class);
        status.set(402);
        responseBody.set("{\"detail\":\"Insufficient credits\"}");
        assertThat(catchThrowable(() -> client().complete("u", MESSAGES, false, null, null, null)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class);
        status.set(503);
        responseBody.set(LIMIT_BODY);
        assertThat(catchThrowable(() -> client().complete("u", MESSAGES, false, null, null, null)))
                .isInstanceOf(AiServiceLlmClient.CompletionException.class);
        assertThat(AiServiceLlmClient.policyRefusal(429, "nope", new ObjectMapper())).isNull();
    }

    /** Catch site: LiveSessionSummaryAiService, end to end against the fake ai_service. */
    @Test
    void live_session_summary_rethrows_the_refusal_and_never_calls_openrouter() {
        DeepSeekApiService direct = mock(DeepSeekApiService.class);
        when(direct.getChatCompletion(anyString(), anyString(), anyInt())).thenReturn(new DeepSeekResponse());
        LiveSessionSummaryAiService service = new LiveSessionSummaryAiService(client(), direct, "google/gemini-2.5-flash");

        assertThatThrownBy(() -> service.summarize("prompt"))
                .isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class)
                .hasMessageContaining("today's limit");
        verify(direct, never()).getChatCompletion(anyString(), anyString(), anyInt());
        assertThat(calls.get()).as("one ai_service call, no retry").isEqualTo(1);
    }
}
