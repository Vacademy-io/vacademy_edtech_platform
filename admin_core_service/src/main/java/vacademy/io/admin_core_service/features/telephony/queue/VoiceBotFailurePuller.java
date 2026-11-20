package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiVoiceBoxRepository;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;

/**
 * Copies the failed vendor calls of the voice bot that takes calls onto the platform portal.
 *
 * <p>The voice bot keeps its failed vendor calls (Navana and Sarvam key refusals, a Smallest
 * 401, an LLM 429, a TTS socket error mid-call) in memory and returns them as
 * {@code vendorFailures} on {@code /voice-bot-service/health}. {@link AiVoiceBoxHealthPoller}
 * reads that body, but only for a row of {@code ai_voice_box} whose {@code base_url} was set by
 * hand, and the seeded row says {@code CONFIGURE_ME}. Left like that, every vendor failure of
 * the bot stayed in its memory and the portal never listed one.
 *
 * <p>The bot that takes calls is the one {@code VOICE_BOT_BASE_URL} names (every dial goes
 * there), so this reads that bot's health directly. It does nothing else with the answer: box
 * health and fleet capacity stay with {@link AiVoiceBoxHealthPoller}, so this cannot pause AI
 * calling. When a configured box already polls the same bot, this stands aside.
 *
 * <p>The bot may run as several replicas behind one address, each with its own list, so each
 * poll reads the health more than once. Rows are keyed on each entry's unique id, so reading an
 * entry again never writes it twice.
 */
@Component
public class VoiceBotFailurePuller {

    private static final Logger log = LoggerFactory.getLogger(VoiceBotFailurePuller.class);

    static final String HEALTH_PATH = "/voice-bot-service/health";
    static final String SOURCE = "active-bot";
    /** Reads per poll: enough to reach each replica behind one address within a few polls. */
    static final int READS_PER_POLL = 3;

    private final AiVoiceBoxRepository boxes;
    private final VoiceBotVendorFailureRecorder recorder;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${telephony.vacademy-ai.bot-base-url:}")
    String botBaseUrl;

    /** True while the bot's health cannot be read, so an outage is logged once, not every 30 s. */
    private volatile boolean unreachable;

    public VoiceBotFailurePuller(AiVoiceBoxRepository boxes, VoiceBotVendorFailureRecorder recorder) {
        this(boxes, recorder, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    }

    VoiceBotFailurePuller(AiVoiceBoxRepository boxes, VoiceBotVendorFailureRecorder recorder, HttpClient http) {
        this.boxes = boxes;
        this.recorder = recorder;
        this.http = http;
    }

    @Scheduled(fixedDelayString = "${telephony.ai.voice-bot-failures.poll-ms:30000}", initialDelay = 20_000)
    @SchedulerLock(name = "VoiceBotFailurePull", lockAtMostFor = "PT2M", lockAtLeastFor = "PT5S")
    public void poll() {
        try {
            String url = healthUrl(botBaseUrl);
            if (url == null || polledByABox(url)) return;
            String problem = null;
            int read = 0;
            for (int i = 0; i < READS_PER_POLL; i++) {
                String outcome = readOnce(url);
                if (outcome == null) read++;
                else problem = outcome;
            }
            if (read == 0) {
                if (!unreachable) {
                    log.warn("voice bot failures cannot be read from {} ({}) — failed vendor calls on the bot "
                            + "will not reach the portal until it answers", url, problem);
                }
                unreachable = true;
            } else if (unreachable) {
                unreachable = false;
                log.info("voice bot failures are being read from {} again", url);
            }
        } catch (Exception e) {
            // Never let a poll throw into the scheduler.
            log.debug("voice bot failure poll skipped: {}", e.toString());
        }
    }

    /** One read of the bot's health. Null when it was read and its failures handed on, else why not. */
    String readOnce(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() < 200 || res.statusCode() >= 300) return "HTTP " + res.statusCode();
            JsonNode body = mapper.readTree(res.body() == null || res.body().isBlank() ? "{}" : res.body());
            recorder.record(SOURCE, body.get("vendorFailures"));
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "interrupted";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /** A configured, enabled box that already polls this health (and so records its failures). */
    private boolean polledByABox(String url) {
        for (AiVoiceBox box : boxes.findByEnabledTrue()) {
            if (box.isPollable() && url.equals(healthUrl(box.getBaseUrl()))) return true;
        }
        return false;
    }

    /**
     * The health address of a bot, from either form its base is written in: the bare host
     * ({@code https://host}, as a box row holds it) or with the service path
     * ({@code https://host/voice-bot-service}, as VOICE_BOT_BASE_URL holds it). Null when unset.
     */
    static String healthUrl(String base) {
        if (base == null) return null;
        String b = base.trim().replaceAll("/+$", "");
        if (b.isEmpty() || !b.toLowerCase(Locale.ROOT).startsWith("http")) return null;
        if (b.toLowerCase(Locale.ROOT).endsWith("/voice-bot-service")) {
            b = b.substring(0, b.length() - "/voice-bot-service".length());
        }
        return b + HEALTH_PATH;
    }
}
