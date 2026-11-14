package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.client.AiServiceLlmClient;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The class AI report asks ai_service's 'class_report' use case, not a pinned model. */
class ClassAiNarrativeServiceRoutingTest {

    private AiServiceLlmClient llm;
    private ClassAiNarrativeService service;

    @BeforeEach
    void setUp() {
        llm = mock(AiServiceLlmClient.class);
        service = new ClassAiNarrativeService(new ObjectMapper(), llm);
        ReflectionTestUtils.setField(service, "modelOverride", "");
        ReflectionTestUtils.setField(service, "openRouterApiKey", "");
    }

    @Test
    void uses_the_class_report_use_case_and_reports_the_model_ai_service_used() {
        when(llm.complete(eq("class_report"), anyList(), eq(true), eq(12000), eq("low"), eq("inst-1"), any()))
                .thenReturn(new AiServiceLlmClient.Completion("```json\n{\"performance_analysis\":\"ok\"}\n```",
                        "z-ai/glm-5.3-flash", Map.of(), null));

        ClassAiNarrativeService.Narrative n = service.generate(Map.of("n", 1), "Unit test", "inst-1");

        assertThat(n.model()).isEqualTo("z-ai/glm-5.3-flash");
        assertThat(n.json()).isEqualTo("{\"performance_analysis\":\"ok\"}");
    }

    @Test
    void unavailable_registry_falls_back_to_the_direct_path() {
        when(llm.complete(any(), anyList(), anyBoolean(), any(), any(), any(), any()))
                .thenThrow(new AiServiceLlmClient.UnavailableException("404"));

        // The direct path needs an OpenRouter key; its absence proves the fallback ran.
        assertThatThrownBy(() -> service.generate(Map.of(), "Unit test", "inst-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not configured");
    }

    @Test
    void a_failed_completion_is_not_retried_on_another_path() {
        when(llm.complete(any(), anyList(), anyBoolean(), any(), any(), any(), any()))
                .thenThrow(new AiServiceLlmClient.CompletionException("ai_service completion was truncated at the token cap"));

        assertThatThrownBy(() -> service.generate(Map.of(), "Unit test", "inst-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("incomplete");
    }

    @Test
    void unparseable_json_fails_before_the_caller_charges() {
        when(llm.complete(any(), anyList(), anyBoolean(), any(), any(), any(), any()))
                .thenReturn(new AiServiceLlmClient.Completion("not json", "m", Map.of(), null));

        assertThatThrownBy(() -> service.generate(Map.of(), "Unit test", "inst-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("could not be read");
    }

    @Test
    void an_explicit_model_override_skips_the_registry() {
        ReflectionTestUtils.setField(service, "modelOverride", "google/gemini-2.5-pro");

        assertThatThrownBy(() -> service.generate(Map.of(), "Unit test", "inst-1"))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("not configured");
        verifyNoInteractions(llm);
    }

    @Test
    void strip_fence_handles_plain_and_fenced_json() {
        assertThat(ClassAiNarrativeService.stripFence("{\"a\":1}")).isEqualTo("{\"a\":1}");
        assertThat(ClassAiNarrativeService.stripFence("```json\n{\"a\":1}\n```")).isEqualTo("{\"a\":1}");
        assertThat(ClassAiNarrativeService.stripFence("```\n{\"a\":1}```")).isEqualTo("{\"a\":1}");
    }
}
