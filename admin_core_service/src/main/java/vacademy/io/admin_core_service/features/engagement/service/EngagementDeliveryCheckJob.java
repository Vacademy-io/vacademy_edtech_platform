package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A WhatsApp send is "SENT" once Meta's API accepts it, but Meta can refuse delivery later (error
 * 131049: the person already got too many marketing templates). Until now that stayed SENT, so
 * the inbox, the weekly cap and the brain all counted a message the person never received. This
 * asks notification-service which of the engine's recent WhatsApp sends were reported failed and
 * moves them to FAILED with Meta's reason, where an admin sees them and the brain can switch channel.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementDeliveryCheckJob {

    /** A failure report arrives within minutes; a day of lookback also covers an outage. */
    static final Duration LOOKBACK = Duration.ofHours(24);

    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final EngagementInternalClients clients;

    @Scheduled(fixedDelayString = "${engagement.delivery-check.delay-ms:120000}",
            initialDelayString = "${engagement.delivery-check.initial-delay-ms:90000}")
    @SchedulerLock(name = "EngagementDeliveryCheck", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        Instant now = Instant.now();
        Instant since = now.minus(LOOKBACK);
        int failed = 0;
        for (String instituteId : memberRepository.institutesWithLiveEngines()) {
            try {
                Set<String> mine = new HashSet<>(actionRepository.sentWhatsAppSince(instituteId, since));
                if (mine.isEmpty()) continue;
                failed += apply(mine, clients.deliveryFailuresSince(instituteId, since.toEpochMilli()), now);
            } catch (Exception e) {
                // One institute's hiccup must not stall the others; the next run re-reads the window.
                log.warn("Delivery check failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
        if (failed > 0) log.info("Delivery check: {} WhatsApp send(s) moved to FAILED", failed);
    }

    int apply(Set<String> sentActionIds, JsonNode failures, Instant now) {
        if (failures == null || !failures.isArray()) return 0;
        int n = 0;
        for (JsonNode f : failures) {
            String id = f.path("correlationId").asText("");
            if (!sentActionIds.contains(id)) continue;
            String reason = reason(f.path("errorCode").asText(""), f.path("errorMessage").asText(""));
            n += actionRepository.markDeliveryFailed(id, reason, now);
        }
        return n;
    }

    static String reason(String code, String message) {
        String text = message == null || message.isBlank() ? "WhatsApp did not deliver this message." : message.trim();
        if (text.startsWith("Error:")) text = text.substring(6).trim();
        if ("131049".equals(code) || text.contains("131049")) {
            text += " WhatsApp limits how many marketing messages one person gets; "
                    + "a utility-style message or another channel may still reach them.";
        }
        return ("Not delivered: " + text).substring(0, Math.min(("Not delivered: " + text).length(), 500));
    }
}
