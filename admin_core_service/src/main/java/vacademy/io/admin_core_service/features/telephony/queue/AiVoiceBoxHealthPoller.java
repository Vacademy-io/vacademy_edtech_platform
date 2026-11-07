package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiVoiceBoxRepository;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;

/**
 * Asks each voice box how it is and how many calls it is carrying.
 *
 * <p>Two things come out of this, and only two:
 * <ul>
 *   <li>A box that fails to answer is marked DOWN and stops lending its
 *       {@code max_concurrent} to the fleet — so the queue holds calls rather than
 *       dialling into a dead machine and serving leads a spoken "all lines busy".</li>
 *   <li>Its {@code activeCalls} reading gives the capacity service a second opinion on
 *       occupancy. The box counts calls we did not place (an inbound IVR hand-off to
 *       the bot occupies a line exactly like an outbound campaign call), so where the
 *       reading is fresh the drainer takes the larger of the two numbers.</li>
 * </ul>
 *
 * <p>A box with no reachable {@code base_url} — including the seeded placeholder — is
 * skipped entirely and stays UNKNOWN, which still counts toward capacity. That is
 * deliberate: an unconfigured poller must not be able to switch AI calling off.
 */
@Component
@RequiredArgsConstructor
public class AiVoiceBoxHealthPoller {

    private static final Logger log = LoggerFactory.getLogger(AiVoiceBoxHealthPoller.class);

    private static final String HEALTH_PATH = "/voice-bot-service/health";

    private final AiVoiceBoxRepository repository;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @Scheduled(fixedDelayString = "${telephony.ai.queue.health-poll-ms:30000}")
    @SchedulerLock(name = "AiVoiceBoxHealthPoll", lockAtMostFor = "PT2M", lockAtLeastFor = "PT5S")
    public void poll() {
        for (AiVoiceBox box : repository.findByEnabledTrue()) {
            if (!box.isPollable()) continue;
            try {
                pollOne(box);
            } catch (Exception e) {
                markDown(box, e.getMessage());
            }
        }
    }

    private void pollOne(AiVoiceBox box) throws Exception {
        String url = box.getBaseUrl().trim().replaceAll("/$", "") + HEALTH_PATH;
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
        HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() < 200 || res.statusCode() >= 300) {
            markDown(box, "HTTP " + res.statusCode());
            return;
        }
        JsonNode body = mapper.readTree(res.body() == null ? "{}" : res.body());
        Integer activeCalls = body.hasNonNull("activeCalls") ? body.get("activeCalls").asInt() : null;

        boolean recovered = AiVoiceBox.HEALTH_DOWN.equals(box.getHealthStatus());
        box.setHealthStatus(AiVoiceBox.HEALTH_HEALTHY);
        box.setActiveCalls(activeCalls);
        box.setLastHealthCheck(Instant.now());
        repository.save(box);
        if (recovered) {
            log.info("ai voice box {} is back — {} slot(s) returned to the fleet",
                    box.getSlug(), box.getMaxConcurrent());
        }
    }

    private void markDown(AiVoiceBox box, String reason) {
        boolean wasUp = !AiVoiceBox.HEALTH_DOWN.equals(box.getHealthStatus());
        box.setHealthStatus(AiVoiceBox.HEALTH_DOWN);
        // The stale reading is cleared rather than kept: an unreachable box's last known
        // occupancy is not evidence of anything, and leaving it would let a dead box go
        // on suppressing dials it can no longer carry.
        box.setActiveCalls(null);
        box.setLastHealthCheck(Instant.now());
        repository.save(box);
        if (wasUp) {
            log.warn("ai voice box {} is not answering ({}) — its {} slot(s) are out of the fleet",
                    box.getSlug(), reason, box.getMaxConcurrent());
        }
    }
}
