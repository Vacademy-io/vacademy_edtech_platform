package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Reply-ingestion sweep (design §10, the durable half). A best-effort webhook wake is the fast
 * path (later sub-phase); this backstop guarantees a reply is never lost for days: every 2 minutes
 * it pulls recent inbound WhatsApp replies per live-engine institute and promotes matching members
 * to tier 0 (due now, 24h window open) so the copilot surfaces a reply-response task quickly.
 *
 * Idempotent: promoting an already-tier-0 member is a no-op-ish UPDATE; overlapping windows just
 * re-stamp the same values. A slightly-overlapping lookback is deliberate (no missed replies at the
 * boundary); the deterministic wake gate collapses the duplicate promotions into one decision.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementReplyJob {

    private final EngagementInternalClients clients;
    private final EngagementMemberRepository memberRepository;
    private final EngagementReplyResponder replyResponder;

    /** Minimum lookback, and the overlap kept with the previous sweep's window. */
    private static final Duration LOOKBACK = Duration.ofMinutes(3);
    private static final Duration OVERLAP = Duration.ofMinutes(1);
    /** Upper bound after a restart or when another replica ran the recent sweeps. */
    private static final Duration MAX_LOOKBACK = Duration.ofMinutes(30);
    private static final Duration REPLY_WINDOW = Duration.ofHours(24);

    /**
     * Start of the last completed sweep on this replica. Windows chain from it: a fixed 3-minute
     * lookback with a fixed delay counted from the END of the previous sweep left a gap nobody read
     * whenever a sweep ran over about a minute (each reply can wait on an LLM call). Re-reading the
     * overlap is safe: handleReply dedups per wamid and promotion is idempotent.
     */
    private final java.util.concurrent.atomic.AtomicReference<Instant> lastSweepStart =
            new java.util.concurrent.atomic.AtomicReference<>();

    @Scheduled(fixedDelayString = "${engagement.reply.delay-ms:120000}")
    @SchedulerLock(name = "EngagementReplySweep", lockAtMostFor = "PT5M", lockAtLeastFor = "PT10S")
    public void sweep() {
        List<String> institutes = memberRepository.institutesWithLiveEngines();
        if (institutes.isEmpty()) return;

        Instant now = Instant.now();
        Instant since = now.minus(LOOKBACK);
        Instant previous = lastSweepStart.get();
        if (previous != null && previous.minus(OVERLAP).isBefore(since)) since = previous.minus(OVERLAP);
        if (since.isBefore(now.minus(MAX_LOOKBACK))) since = now.minus(MAX_LOOKBACK);
        long sinceMillis = since.toEpochMilli();
        int promoted = 0;
        int answered = 0;

        for (String instituteId : institutes) {
            try {
                JsonNode replies = clients.inboundSince(instituteId, sinceMillis);
                if (replies == null || !replies.isArray() || replies.isEmpty()) continue;
                // Batch all this institute's reply phones into ONE promotion (avoids 2 unindexable
                // full scans of student + audience_response PER reply every 2 minutes). This MUST run
                // before the auto-reply pass — it opens the 24h window the responder gates on.
                java.util.LinkedHashSet<String> phones = new java.util.LinkedHashSet<>();
                for (JsonNode reply : replies) {
                    String p = last10(reply.path("phone").asText(null));
                    if (p != null) phones.add(p);
                }
                if (!phones.isEmpty()) {
                    // Meta's window runs 24h from the learner's message, not from this sweep. With a
                    // longer lookback "now + 24h" would overstate it, so take the earliest reply in the
                    // batch: never later than any phone's real window (at worst a few minutes short).
                    Instant windowUntil = earliestReceivedAt(replies, now).plus(REPLY_WINDOW);
                    promoted += memberRepository.promoteByPhones(
                            instituteId, new java.util.ArrayList<>(phones), now, windowUntil);
                }
                // Auto-reply pass (opt-in): per message, the responder answers or escalates for
                // autoReply-enabled engines only (its candidate query filters them; a no-op otherwise).
                for (JsonNode reply : replies) {
                    try {
                        boolean acted = replyResponder.handleReply(instituteId,
                                reply.path("phone").asText(null), reply.path("text").asText(null),
                                reply.path("wamid").asText(null));
                        if (acted) answered++;
                    } catch (Exception e) {
                        log.warn("Auto-reply failed for a message in institute {}: {}", instituteId, e.getMessage());
                    }
                }
            } catch (Exception e) {
                // One institute's notification-service hiccup must not stall the others.
                log.warn("Reply sweep failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
        if (promoted > 0 || answered > 0) {
            log.info("Reply sweep: promoted {} members, auto-handled {} replies across {} institutes",
                    promoted, answered, institutes.size());
        }

        lastSweepStart.set(now);

        // Prune the handled-reply dedup set (rows older than 2× the reply window are dead weight).
        try {
            memberRepository.pruneHandledReplies(now.minus(Duration.ofHours(48)));
        } catch (Exception e) {
            log.warn("Handled-reply prune failed: {}", e.getMessage());
        }
    }

    private static Instant earliestReceivedAt(JsonNode replies, Instant fallback) {
        Instant earliest = fallback;
        for (JsonNode reply : replies) {
            try {
                String at = reply.path("receivedAt").asText(null);
                if (at != null) {
                    Instant t = Instant.parse(at);
                    if (t.isBefore(earliest)) earliest = t;
                }
            } catch (Exception ignored) {
                // unparseable timestamp: keep the fallback for this row
            }
        }
        return earliest;
    }

    private static String last10(String phone) {
        if (phone == null) return null;
        String d = phone.replaceAll("[^0-9]", "");
        if (d.isEmpty()) return null;
        return d.length() <= 10 ? d : d.substring(d.length() - 10);
    }
}
