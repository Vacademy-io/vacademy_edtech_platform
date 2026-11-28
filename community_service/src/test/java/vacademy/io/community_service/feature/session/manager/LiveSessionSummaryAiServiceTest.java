package vacademy.io.community_service.feature.session.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.community_service.feature.session.dto.admin.DeepSeekResponse;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LiveSessionSummaryAiServiceTest {

    private AiServiceLlmClient llm;
    private DeepSeekApiService direct;
    private LiveSessionSummaryAiService service;

    @BeforeEach
    void setUp() {
        llm = mock(AiServiceLlmClient.class);
        direct = mock(DeepSeekApiService.class);
        service = new LiveSessionSummaryAiService(llm, direct, "google/gemini-2.5-flash");
        when(direct.getChatCompletion(anyString(), anyString(), anyInt())).thenReturn(openRouter("{\"legacy\":true}"));
    }

    @Test
    void configured_token_uses_the_live_session_summary_use_case() {
        when(llm.isConfigured()).thenReturn(true);
        when(llm.complete(eq("live_session_summary"), anyList(), eq(true), eq(10024), eq("low"), any()))
                .thenReturn(new AiServiceLlmClient.Completion("{\"htmlSummary\":\"x\"}", "z-ai/glm-5.3-flash", Map.of()));

        assertThat(service.summarize("prompt")).isEqualTo("{\"htmlSummary\":\"x\"}");
        verify(direct, never()).getChatCompletion(anyString(), anyString(), anyInt());
    }

    @Test
    void blank_token_keeps_the_old_direct_call() {
        when(llm.isConfigured()).thenReturn(false);

        assertThat(service.summarize("prompt")).isEqualTo("{\"legacy\":true}");
        verify(llm, never()).complete(any(), anyList(), anyBoolean(), any(), any(), any());
        verify(direct).getChatCompletion("google/gemini-2.5-flash", "prompt", 10024);
    }

    @Test
    void unavailable_or_failed_ai_service_falls_back_to_the_direct_call() {
        when(llm.isConfigured()).thenReturn(true);
        when(llm.complete(any(), anyList(), anyBoolean(), any(), any(), any()))
                .thenThrow(new AiServiceLlmClient.UnavailableException("404"))
                .thenThrow(new AiServiceLlmClient.CompletionException("502"));

        assertThat(service.summarize("p1")).isEqualTo("{\"legacy\":true}");
        assertThat(service.summarize("p2")).isEqualTo("{\"legacy\":true}");
    }

    private static DeepSeekResponse openRouter(String content) {
        DeepSeekResponse.Message m = new DeepSeekResponse.Message();
        m.setContent(content);
        DeepSeekResponse.Choice c = new DeepSeekResponse.Choice();
        c.setMessage(m);
        DeepSeekResponse r = new DeepSeekResponse();
        r.setChoices(List.of(c));
        return r;
    }
}
