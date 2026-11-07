package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.GenerateCriteriaRequest;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Catch sites: AiClientService (grading / extraction / batch extraction) and
 * AiCriteriaGenerationService. A policy refusal from ai_service is never retried and never
 * sent to the direct OpenRouter path or the legacy model chain.
 */
class EvaluationAiPolicyRefusalTest {

    private static AiServiceLlmClient.PolicyRefusalException refusal() {
        return new AiServiceLlmClient.PolicyRefusalException(429, "AI_USAGE_LIMIT",
                "You've reached today's limit for AI evaluation.", Map.of());
    }

    private AiServiceLlmClient llm;
    private final AtomicInteger directCalls = new AtomicInteger();
    private WebClient openRouter;
    private HttpServer legacyAiService;
    private final AtomicInteger legacyCalls = new AtomicInteger();
    /** How many times the registry Mono was subscribed (each retry re-subscribes). */
    private final AtomicInteger registryAttempts = new AtomicInteger();

    @BeforeEach
    void setUp() throws IOException {
        llm = mock(AiServiceLlmClient.class);
        when(llm.completeAsync(eq("evaluation"), anyList(), eq(true), any(), any(), any(), any()))
                .thenAnswer(inv -> Mono.defer(() -> {
                    registryAttempts.incrementAndGet();
                    return Mono.error(refusal());
                }));
        openRouter = WebClient.builder().exchangeFunction(req -> {
            directCalls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .header("Content-Type", "application/json")
                    .body("{\"choices\":[{\"message\":{\"content\":\"{}\"}}]}").build());
        }).build();

        // Stands in for ai_service's /models/v2/use-case/... that the legacy chain reads first.
        legacyAiService = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        legacyAiService.createContext("/", exchange -> {
            legacyCalls.incrementAndGet();
            byte[] out = "{\"recommended_models\":[{\"model_id\":\"x/y\"}]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            }
        });
        legacyAiService.start();
    }

    @AfterEach
    void stop() {
        legacyAiService.stop(0);
    }

    @Test
    void grading_refusal_is_not_retried_and_not_sent_direct() {
        AiClientService service = new AiClientService(new ObjectMapper(), llm);

        assertThat(service.callAiForGrading("prompt", null, openRouter).block()).isNull();

        assertThat(registryAttempts.get()).as("no retry of a refusal").isEqualTo(1);
        assertThat(directCalls.get()).as("no direct OpenRouter fallback").isZero();
    }

    @Test
    void extraction_refusal_propagates_without_retry_or_direct_call() {
        AiClientService service = new AiClientService(new ObjectMapper(), llm);

        assertThatThrownBy(() -> service.callAiForExtraction("prompt", null, openRouter).block())
                .isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class);
        assertThatThrownBy(() -> service.callAiForBatchExtraction("prompt", "", openRouter).block())
                .isInstanceOf(AiServiceLlmClient.PolicyRefusalException.class);

        assertThat(registryAttempts.get()).isEqualTo(2);
        assertThat(directCalls.get()).isZero();
    }

    @Test
    void other_registry_failures_still_retry_as_today() {
        AtomicInteger attempts = new AtomicInteger();
        when(llm.completeAsync(eq("evaluation"), anyList(), eq(true), any(), any(), any(), any()))
                .thenAnswer(inv -> Mono.defer(() -> {
                    attempts.incrementAndGet();
                    return Mono.error(new AiServiceLlmClient.CompletionException("502"));
                }));
        AiClientService service = new AiClientService(new ObjectMapper(), llm);

        assertThatThrownBy(() -> service.callAiForExtraction("prompt", null, openRouter).block());
        assertThat(attempts.get()).as("1 + 2 retries, unchanged").isEqualTo(3);
        assertThat(directCalls.get()).isZero();
    }

    @Test
    void criteria_refusal_surfaces_its_message_and_never_runs_the_legacy_chain() {
        EvaluationCriteriaService criteria = mock(EvaluationCriteriaService.class);
        AiCriteriaGenerationService service = new AiCriteriaGenerationService("sk-legacy",
                "http://127.0.0.1:" + legacyAiService.getAddress().getPort(), new ObjectMapper(), criteria, llm);
        GenerateCriteriaRequest request = GenerateCriteriaRequest.builder()
                .questionId("q-1").questionText("Explain photosynthesis").questionType("LONG_ANSWER")
                .subject("Biology").maxMarks(10.0).build();

        assertThatThrownBy(() -> service.generateCriteria(request, true, "teacher-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessage("You've reached today's limit for AI evaluation.");

        assertThat(registryAttempts.get()).as("no retry of a refusal").isEqualTo(1);
        assertThat(legacyCalls.get()).as("legacy chain never consulted").isZero();
        verifyNoInteractions(criteria);
        verify(llm, times(1)).completeAsync(eq("evaluation"), anyList(), eq(true), any(), any(), any(), any());
    }
}
