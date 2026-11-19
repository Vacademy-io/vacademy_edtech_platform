package vacademy.io.admin_core_service.features.telephony.ivr;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.providers.vacademy_ai.VacademyAiAnswerUrls;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

/**
 * Pre-synthesizes IVR menu prompts into the voice-bot's natural-voice ({@code /tts})
 * cache when a menu is saved, so a live inbound call always hits a WARM cache. Cold
 * synthesis of a long prompt takes several seconds — longer than Plivo's {@code <Play>}
 * fetch window — which otherwise plays silence on the first call. Fire-and-forget:
 * a warm failure never blocks the save (the call would just synthesize on demand).
 */
@Component
public class IvrPromptWarmer {

    private static final Logger log = LoggerFactory.getLogger(IvrPromptWarmer.class);

    private final VacademyAiAnswerUrls answerUrls;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    public IvrPromptWarmer(VacademyAiAnswerUrls answerUrls) {
        this.answerUrls = answerUrls;
    }

    @Async
    public void warm(List<String> prompts) {
        if (!answerUrls.isConfigured() || prompts == null) return;
        for (String p : prompts) {
            if (p == null || p.isBlank()) continue;
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(answerUrls.ttsWarmUrl(p, "hi-IN")))
                        .timeout(Duration.ofSeconds(40)).GET().build();
                int code = http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode();
                log.info("ivr prompt warmed ({}): {}…", code, p.substring(0, Math.min(40, p.length())));
            } catch (Exception e) {
                log.warn("ivr prompt warm failed for {}…: {}",
                        p.substring(0, Math.min(40, p.length())), e.getMessage());
            }
        }
    }
}
