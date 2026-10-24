package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Catch site: ClassAiNarrativeService. A policy refusal is final, never the direct OpenRouter path. */
class ClassAiNarrativePolicyRefusalTest {

    @Test
    void a_usage_limit_refusal_surfaces_its_message_and_never_calls_openrouter() {
        AiServiceLlmClient llm = mock(AiServiceLlmClient.class);
        ClassAiNarrativeService service = new ClassAiNarrativeService(new ObjectMapper(), llm);
        ReflectionTestUtils.setField(service, "modelOverride", "");
        // A real key: if the direct path ran it would try openrouter.ai and fail differently.
        ReflectionTestUtils.setField(service, "openRouterApiKey", "sk-would-be-used-by-the-direct-path");
        when(llm.complete(any(), anyList(), anyBoolean(), any(), any(), any(), any()))
                .thenThrow(new AiServiceLlmClient.PolicyRefusalException(429, "AI_USAGE_LIMIT",
                        "Your institute has reached this month's limit for Class AI report.", Map.of()));

        assertThatThrownBy(() -> service.generate(Map.of("n", 1), "Unit test", "inst-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessage("Your institute has reached this month's limit for Class AI report.");
        verify(llm, times(1)).complete(any(), anyList(), anyBoolean(), any(), any(), any(), any());
    }
}
