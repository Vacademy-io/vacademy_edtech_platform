package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.AiGradingResponseDto;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Grading without a per-assessment model goes through ai_service's 'evaluation' use case. */
class AiClientServiceRoutingTest {

    private static final String GRADE = "{\"marks_awarded\":4,\"feedback\":\"good\"}";

    private AiServiceLlmClient llm;
    private AiClientService service;
    private final AtomicInteger directCalls = new AtomicInteger();
    private WebClient openRouter;

    @BeforeEach
    void setUp() {
        llm = mock(AiServiceLlmClient.class);
        // Real re-shaping so the existing choices[0].message.content parser is exercised.
        AiServiceLlmClient shaper = new AiServiceLlmClient("http://unused", "x", new ObjectMapper());
        when(llm.toChatCompletionBody(any())).thenAnswer(inv -> shaper.toChatCompletionBody(inv.getArgument(0)));
        service = new AiClientService(new ObjectMapper(), llm);
        String openRouterBody = "{\"choices\":[{\"message\":{\"content\":" + new ObjectMapper().valueToTree(GRADE) + "}}]}";
        openRouter = WebClient.builder().exchangeFunction(req -> {
            directCalls.incrementAndGet();
            return Mono.just(ClientResponse.create(HttpStatus.OK)
                    .header("Content-Type", "application/json").body(openRouterBody).build());
        }).build();
    }

    @Test
    void no_preferred_model_uses_the_evaluation_use_case() {
        when(llm.completeAsync(eq("evaluation"), anyList(), eq(true), any(), eq("low"), any(), any()))
                .thenReturn(Mono.just(new AiServiceLlmClient.Completion(GRADE, "z-ai/glm-5.3-flash", Map.of(), null)));

        AiGradingResponseDto dto = service.callAiForGrading("prompt", null, openRouter).block();

        assertThat(dto).isNotNull();
        assertThat(dto.getMarksAwarded()).isEqualTo(4.0);
        assertThat(directCalls.get()).isZero();
    }

    @Test
    void unavailable_registry_falls_back_to_the_direct_call() {
        when(llm.completeAsync(any(), anyList(), eq(true), any(), any(), any(), any()))
                .thenReturn(Mono.error(new AiServiceLlmClient.UnavailableException("404")));

        AiGradingResponseDto dto = service.callAiForGrading("prompt", "", openRouter).block();

        assertThat(dto).isNotNull();
        assertThat(directCalls.get()).isEqualTo(1);
    }

    @Test
    void an_explicit_preferred_model_is_still_honoured() {
        AiGradingResponseDto dto = service.callAiForGrading("prompt", "openai/gpt-5.6-luna", openRouter).block();

        assertThat(dto).isNotNull();
        assertThat(directCalls.get()).isEqualTo(1);
        verify(llm, never()).completeAsync(any(), anyList(), eq(true), any(), any(), any(), any());
    }

    @Test
    void extraction_responses_parse_through_the_existing_extractor() throws Exception {
        when(llm.completeAsync(eq("evaluation"), anyList(), eq(true), any(), any(), any(), any()))
                .thenReturn(Mono.just(new AiServiceLlmClient.Completion("```json\n{\"answers\":[]}\n```", "m", Map.of(), null)));

        String raw = service.callAiForBatchExtraction("prompt", null, openRouter).block();

        assertThat(service.extractContentFromResponse(raw)).isEqualTo("{\"answers\":[]}");
    }
}
