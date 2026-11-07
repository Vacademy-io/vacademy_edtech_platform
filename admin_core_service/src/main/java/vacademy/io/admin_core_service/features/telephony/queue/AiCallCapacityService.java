package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.provider.repository.AppConfigRepository;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallLane;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiVoiceBox;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallLaneRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiVoiceBoxRepository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * How many AI calls may be in flight, and how many of them one institute may hold.
 *
 * <p>Two numbers, deliberately kept apart:
 *
 * <ul>
 *   <li><b>Fleet capacity</b> is per provider, because the providers do not share
 *       hardware. {@code VACADEMY_AI} runs on our own voice boxes, so its ceiling is
 *       the sum of {@code ai_voice_box.max_concurrent} — that is the "3". {@code
 *       AAVTAAR} dials on Aavtaar's infrastructure, so counting it against our boxes
 *       would throttle it for no physical reason; it gets its own configurable number.
 *       {@code MOCK} never leaves the process and is unlimited.</li>
 *   <li><b>Lane capacity</b> is per institute, and it is what makes strict-FIFO
 *       ordering fair. Without it, the first institute to queue 500 leads owns every
 *       slot until it finishes.</li>
 * </ul>
 *
 * <p>Occupancy is <i>derived</i> from {@code telephony_call_log}, never counted — see
 * {@code TelephonyCallLogRepository.countAiCallsInFlight} for why.
 */
@Service
@RequiredArgsConstructor
public class AiCallCapacityService {

    private static final Logger log = LoggerFactory.getLogger(AiCallCapacityService.class);

    /** Providers whose dials are AI-agent calls, and therefore queue-governed. */
    public static final List<String> AI_PROVIDERS =
            List.of(ProviderType.VACADEMY_AI, ProviderType.AAVTAAR, ProviderType.MOCK);

    static final String KEY_CAPACITY_ENABLED = "ai_call_capacity_enabled";
    static final String KEY_AAVTAAR_MAX = "ai_call_aavtaar_max_concurrent";
    static final String KEY_STUCK_GRACE = "ai_call_stuck_grace_sec";
    static final String KEY_TTL_HOURS = "ai_call_queue_ttl_hours";
    static final String KEY_AVG_SECS = "ai_call_avg_secs";
    static final String KEY_RESERVED_INTERACTIVE = "ai_call_reserved_interactive";
    static final String KEY_DRAIN_BATCH = "ai_call_drain_batch";
    /** Ops ceiling on simultaneous calls. Caps the box sum; blank = no limit. */
    public static final String KEY_FLEET_LIMIT = "ai_call_fleet_limit";

    /**
     * Effectively unlimited. Used for MOCK, and for AAVTAAR when its limit is set to 0
     * — a real Integer.MAX_VALUE would overflow the moment anything adds to it.
     */
    private static final int UNLIMITED = 1_000_000;

    private final AiVoiceBoxRepository boxRepository;
    private final AiCallLaneRepository laneRepository;
    private final AiCallQueueItemRepository queueRepository;
    private final TelephonyCallLogRepository callLogRepository;
    private final AppConfigRepository appConfigRepository;

    // ── config reads ────────────────────────────────────────────────────────────

    public int stuckGraceSeconds() {
        return Math.max(60, appConfigRepository.getIntConfig(KEY_STUCK_GRACE, 720));
    }

    public int queueTtlHours() {
        return Math.max(1, appConfigRepository.getIntConfig(KEY_TTL_HOURS, 48));
    }

    public int avgCallSeconds() {
        return Math.max(30, appConfigRepository.getIntConfig(KEY_AVG_SECS, 180));
    }

    public int reservedInteractiveSlots() {
        return Math.max(0, appConfigRepository.getIntConfig(KEY_RESERVED_INTERACTIVE, 0));
    }

    public int drainBatch() {
        return Math.max(10, appConfigRepository.getIntConfig(KEY_DRAIN_BATCH, 200));
    }

    /**
     * The emergency lever. Stored as a string because {@code app_config} is a string
     * table; anything other than a literal "false" leaves the limit ON, so a typo can
     * never silently uncap the fleet.
     */
    public boolean capacityEnabled() {
        return appConfigRepository.findByConfigKey(KEY_CAPACITY_ENABLED)
                .map(c -> !"false".equalsIgnoreCase(String.valueOf(c.getConfigValue()).trim()))
                .orElse(true);
    }

    // ── fleet capacity ──────────────────────────────────────────────────────────

    /**
     * Simultaneous calls allowed on a provider.
     *
     * <p>A box with health UNKNOWN still counts: a poller that is switched off, or a
     * box whose {@code base_url} was never configured, must not take the fleet to zero
     * and stop all AI calling. Only a box we asked and that failed to answer is
     * excluded.
     */
    public int fleetCapacity(String provider) {
        if (!capacityEnabled()) return UNLIMITED;
        if (ProviderType.MOCK.equalsIgnoreCase(provider)) return UNLIMITED;
        if (ProviderType.AAVTAAR.equalsIgnoreCase(provider)) {
            int configured = appConfigRepository.getIntConfig(KEY_AAVTAAR_MAX, 20);
            return configured <= 0 ? UNLIMITED : configured;
        }
        int sum = physicalCapacity();
        // Zero boxes (all deleted or all DOWN) means genuinely no capacity, and the
        // drainer will correctly dial nothing. Logged because it is indistinguishable
        // from a bug when you are staring at a queue that will not move.
        if (sum <= 0) {
            log.warn("AI call queue: no voice box is lending capacity — {} calls will not dial "
                    + "until a box is enabled or its health recovers", ProviderType.VACADEMY_AI);
        }
        // The ops limit CAPS the hardware, never raises it: a limit above what the
        // boxes can carry is simply non-binding, so setting one can never promise
        // capacity that does not exist. 0 is a real answer — dial nothing — and the
        // queue goes on accepting work, so a pause defers calls rather than losing them.
        Integer limit = fleetLimit();
        if (limit != null) return Math.max(0, Math.min(sum, limit));
        return Math.max(0, sum);
    }

    /** What the hardware can carry, before any ops limit is applied. */
    public int physicalCapacity() {
        return boxRepository.findAll().stream()
                .filter(AiVoiceBox::countsTowardCapacity)
                .mapToInt(AiVoiceBox::getMaxConcurrent)
                .sum();
    }

    /**
     * The ops ceiling, or null when none is set and the hardware decides.
     *
     * <p>Blank rather than a sentinel number means "no limit", so the absence of a
     * policy is distinguishable from a policy of zero — which is a real and very
     * different instruction.
     */
    public Integer fleetLimit() {
        return appConfigRepository.findByConfigKey(KEY_FLEET_LIMIT)
                .map(c -> {
                    String raw = c.getConfigValue() == null ? "" : c.getConfigValue().trim();
                    if (raw.isEmpty()) return null;
                    try {
                        return Integer.valueOf(raw);
                    } catch (NumberFormatException e) {
                        // An unparseable limit must not silently uncap the fleet.
                        log.warn("AI call queue: ai_call_fleet_limit is not a number ({}) — "
                                + "ignoring it and using the boxes", raw);
                        return null;
                    }
                })
                .orElse(null);
    }

    /** Whether this provider's ceiling is effectively absent (MOCK, or an uncapped Aavtaar). */
    public boolean isUnlimited(int capacity) {
        return capacity >= UNLIMITED;
    }

    // ── occupancy ───────────────────────────────────────────────────────────────

    /**
     * A snapshot of everything the drainer needs for one tick, read once so a tick is
     * internally consistent (and so a 2-second schedule does not re-query per candidate).
     */
    public Snapshot snapshot() {
        Timestamp since = Timestamp.from(Instant.now().minus(Duration.ofSeconds(stuckGraceSeconds())));
        Map<String, Integer> perProvider = new HashMap<>();
        Map<String, Integer> perLane = new HashMap<>();
        for (Object[] row : callLogRepository.countAiCallsInFlight(AI_PROVIDERS, since)) {
            String instituteId = (String) row[0];
            String provider = (String) row[1];
            int count = ((Number) row[2]).intValue();
            perProvider.merge(provider, count, Integer::sum);
            perLane.merge(instituteId, count, Integer::sum);
        }
        // Claimed-but-not-yet-logged dials (an inline "dial now" between its claim and its
        // call-log insert). Without them, parallel inline dials all see the same free slot.
        // A dial that is both claimed and logged counts twice for a moment, which only
        // costs a tick of throughput.
        for (Object[] row : queueRepository.countDispatchingByLane(since.toInstant())) {
            String instituteId = (String) row[0];
            String provider = (String) row[1];
            int count = ((Number) row[2]).intValue();
            if (provider == null) continue;
            perProvider.merge(provider, count, Integer::sum);
            perLane.merge(instituteId, count, Integer::sum);
        }

        Map<String, Integer> capacityByProvider = new HashMap<>();
        for (String p : AI_PROVIDERS) capacityByProvider.put(p, fleetCapacity(p));

        // Boxes report their own view of activeCalls. Where that reading is fresh we
        // take the LARGER of the two — the box knows about calls we did not place
        // (an inbound IVR hand-off to the bot occupies a slot exactly like an outbound
        // one), and over-counting costs throughput while under-counting costs a lead a
        // spoken "all lines busy". A stale reading is ignored rather than trusted.
        Integer boxActive = freshBoxActiveCalls();
        if (boxActive != null) {
            perProvider.merge(ProviderType.VACADEMY_AI, boxActive, Math::max);
        }

        List<String> lanesWithWork = queueRepository.findInstitutesWithQueuedWork();
        return new Snapshot(perProvider, perLane, capacityByProvider,
                lanesWithWork.size(), loadLaneOverrides());
    }

    /**
     * Summed {@code activeCalls} across boxes polled within the last two minutes, or
     * null when no box has a fresh reading (poller off, URLs unconfigured, network
     * down) — in which case the call log is the only authority.
     */
    private Integer freshBoxActiveCalls() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(2));
        int sum = 0;
        boolean any = false;
        for (AiVoiceBox box : boxRepository.findByEnabledTrue()) {
            if (box.getActiveCalls() == null || box.getLastHealthCheck() == null) continue;
            if (box.getLastHealthCheck().isBefore(cutoff)) continue;
            sum += Math.max(0, box.getActiveCalls());
            any = true;
        }
        return any ? sum : null;
    }

    private Map<String, AiCallLane> loadLaneOverrides() {
        Map<String, AiCallLane> byInstitute = new HashMap<>();
        for (AiCallLane lane : laneRepository.findAll()) {
            byInstitute.put(lane.getInstituteId(), lane);
        }
        return byInstitute;
    }

    /**
     * One tick's worth of capacity state. Mutable in the in-flight maps: the drainer
     * increments them as it dispatches, so a single tick that fills three slots never
     * hands out a fourth on stale numbers.
     */
    public static final class Snapshot {
        private final Map<String, Integer> inFlightByProvider;
        private final Map<String, Integer> inFlightByLane;
        private final Map<String, Integer> capacityByProvider;
        private final int lanesWithWork;
        private final Map<String, AiCallLane> laneOverrides;

        Snapshot(Map<String, Integer> inFlightByProvider, Map<String, Integer> inFlightByLane,
                 Map<String, Integer> capacityByProvider, int lanesWithWork,
                 Map<String, AiCallLane> laneOverrides) {
            this.inFlightByProvider = inFlightByProvider;
            this.inFlightByLane = inFlightByLane;
            this.capacityByProvider = capacityByProvider;
            this.lanesWithWork = lanesWithWork;
            this.laneOverrides = laneOverrides;
        }

        public int capacityFor(String provider) {
            return capacityByProvider.getOrDefault(provider, 0);
        }

        public int inFlightFor(String provider) {
            return inFlightByProvider.getOrDefault(provider, 0);
        }

        public int inFlightForLane(String instituteId) {
            return inFlightByLane.getOrDefault(instituteId, 0);
        }

        public int lanesWithWork() {
            return lanesWithWork;
        }

        public boolean isPaused(String instituteId) {
            AiCallLane lane = laneOverrides.get(instituteId);
            return lane != null && lane.isPaused();
        }

        /**
         * How many simultaneous calls this institute may hold.
         *
         * <p>An explicit override wins. Otherwise the default is
         * {@code max(1, ceil(fleetCapacity / lanesWithWork))}, which is
         * work-conserving at both ends: one institute queuing alone gets the whole
         * fleet, three institutes at capacity 3 get one slot each, and the ceiling
         * (rather than the floor) of the division means capacity 3 split two ways is
         * 2+1 rather than 1+1 with a slot left idle.
         */
        public int laneCapacityFor(String instituteId, String provider) {
            AiCallLane lane = laneOverrides.get(instituteId);
            if (lane != null && lane.getMaxConcurrent() != null && lane.getMaxConcurrent() > 0) {
                return lane.getMaxConcurrent();
            }
            return defaultLaneCapacity(provider);
        }

        /**
         * The cap an institute with no override gets: {@code max(1, ceil(fleet / lanes))}.
         * The CEILING, not the floor — capacity 3 split two ways is 2+1, so the third
         * slot is used, where flooring would leave it idle at 1+1.
         */
        public int defaultLaneCapacity(String provider) {
            int fleet = capacityFor(provider);
            int lanes = Math.max(1, lanesWithWork);
            return Math.max(1, (fleet + lanes - 1) / lanes);
        }

        /** Book a slot for a dispatch this tick, so later candidates see it. */
        public void reserve(String instituteId, String provider) {
            inFlightByProvider.merge(provider, 1, Integer::sum);
            inFlightByLane.merge(instituteId, 1, Integer::sum);
        }
    }

    // ── read models for the APIs ────────────────────────────────────────────────

    public Optional<AiCallLane> findLane(String instituteId) {
        return laneRepository.findById(instituteId);
    }

    public List<AiVoiceBox> allBoxes() {
        return boxRepository.findAllByOrderByPriorityAscSlugAsc();
    }
}
