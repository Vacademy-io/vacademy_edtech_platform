package vacademy.io.community_service.feature.session.manager;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.community_service.feature.session.dto.admin.DeepSeekResponse;

import java.util.List;
import java.util.Map;

/**
 * The one model call behind a live-session summary email.
 *
 * <p>Asks ai_service's {@code live_session_summary} use case (model chosen in
 * {@code ai_model_defaults}, GLM by default). The old direct OpenRouter call stays as
 * the fallback so a deploy before the INTERNAL_SERVICE_TOKEN secret exists, or before
 * ai_service has the endpoint, still produces summaries. Summaries are not billed, so
 * any ai_service failure may fall back too, except a policy refusal
 * ({@link AiServiceLlmClient.PolicyRefusalException}), which is rethrown as is.
 */
@Service
public class LiveSessionSummaryAiService {

    private static final Logger log = LoggerFactory.getLogger(LiveSessionSummaryAiService.class);
    static final String USE_CASE = "live_session_summary";
    static final int MAX_TOKENS = 10024;

    private final AiServiceLlmClient aiServiceLlmClient;
    private final DeepSeekApiService deepSeekApiService;
    /**
     * The direct-call model. Was the hard-coded google/gemini-2.5-flash-preview-05-20,
     * a preview id OpenRouter has retired; the GA id is the same model family.
     */
    private final String legacyModel;

    public LiveSessionSummaryAiService(
            AiServiceLlmClient aiServiceLlmClient,
            DeepSeekApiService deepSeekApiService,
            @Value("${live-session.summary.legacy-model:google/gemini-2.5-flash}") String legacyModel) {
        this.aiServiceLlmClient = aiServiceLlmClient;
        this.deepSeekApiService = deepSeekApiService;
        this.legacyModel = legacyModel;
    }

    /** @return the model's raw text (expected to hold the summary JSON), or null when nothing came back */
    public String summarize(String prompt) {
        if (aiServiceLlmClient.isConfigured()) {
            try {
                AiServiceLlmClient.Completion completion = aiServiceLlmClient.complete(USE_CASE,
                        List.of(Map.of("role", "user", "content", prompt)), true, MAX_TOKENS, "low", null);
                log.info("[live-session-summary] ai_service answered with model {}", completion.model());
                return completion.content();
            } catch (AiServiceLlmClient.PolicyRefusalException e) {
                // Refused on purpose (usage limit / plan): no model ran, and the direct call
                // must not run it unbilled behind the policy's back. Terminal.
                log.warn("[live-session-summary] ai_service refused the summary by policy ({}): {}",
                        e.getCode(), e.getMessage());
                throw e;
            } catch (AiServiceLlmClient.UnavailableException e) {
                log.warn("[live-session-summary] ai_service model registry unavailable ({}); using {} directly",
                        e.getMessage(), legacyModel);
            } catch (AiServiceLlmClient.CompletionException e) {
                log.error("[live-session-summary] ai_service completion failed ({}); retrying once with {} directly",
                        e.getMessage(), legacyModel);
            }
        } else {
            log.warn("[live-session-summary] INTERNAL_SERVICE_TOKEN is not set on community-service; "
                    + "using the legacy direct OpenRouter call with {}", legacyModel);
        }
        return legacy(prompt);
    }

    private String legacy(String prompt) {
        DeepSeekResponse aiResponse = deepSeekApiService.getChatCompletion(legacyModel, prompt, MAX_TOKENS);
        if (aiResponse == null || aiResponse.getChoices() == null || aiResponse.getChoices().isEmpty()
                || aiResponse.getChoices().get(0).getMessage() == null) {
            return null;
        }
        return aiResponse.getChoices().get(0).getMessage().getContent();
    }
}
