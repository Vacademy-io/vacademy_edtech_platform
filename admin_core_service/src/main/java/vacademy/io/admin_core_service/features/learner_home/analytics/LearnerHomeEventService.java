package vacademy.io.admin_core_service.features.learner_home.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.NoticeConfig;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc.BlockState;
import vacademy.io.admin_core_service.features.learner_home.resolve.AudienceEvaluator;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerFacts;
import vacademy.io.admin_core_service.features.learner_home.resolve.LearnerHomeLayoutCache;
import vacademy.io.admin_core_service.features.learner_home.resolve.PublishedLayout;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeException;
import vacademy.io.admin_core_service.features.learner_home.service.LearnerHomeGate;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Learner-side writes: the analytics beacon (views aggregated, clicks one row each) and the
 * notice dismiss / acknowledge actions. The beacon never fails the caller: anything it cannot
 * use is dropped and the endpoint still answers 204.
 */
@Slf4j
@Service
public class LearnerHomeEventService {

    public static final int MAX_EVENTS = 50;
    static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(10);
    private static final Pattern KEY = Pattern.compile("^[A-Za-z0-9_-]{1,36}$");
    private static final Set<String> DEVICES = Set.of("PHONE", "TABLET", "DESKTOP");
    private static final Set<String> PLATFORMS = Set.of("WEB", "ANDROID", "IOS", "ELECTRON");

    private final LearnerHomeGate gate;
    private final LearnerHomeLayoutCache layoutCache;
    private final LearnerHomeEventRateLimiter rateLimiter;
    private final LearnerHomeViewAggregator aggregator;
    private final LearnerHomeJdbc jdbc;
    private Clock clock = Clock.systemUTC();

    public LearnerHomeEventService(LearnerHomeGate gate, LearnerHomeLayoutCache layoutCache,
                                   LearnerHomeEventRateLimiter rateLimiter, LearnerHomeViewAggregator aggregator,
                                   LearnerHomeJdbc jdbc) {
        this.gate = gate;
        this.layoutCache = layoutCache;
        this.rateLimiter = rateLimiter;
        this.aggregator = aggregator;
        this.jdbc = jdbc;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    /** Accepted counts, for tests: views aggregated and click rows written. */
    public record Recorded(int views, int clicks) {
    }

    public Recorded record(String instituteId, String userId, JsonNode body) {
        try {
            return recordUnsafe(instituteId, userId, body);
        } catch (RuntimeException e) {
            log.warn("[learner-home] events dropped for {}: {}", instituteId, e.getMessage());
            return new Recorded(0, 0);
        }
    }

    private Recorded recordUnsafe(String instituteId, String userId, JsonNode body) {
        if (body == null || !body.isObject() || !body.path("events").isArray()) return new Recorded(0, 0);
        JsonNode events = body.get("events");
        if (events.isEmpty()) return new Recorded(0, 0);
        if (!gate.moduleEnabled(instituteId) || gate.isHolistic(instituteId)) return new Recorded(0, 0);
        Optional<PublishedLayout> pub = layoutCache.get(instituteId);
        if (pub.isEmpty()) return new Recorded(0, 0);
        int n = Math.min(events.size(), MAX_EVENTS);
        int granted = rateLimiter.acquire(userId, n);
        Instant now = clock.instant();
        int views = 0;
        List<LearnerHomeJdbc.EventRow> clicks = new ArrayList<>();
        for (int i = 0; i < granted; i++) {
            JsonNode e = events.get(i);
            if (e == null || !e.isObject()) continue;
            String blockKey = text(e, "block_key");
            if (blockKey == null || !pub.get().eventKeys().contains(blockKey)) continue;
            String type = text(e, "type");
            String device = text(e, "device");
            if (device == null || !DEVICES.contains(device)) continue;
            String itemKey = text(e, "item_key");
            if (itemKey != null && !KEY.matcher(itemKey).matches()) continue;
            String platform = text(e, "platform");
            if (platform != null && !PLATFORMS.contains(platform)) platform = null;
            Instant at = clamp(HomeParser.parseInstant(text(e, "ts")), now);
            if ("VIEW".equals(type)) {
                aggregator.record(instituteId, blockKey, itemKey, device, at);
                views++;
            } else if ("CLICK".equals(type)) {
                Integer version = e.path("layout_version").isIntegralNumber() ? e.get("layout_version").asInt() : null;
                clicks.add(new LearnerHomeJdbc.EventRow(instituteId, blockKey, itemKey, "CLICK", userId, version,
                        device, platform, at));
            }
        }
        if (!clicks.isEmpty()) {
            jdbc.insertEvents(clicks);
        }
        return new Recorded(views, clicks.size());
    }

    /** The client's timestamp is a hint: kept only within the last 10 minutes. */
    static Instant clamp(Instant ts, Instant now) {
        if (ts == null || ts.isAfter(now)) return now;
        Instant floor = now.minus(MAX_CLOCK_SKEW);
        return ts.isBefore(floor) ? floor : ts;
    }

    private static String text(JsonNode o, String field) {
        JsonNode v = o.get(field);
        return v != null && v.isTextual() && !v.asText().isBlank() ? v.asText().trim() : null;
    }

    // ── Dismiss / acknowledge ───────────────────────────────────────────────

    public void dismiss(String instituteId, String userId, String blockKey) {
        PublishedLayout pub = requirePublished(instituteId);
        NoticeConfig notice = requireServedNotice(pub, instituteId, userId, blockKey);
        if (!notice.dismissible()) {
            throw new LearnerHomeException(HttpStatus.CONFLICT, "NOT_DISMISSIBLE", "This notice cannot be dismissed");
        }
        if (notice.requireAck()) {
            BlockState state = jdbc.state(instituteId, userId, blockKey);
            if (state == null || state.acknowledgedAt() == null) {
                throw new LearnerHomeException(HttpStatus.CONFLICT, "ACK_REQUIRED", "Acknowledge the notice first");
            }
        }
        if (jdbc.dismiss(instituteId, userId, blockKey)) {
            writeEvent(instituteId, userId, blockKey, "DISMISS", pub.version());
        }
    }

    public void acknowledge(String instituteId, String userId, String blockKey) {
        PublishedLayout pub = requirePublished(instituteId);
        NoticeConfig notice = requireServedNotice(pub, instituteId, userId, blockKey);
        if (!notice.requireAck()) {
            throw new LearnerHomeException(HttpStatus.CONFLICT, "ACK_NOT_REQUIRED", "This notice needs no acknowledgement");
        }
        if (jdbc.acknowledge(instituteId, userId, blockKey)) {
            writeEvent(instituteId, userId, blockKey, "ACK", pub.version());
        }
    }

    /**
     * The notice, only when it is currently served to this learner: a NOTICE of the published
     * version, enabled, inside its schedule, and matching its audience (enrolments and tags are
     * read only when the audience has rules). Anything else is 404, as if the notice did not exist.
     */
    private NoticeConfig requireServedNotice(PublishedLayout pub, String instituteId, String userId, String blockKey) {
        Block b = blockKey == null ? null : pub.byKey().get(blockKey);
        if (b == null || !(b.config() instanceof NoticeConfig n) || !b.enabled() || !b.inWindow(clock.instant())) {
            throw notFound();
        }
        if (!b.audience().everyone()) {
            LearnerFacts facts = LearnerFacts.load(jdbc, instituteId, userId, b.audience().usesTags());
            if (!AudienceEvaluator.matches(b.audience(), facts)) {
                throw notFound();
            }
        }
        return n;
    }

    private PublishedLayout requirePublished(String instituteId) {
        if (!gate.moduleEnabled(instituteId) || gate.isHolistic(instituteId)) {
            throw notFound();
        }
        return layoutCache.get(instituteId).orElseThrow(LearnerHomeEventService::notFound);
    }

    private static LearnerHomeException notFound() {
        return new LearnerHomeException(HttpStatus.NOT_FOUND, "BLOCK_NOT_FOUND", "No such notice");
    }

    private void writeEvent(String instituteId, String userId, String blockKey, String type, int version) {
        try {
            jdbc.insertEvents(List.of(new LearnerHomeJdbc.EventRow(instituteId, blockKey, null, type, userId, version,
                    null, null, clock.instant())));
        } catch (RuntimeException e) {
            log.warn("[learner-home] {} event not written for {}: {}", type, instituteId, e.getMessage());
        }
    }
}
