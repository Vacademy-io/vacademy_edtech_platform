package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.CallingWindowUtil;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.*;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallLane;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallLaneRepository;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The queue's front door: everything that puts an AI call INTO the queue, and
 * everything that reads it back out for a human.
 *
 * <p>Nothing here dials. {@link AiCallQueueDrainJob} is the only dialler, which is what
 * makes the fleet-wide concurrency limit exact.
 *
 * <h3>Sources</h3>
 * <ul>
 *   <li>{@code WORKFLOW} — the CALL_AI node, via {@code AiCallNodeDispatcher}</li>
 *   <li>{@code BULK} — a bulk campaign over an audience</li>
 *   <li>{@code MANUAL} — a counsellor's click-to-AI-call</li>
 * </ul>
 *
 * <h3>Calling windows</h3>
 * A queued item can wait hours, so the institute's calling shifts — which previously
 * only gated the timed retry re-dialer, since every other path dialled instantly — now
 * gate the queue too. MANUAL is the deliberate exception: a person pressing Call at
 * 21:30 is making a decision, and refusing it would be a behaviour change on the one
 * path that never had a window. The drainer re-checks the window at dispatch, so this
 * enqueue-time stamp is only a head start.
 */
@Service
@RequiredArgsConstructor
public class AiCallQueueService {

    private static final Logger log = LoggerFactory.getLogger(AiCallQueueService.class);

    public static final String SOURCE_WORKFLOW = "WORKFLOW";
    public static final String SOURCE_BULK = "BULK";
    public static final String SOURCE_MANUAL = "MANUAL";

    /** Rows per insert transaction for a bulk enqueue. */
    private static final int CHUNK = 100;

    /** Ordinary work: bulk campaigns and automation. */
    public static final int PRIORITY_DEFAULT = 100;

    /**
     * A person clicked Call and is waiting.
     *
     * <p>Everything used to enqueue at the same priority, which meant a counsellor's
     * click during a 100-lead campaign landed at position 101 and waited out the whole
     * run — roughly an hour and a half. It could not even be rescued by reserving a
     * slot: the drain query takes each lane's OLDEST rows, so the click was never in
     * the candidate set to begin with.
     *
     * <p>Ranking it above bulk fixes both ends at once. The drainer orders by priority
     * first, so it surfaces immediately; and {@code countAheadInLane} counts only rows
     * that outrank it, so the inline fast path sees an empty lane ahead and dials on the
     * request thread exactly as it does on an idle fleet.
     */
    public static final int PRIORITY_INTERACTIVE = 200;

    /**
     * Pseudo-status for "on a line right now". Not a real {@link AiCallQueueStatus} —
     * the queue row stops at DIALED, so liveness is a join against the call log.
     */
    public static final String LIVE_FILTER = "LIVE";

    /** Waiting plus already dialling — the default view, and what "the queue" means. */
    public static final String ACTIVE_FILTER = "ACTIVE";

    /** Explicit "show me everything, finished included". */
    public static final String ALL_FILTER = "ALL";

    private final AiCallQueueItemRepository repository;
    private final AiCallLaneRepository laneRepository;
    private final AiCallQueueTxOps txOps;
    private final AiCallQueueDirectory directory;
    private final AiCallCapacityService capacityService;
    private final AiCallingSettingsService settingsService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ── enqueue ─────────────────────────────────────────────────────────────────

    /**
     * Queue one AI call.
     *
     * <p>Idempotent per lead: if this lead already has an undialled item on this
     * provider, the existing item is returned with {@code queued=false} rather than a
     * second one being created. That is load-bearing for workflows — the engine resumes
     * a run by RESTARTING it, so a CALL_AI node can re-enter many times for the same
     * lead before its first call ever goes out.
     */
    public EnqueueResult enqueue(AiCallRequestDTO req, CallTrigger trigger,
                                 String source, String sourceRef, String actorUserId) {
        return enqueue(req, trigger, source, sourceRef, actorUserId, trigger == CallTrigger.MANUAL);
    }

    /**
     * {@link #enqueue(AiCallRequestDTO, CallTrigger, String, String, String)} with the
     * priority chosen by the caller: {@code interactive} puts the item ahead of bulk work
     * in its lane (a single call a client's server just asked for — someone may be
     * waiting on it), without exempting it from calling hours the way MANUAL is.
     */
    public EnqueueResult enqueue(AiCallRequestDTO req, CallTrigger trigger,
                                 String source, String sourceRef, String actorUserId,
                                 boolean interactive) {
        if (req == null || isBlank(req.getInstituteId())) {
            throw new VacademyException("instituteId is required to queue an AI call.");
        }
        AiCallingSettingsPojo settings = settingsService.get(req.getInstituteId());
        String provider = resolveProvider(req, settings);
        String subjectKey = subjectKey(req);
        String dedupeKey = dedupeKey(req.getInstituteId(), provider, subjectKey);

        Optional<AiCallQueueItem> pending = repository.findPendingByDedupeKey(dedupeKey);
        if (pending.isPresent()) {
            AiCallQueueItem existing = pending.get();
            return describe(existing, false,
                    "This lead already has an AI call waiting for a line.");
        }

        AiCallQueueItem item = buildItem(req, settings, provider, trigger, source, sourceRef,
                actorUserId, dedupeKey);
        if (interactive) item.setPriority(PRIORITY_INTERACTIVE);
        AiCallQueueItem saved = txOps.insertOne(item);
        if (saved == null) {
            // Lost the unique-index race — someone queued the same lead microseconds
            // ago. Report THEIR item; the caller's intent is satisfied either way.
            return repository.findPendingByDedupeKey(dedupeKey)
                    .map(existing -> describe(existing, false,
                            "This lead already has an AI call waiting for a line."))
                    .orElseGet(() -> EnqueueResult.builder()
                            .queued(false)
                            .message("This lead already has an AI call waiting for a line.")
                            .build());
        }
        return describe(saved, true, "Queued for the next free line.");
    }

    /**
     * Queue many AI calls at once (a bulk campaign).
     *
     * <p>Leads that already hold an undialled item are dropped up front from a single
     * query rather than probed one at a time — a 500-lead campaign runs on the request
     * thread and must return promptly.
     *
     * @return the number of items actually queued.
     */
    public int enqueueBatch(String instituteId, List<AiCallRequestDTO> requests,
                            CallTrigger trigger, String source, String sourceRef,
                            String actorUserId) {
        if (requests == null || requests.isEmpty()) return 0;
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        Set<String> alreadyPending = new HashSet<>(repository.findPendingDedupeKeys(instituteId));

        List<AiCallQueueItem> toInsert = new ArrayList<>(requests.size());
        // Also de-duplicates WITHIN this batch: an audience holding the same lead twice
        // would otherwise submit two rows and have the second rejected by the index.
        Set<String> seen = new HashSet<>();
        for (AiCallRequestDTO req : requests) {
            String provider = resolveProvider(req, settings);
            String dedupeKey = dedupeKey(instituteId, provider, subjectKey(req));
            if (alreadyPending.contains(dedupeKey) || !seen.add(dedupeKey)) continue;
            toInsert.add(buildItem(req, settings, provider, trigger, source, sourceRef,
                    actorUserId, dedupeKey));
        }
        if (toInsert.isEmpty()) return 0;

        int inserted = 0;
        for (int i = 0; i < toInsert.size(); i += CHUNK) {
            List<AiCallQueueItem> chunk = toInsert.subList(i, Math.min(toInsert.size(), i + CHUNK));
            List<AiCallQueueItem> ok = txOps.insertChunk(chunk);
            if (ok != null) {
                inserted += ok.size();
                continue;
            }
            // The chunk lost a race. Retry its rows individually so one contended lead
            // cannot cost the rest of the campaign its calls.
            for (AiCallQueueItem item : chunk) {
                if (txOps.insertOne(item) != null) inserted++;
            }
        }
        log.info("ai-call queue: enqueued {} of {} requested item(s) for institute {} (source={} ref={})",
                inserted, requests.size(), instituteId, source, sourceRef);
        return inserted;
    }

    private AiCallQueueItem buildItem(AiCallRequestDTO req, AiCallingSettingsPojo settings,
                                      String provider, CallTrigger trigger, String source,
                                      String sourceRef, String actorUserId, String dedupeKey) {
        Instant now = Instant.now();
        Instant notBefore = initialNotBefore(settings, trigger, now);
        return AiCallQueueItem.builder()
                .instituteId(req.getInstituteId())
                .provider(provider)
                .priority(trigger == CallTrigger.MANUAL ? PRIORITY_INTERACTIVE : PRIORITY_DEFAULT)
                .source(source)
                .sourceRef(sourceRef)
                .callTrigger((trigger == null ? CallTrigger.AUTOMATION : trigger).name())
                .responseId(req.getResponseId())
                .userId(req.getUserId())
                .phoneNumber(req.getPhoneNumber())
                .campaignId(req.getCampaignId())
                .campaignName(req.getCampaignName())
                .preferredNumberId(req.getPreferredNumberId())
                .subjectType(req.getSubjectType())
                .subjectId(req.getSubjectId())
                .customerName(req.getCustomerName())
                .customerEmail(req.getCustomerEmail())
                .metadata(writeMetadata(req.getMetadata()))
                .actorUserId(actorUserId)
                .dedupeKey(dedupeKey)
                .status(AiCallQueueStatus.QUEUED.name())
                .attempts(0)
                .notBefore(notBefore)
                // Same words the drainer uses when it defers an item to the next window.
                .statusReason(notBefore != null ? "Outside this institute's calling hours." : null)
                .expiresAt(now.plus(Duration.ofHours(capacityService.queueTtlHours())))
                .createdAt(now)
                .build();
    }

    /**
     * When this item first becomes eligible. Null (= immediately) inside the calling
     * window, and for MANUAL regardless — see the class note on windows.
     */
    private Instant initialNotBefore(AiCallingSettingsPojo settings, CallTrigger trigger, Instant now) {
        if (trigger == CallTrigger.MANUAL) return null;
        ZoneId tz = CallingWindowUtil.resolveZone(settings.getTimezone());
        if (CallingWindowUtil.withinAnyShift(now, settings.getCallingShifts(), tz)) return null;
        return CallingWindowUtil.nextShiftOpen(now, settings.getCallingShifts(), tz);
    }

    private String resolveProvider(AiCallRequestDTO req, AiCallingSettingsPojo settings) {
        String provider = isBlank(req.getProvider()) ? settings.getProvider() : req.getProvider();
        // Mirrors AiCallService.placeCall's own fallback, so the provider this item is
        // accounted against is the provider it will actually dial on.
        return isBlank(provider) ? ProviderType.AAVTAAR : provider;
    }

    /**
     * What "the same call" means for de-duplication: one undialled AI call per lead per
     * provider. Matches {@code AiCallService}'s own 30-second duplicate window, which
     * keys on institute + user + provider.
     */
    /**
     * Is a call for this subject still waiting to dial (QUEUED or DISPATCHING)?
     *
     * <p>Asked by the CALL_AI workflow node before it counts a retry. The node enqueues
     * and then sleeps on a timer, but the dial is asynchronous and can lag arbitrarily —
     * the queue may be paused, out of credits, outside calling hours, or simply deep. If
     * the node counted those as attempts it would exhaust its retries against calls that
     * never happened and declare a lead unreachable while its call was still queued.
     */
    public boolean hasCallWaiting(String instituteId, String provider, String subjectKey) {
        if (isBlank(instituteId) || isBlank(subjectKey)) return false;
        String effectiveProvider = isBlank(provider)
                ? settingsService.get(instituteId).getProvider() : provider;
        if (isBlank(effectiveProvider)) effectiveProvider = ProviderType.AAVTAAR;
        return repository.findPendingByDedupeKey(
                dedupeKey(instituteId, effectiveProvider, subjectKey)).isPresent();
    }

    private String subjectKey(AiCallRequestDTO req) {
        String key = firstNonBlank(req.getUserId(), req.getSubjectId(), req.getResponseId(),
                req.getPhoneNumber());
        return key == null ? "unknown" : key;
    }

    private String dedupeKey(String instituteId, String provider, String subjectKey) {
        return instituteId + "|" + provider + "|" + subjectKey;
    }

    private String writeMetadata(Map<String, Object> metadata) {
        if (metadata == null || metadata.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(metadata);
        } catch (Exception e) {
            log.warn("ai-call queue: could not serialise call metadata — dropping it: {}", e.getMessage());
            return null;
        }
    }

    /** Replay the stored metadata blob. Package-private: the drainer is the only reader. */
    @SuppressWarnings("unchecked")
    Map<String, Object> readMetadata(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            log.warn("ai-call queue: unreadable metadata on a queued item — dialing without it: {}",
                    e.getMessage());
            return null;
        }
    }

    // ── reads ───────────────────────────────────────────────────────────────────

    private EnqueueResult describe(AiCallQueueItem item, boolean queued, String message) {
        long ahead = repository.countAheadInLane(item.getInstituteId(), item.getPriority(),
                item.getCreatedAt());
        long eta = etaMinutes(item.getInstituteId(), item.getProvider(), ahead);
        return EnqueueResult.builder()
                .queueItemId(item.getId())
                .queued(queued)
                .aheadInLane(ahead)
                .etaMinutes(eta)
                .message(message + (ahead > 0
                        ? " " + (ahead + 1) + " in line, roughly " + eta + " min."
                        : " Next up."))
                .build();
    }

    /**
     * Rough wait for an item with {@code ahead} items in front of it in its own lane.
     *
     * <p>Deliberately computed from the LANE, not the whole queue: the per-lane
     * concurrency cap means an institute drains at its own rate no matter how much
     * other institutes have queued. Honest to within the accuracy of the assumed call
     * length, which is what an admin needs to decide whether to wait or cancel.
     */
    public long etaMinutes(String instituteId, String provider, long ahead) {
        return etaMinutes(capacityService.snapshot(), instituteId, provider, ahead);
    }

    /** As above, against a snapshot the caller already holds (one per page, not one per row). */
    public long etaMinutes(AiCallCapacityService.Snapshot snap, String instituteId,
                           String provider, long ahead) {
        if (ahead <= 0) return 0;
        int laneSlots = Math.max(1, snap.laneCapacityFor(instituteId, provider));
        double batches = Math.ceil((double) ahead / laneSlots);
        long dialing = Math.max(1, Math.round(batches * capacityService.avgCallSeconds() / 60.0));

        // Nothing dials while the lane is held, so the wait is the hold PLUS the work.
        // Reporting only the work told an admin at 20:55, with the window closing at
        // 21:00, that a hundred-lead run had "about 1 h 40 min left" when in truth
        // nothing would happen until 09:00 the next morning.
        Instant earliest = repository.findEarliestNotBefore(instituteId);
        if (earliest != null && earliest.isAfter(Instant.now())) {
            long held = Duration.between(Instant.now(), earliest).toMinutes();
            return Math.max(1, held + dialing);
        }
        return dialing;
    }

    public QueueSummary summary(String instituteId) {
        AiCallCapacityService.Snapshot snap = capacityService.snapshot();
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        String provider = isBlank(settings.getProvider()) ? ProviderType.AAVTAAR : settings.getProvider();

        long queued = repository.countQueuedForInstitute(instituteId);
        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (Object[] row : repository.countByInstituteGroupedByStatus(instituteId)) {
            byStatus.put((String) row[0], ((Number) row[1]).longValue());
        }
        return QueueSummary.builder()
                .instituteId(instituteId)
                .queued(queued)
                .inFlight(snap.inFlightForLane(instituteId))
                .paused(snap.isPaused(instituteId))
                // The lane capacity still drives this number, it is just never handed
                // out on its own -- a wait in minutes says what an institute needs to
                // know without disclosing the size of the pool behind it.
                .etaMinutes(etaMinutes(snap, instituteId, provider, queued))
                .byStatus(byStatus)
                .build();
    }

    /** Position lookups are capped: past this depth an item's place in line is not shown. */
    private static final int POSITION_LOOKUP_DEPTH = 5000;

    public Page<QueueItemView> list(String instituteId, String status, int page, int size) {
        return list(instituteId, status, null, page, size);
    }

    /**
     * @param sourceRef optional bulk-run (audience) id. Narrowing to one run is what
     *        makes a hundred-lead campaign findable here after its progress dialog has
     *        been closed, and what lets "cancel the rest" mean one campaign rather than
     *        everything this institute has waiting.
     */
    public Page<QueueItemView> list(String instituteId, String status, String sourceRef,
                                    int page, int size) {
        PageRequest pageable = PageRequest.of(Math.max(0, page), Math.min(200, Math.max(1, size)));
        String run = blankToNull(sourceRef);
        Page<AiCallQueueItem> rows;
        if (LIVE_FILTER.equalsIgnoreCase(status)) {
            rows = repository.findLive(instituteId, run, pageable);
        } else if (isBlank(status) || ACTIVE_FILTER.equalsIgnoreCase(status)) {
            // Blank means ACTIVE, not "everything": the queue page's job is what has
            // not finished, and defaulting to the full history buries it.
            rows = repository.findActive(instituteId, run, pageable);
        } else if (ALL_FILTER.equalsIgnoreCase(status)) {
            rows = run == null
                    ? repository.findByInstituteIdOrderByCreatedAtDesc(instituteId, pageable)
                    : repository.findByInstituteIdAndSourceRefOrderByCreatedAtDesc(
                            instituteId, run, pageable);
        } else {
            String s = status.toUpperCase();
            rows = run == null
                    ? repository.findByInstituteIdAndStatusOrderByCreatedAtDesc(
                            instituteId, s, pageable)
                    : repository.findByInstituteIdAndStatusAndSourceRefOrderByCreatedAtDesc(
                            instituteId, s, run, pageable);
        }

        // One snapshot and one ordered id list for the whole page — see
        // findQueuedIdsInDispatchOrder for why this is not a per-row count.
        AiCallCapacityService.Snapshot snap = capacityService.snapshot();
        Map<String, Integer> positions = new HashMap<>();
        List<String> ordered = repository.findQueuedIdsInDispatchOrder(
                instituteId, PageRequest.of(0, POSITION_LOOKUP_DEPTH));
        for (int i = 0; i < ordered.size(); i++) positions.put(ordered.get(i), i);

        AiCallQueueDirectory.Names names = directory.forItems(rows.getContent());
        Map<String, AiCallQueueDirectory.CallState> callStates = callStatesFor(rows.getContent());
        return rows.map(item -> toView(item, snap, positions, names, callStates));
    }

    /** One live-state lookup for a whole page — see AiCallQueueDirectory.callStates. */
    private Map<String, AiCallQueueDirectory.CallState> callStatesFor(List<AiCallQueueItem> items) {
        Set<String> ids = new HashSet<>();
        for (AiCallQueueItem item : items) {
            if (item.getCallLogId() != null) ids.add(item.getCallLogId());
        }
        return directory.callStates(ids);
    }

    /**
     * Cross-institute listing for the internal dashboard.
     *
     * <p>Defaults to what is WAITING, in the order it will dial — that is the question a
     * queue screen exists to answer. Pass an explicit status (or {@code ALL}) to look at
     * history instead, which is then ordered newest-first.
     *
     * <p>Positions are per-lane, so an item can read "2nd in line" while sitting far down
     * a cross-institute page: the lane, not the global list, is what governs its wait.
     */
    public Page<QueueItemView> search(String instituteId, String status, String provider,
                                      String source, int page, int size) {
        return search(instituteId, status, provider, source, page, size, capacityService.snapshot());
    }

    /** As above, against a snapshot the caller already holds — see the ops snapshot. */
    public Page<QueueItemView> search(String instituteId, String status, String provider,
                                      String source, int page, int size,
                                      AiCallCapacityService.Snapshot snap) {
        PageRequest pageable = PageRequest.of(Math.max(0, page), Math.min(200, Math.max(1, size)));
        boolean waitingOnly = isBlank(status)
                || AiCallQueueStatus.QUEUED.name().equalsIgnoreCase(status);
        String statusFilter = isBlank(status)
                ? AiCallQueueStatus.QUEUED.name()
                : ("ALL".equalsIgnoreCase(status) ? null : status.toUpperCase());

        Page<AiCallQueueItem> rows;
        if (LIVE_FILTER.equalsIgnoreCase(status)) {
            rows = repository.findLive(blankToNull(instituteId), null, pageable);
        } else if (waitingOnly) {
            rows = repository.searchInLineOrder(blankToNull(instituteId), statusFilter,
                    blankToNull(provider), blankToNull(source), pageable);
        } else {
            rows = repository.searchByRecency(blankToNull(instituteId), statusFilter,
                    blankToNull(provider), blankToNull(source), pageable);
        }

        AiCallQueueDirectory.Names names = directory.forItems(rows.getContent());

        // Line positions are per lane, so build one ordered id list per institute ON the
        // page rather than one global list — a cross-institute page can span many lanes.
        Map<String, Integer> positions = new HashMap<>();
        Set<String> lanesOnPage = new HashSet<>();
        for (AiCallQueueItem item : rows.getContent()) {
            if (AiCallQueueStatus.QUEUED.name().equals(item.getStatus())) {
                lanesOnPage.add(item.getInstituteId());
            }
        }
        for (String lane : lanesOnPage) {
            List<String> ordered = repository.findQueuedIdsInDispatchOrder(
                    lane, PageRequest.of(0, POSITION_LOOKUP_DEPTH));
            for (int i = 0; i < ordered.size(); i++) positions.put(ordered.get(i), i);
        }
        Map<String, AiCallQueueDirectory.CallState> callStates = callStatesFor(rows.getContent());
        return rows.map(item -> toView(item, snap, positions, names, callStates));
    }

    private QueueItemView toView(AiCallQueueItem item, AiCallCapacityService.Snapshot snap,
                                 Map<String, Integer> positions,
                                 AiCallQueueDirectory.Names names,
                                 Map<String, AiCallQueueDirectory.CallState> callStates) {
        AiCallQueueDirectory.CallState call = item.getCallLogId() == null
                ? null : callStates.get(item.getCallLogId());
        Long ahead = null;
        Long eta = null;
        Integer index = positions.get(item.getId());
        if (index != null) {
            ahead = (long) index;
            eta = etaMinutes(snap, item.getInstituteId(), item.getProvider(), ahead);
        }
        return QueueItemView.builder()
                .id(item.getId())
                .instituteId(item.getInstituteId())
                .instituteName(names.instituteName(item.getInstituteId()))
                .agentName(names.agentName(item.getCampaignName(), item.getCampaignId()))
                .provider(item.getProvider())
                .source(item.getSource())
                .callTrigger(item.getCallTrigger())
                .priority(item.getPriority())
                .sourceRef(item.getSourceRef())
                .sourceName(names.runName(item.getSourceRef()))
                .status(item.getStatus())
                .statusReason(item.getStatusReason())
                .responseId(item.getResponseId())
                .userId(item.getUserId())
                // A public API call has no lead row; the name the client sent is on the item.
                .leadName(item.getResponseId() == null ? item.getCustomerName() : names.leadName(item.getResponseId()))
                // A queued row often has no phone of its own — the number is resolved
                // downstream at dial time — so fall back to what was actually dialled,
                // then to the number on the lead's CRM record, rather than leaving the
                // column showing a raw id.
                .phoneNumber(firstNonBlank(item.getPhoneNumber(),
                        call == null ? null : call.toNumber(),
                        names.leadMobile(item.getResponseId())))
                .campaignId(item.getCampaignId())
                .campaignName(item.getCampaignName())
                .attempts(item.getAttempts())
                .notBefore(str(item.getNotBefore()))
                .expiresAt(str(item.getExpiresAt()))
                .callLogId(item.getCallLogId())
                .dispatchedAt(str(item.getDispatchedAt()))
                .createdAt(str(item.getCreatedAt()))
                .aheadInLane(ahead)
                .etaMinutes(eta)
                .callStatus(call == null ? null : call.status())
                .callDurationSeconds(call == null ? null : call.durationSeconds())
                .live(call != null && call.live())
                .build();
    }

    /** Queue-side counts for one bulk run, for the campaign progress dialog. */
    public Map<String, Long> bulkRunCounts(String instituteId, String audienceId) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (Object[] row : repository.countBySourceRefGroupedByStatus(
                instituteId, SOURCE_BULK, audienceId)) {
            out.put((String) row[0], ((Number) row[1]).longValue());
        }
        return out;
    }

    /**
     * Progress of one bulk run, counted from the QUEUE.
     *
     * <p>Deliberately not from the call log. That only knows about calls already
     * dialled, so a 100-lead run against a 3-line fleet reported a total of 3 — and a
     * lead the queue cancelled (a counsellor claimed it mid-run) or expired never
     * produces a call-log row at all, so a progress bar counting them could never reach
     * its own denominator and the dialog sat at "96 of 100" for ever.
     */
    public BulkRunSummary bulkRunSummary(String instituteId, String audienceId) {
        Map<String, Long> byStatus = bulkRunCounts(instituteId, audienceId);
        long total = byStatus.values().stream().mapToLong(Long::longValue).sum();
        long waiting = byStatus.getOrDefault(AiCallQueueStatus.QUEUED.name(), 0L)
                + byStatus.getOrDefault(AiCallQueueStatus.DISPATCHING.name(), 0L);
        long dialed = byStatus.getOrDefault(AiCallQueueStatus.DIALED.name(), 0L);
        long dropped = byStatus.getOrDefault(AiCallQueueStatus.CANCELLED.name(), 0L)
                + byStatus.getOrDefault(AiCallQueueStatus.EXPIRED.name(), 0L)
                + byStatus.getOrDefault(AiCallQueueStatus.FAILED.name(), 0L);

        // A DIALED row is still in progress until its CALL reaches a terminal status —
        // the queue row stops moving the moment the provider accepts.
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        String provider = isBlank(settings.getProvider()) ? ProviderType.AAVTAAR : settings.getProvider();
        long live = repository.countLiveForRun(instituteId, SOURCE_BULK, audienceId);
        long completed = Math.max(0, dialed - live);

        AiCallCapacityService.Snapshot snap = capacityService.snapshot();
        return BulkRunSummary.builder()
                .audienceId(audienceId)
                .total(total)
                .waiting(waiting)
                .dialing(live)
                .completed(completed)
                .dropped(dropped)
                .finished(completed + dropped)
                // Finished means nothing can change again: nothing waiting AND nothing
                // still on a call. Counting only terminal call logs never got there.
                .runFinished(total > 0 && waiting == 0 && live == 0)
                .etaMinutes(etaMinutes(snap, instituteId, provider, waiting))
                .byStatus(byStatus)
                .build();
    }

    /**
     * Every lead a bulk run enqueued, in dial order — including the ones still waiting,
     * which is the whole point. Same row shape as the queue tab, so both surfaces show a
     * lead's position, wait and live state identically.
     */
    public Page<QueueItemView> bulkRunItems(String instituteId, String audienceId,
                                            int page, int size) {
        PageRequest pageable = PageRequest.of(Math.max(0, page), Math.min(500, Math.max(1, size)));
        Page<AiCallQueueItem> rows = repository.findRunItems(
                instituteId, SOURCE_BULK, audienceId, pageable);

        AiCallCapacityService.Snapshot snap = capacityService.snapshot();
        AiCallQueueDirectory.Names names = directory.forItems(rows.getContent());
        Map<String, AiCallQueueDirectory.CallState> callStates = callStatesFor(rows.getContent());

        Map<String, Integer> positions = new HashMap<>();
        List<String> ordered = repository.findQueuedIdsInDispatchOrder(
                instituteId, PageRequest.of(0, POSITION_LOOKUP_DEPTH));
        for (int i = 0; i < ordered.size(); i++) positions.put(ordered.get(i), i);

        return rows.map(item -> toView(item, snap, positions, names, callStates));
    }

    /**
     * Bulk runs this institute has queued, newest first — the campaign filter's options.
     *
     * <p>Without this the queue tab is a flat list in which two concurrent campaigns are
     * indistinguishable, and the run whose progress dialog you just closed is one of a
     * hundred identical-looking rows.
     */
    public List<Map<String, Object>> recentRuns(String instituteId, int limit) {
        List<Object[]> rows = repository.findRecentRuns(
                instituteId, SOURCE_BULK, PageRequest.of(0, Math.min(50, Math.max(1, limit))));
        Set<String> ids = new java.util.LinkedHashSet<>();
        for (Object[] r : rows) if (r[0] != null) ids.add((String) r[0]);
        Map<String, String> names = directory.campaignNamesFor(ids);

        List<Map<String, Object>> out = new ArrayList<>();
        for (Object[] r : rows) {
            String id = (String) r[0];
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("audienceId", id);
            m.put("name", names.getOrDefault(id, id));
            m.put("startedAt", r[1] == null ? null : r[1].toString());
            m.put("total", ((Number) r[2]).longValue());
            out.add(m);
        }
        return out;
    }

    // ── cancel ──────────────────────────────────────────────────────────────────

    @Transactional
    public int cancelForInstitute(String instituteId, String sourceRef, String reason) {
        int n = repository.cancelQueued(instituteId, sourceRef,
                isBlank(reason) ? "Cancelled by an administrator." : reason);
        log.info("ai-call queue: cancelled {} queued item(s) for institute {}{}",
                n, instituteId, sourceRef == null ? "" : " (run " + sourceRef + ")");
        return n;
    }

    @Transactional
    public boolean cancelOne(String instituteId, String id, String reason) {
        return repository.cancelOne(id, instituteId,
                isBlank(reason) ? "Cancelled by an administrator." : reason) > 0;
    }

    // ── lane administration ─────────────────────────────────────────────────────

    public LaneView laneView(String instituteId) {
        return laneView(instituteId, capacityService.snapshot(),
                directory.instituteNames(List.of(instituteId)),
                java.util.Map.of());
    }

    /** As above, against lookups the caller already holds — see {@link #allLanes()}. */
    private LaneView laneView(String instituteId, AiCallCapacityService.Snapshot snap,
                              Map<String, String> instituteNames,
                              Map<String, Instant> oldestQueued) {
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        String provider = isBlank(settings.getProvider()) ? ProviderType.AAVTAAR : settings.getProvider();
        AiCallLane lane = laneRepository.findById(instituteId).orElse(null);
        long queued = repository.countQueuedForInstitute(instituteId);
        return LaneView.builder()
                .instituteId(instituteId)
                .instituteName(instituteNames.get(instituteId))
                .maxConcurrent(lane == null ? null : lane.getMaxConcurrent())
                .effectiveMaxConcurrent(snap.laneCapacityFor(instituteId, provider))
                .weight(lane == null ? 1 : lane.getWeight())
                .paused(lane != null && lane.isPaused())
                .queued(queued)
                .inFlight(snap.inFlightForLane(instituteId))
                .etaMinutes(etaMinutes(snap, instituteId, provider, queued))
                .oldestQueuedAt(str(oldestQueued.get(instituteId)))
                .lastDispatchedAt(lane == null ? null : str(lane.getLastDispatchedAt()))
                .build();
    }

    @Transactional
    public LaneView upsertLane(String instituteId, LaneUpsertRequest body) {
        AiCallLane lane = laneRepository.findById(instituteId)
                .orElseGet(() -> AiCallLane.builder().instituteId(instituteId).weight(1).build());
        if (body != null) {
            // A null maxConcurrent is meaningful — it CLEARS the override and returns the
            // institute to the dynamic default — so it is applied unconditionally rather
            // than skipped as "not supplied".
            lane.setMaxConcurrent(body.getMaxConcurrent() != null && body.getMaxConcurrent() > 0
                    ? body.getMaxConcurrent() : null);
            if (body.getWeight() != null && body.getWeight() > 0) lane.setWeight(body.getWeight());
            if (body.getPaused() != null) lane.setPaused(body.getPaused());
        }
        laneRepository.save(lane);
        return laneView(instituteId);
    }

    /**
     * Hold or release one institute's queue.
     *
     * <p>Pausing writes a single flag. Nothing is cancelled, re-timed or removed: the
     * rows keep their status, their order and their place in the campaign, the drain
     * job simply steps over the lane ({@code Snapshot#isPaused}), and the TTL sweep
     * leaves them alone. Resuming lets the very next tick pick them up.
     *
     * <p>On resume the expiries are pushed forward by the time held, so a lead queued
     * before a two-day pause still gets the TTL it had when it was frozen rather than
     * expiring the moment the queue restarts.
     */
    @Transactional
    public LaneView setQueuePaused(String instituteId, boolean paused) {
        AiCallLane lane = laneRepository.findById(instituteId)
                .orElseGet(() -> AiCallLane.builder().instituteId(instituteId).weight(1).build());
        boolean was = lane.isPaused();
        if (was == paused) {
            log.info("ai-call queue: institute {} already {}", instituteId, paused ? "paused" : "running");
            return laneView(instituteId);
        }
        if (!paused && lane.getUpdatedAt() != null) {
            long held = Math.max(0, Duration.between(lane.getUpdatedAt(), Instant.now()).getSeconds());
            if (held > 0) {
                int moved = repository.extendExpiryAfterPause(instituteId, held);
                log.info("ai-call queue: resumed institute {} after {}s — extended expiry on {} held call(s)",
                        instituteId, held, moved);
            }
        }
        lane.setPaused(paused);
        laneRepository.save(lane);
        log.info("ai-call queue: institute {} {}", instituteId, paused ? "PAUSED (queue held)" : "RESUMED");
        return laneView(instituteId);
    }

    public List<LaneView> allLanes() {
        return allLanes(capacityService.snapshot());
    }

    /** As above, against a snapshot the caller already holds. */
    public List<LaneView> allLanes(AiCallCapacityService.Snapshot snap) {
        List<LaneView> out = new ArrayList<>();
        Set<String> institutes = new java.util.LinkedHashSet<>();
        for (Object[] row : repository.countQueuedByInstitute()) institutes.add((String) row[0]);
        for (AiCallLane lane : laneRepository.findAll()) institutes.add(lane.getInstituteId());
        // The snapshot is passed in, not taken per lane: the dynamic cap is derived from
        // live occupancy, so lanes read at different instants could disagree about what
        // the same fleet allows.
        Map<String, String> names = directory.instituteNames(institutes);
        Map<String, Instant> oldest = new HashMap<>();
        for (Object[] row : repository.findOldestQueuedPerInstitute()) {
            oldest.put((String) row[0], (Instant) row[1]);
        }
        for (String instituteId : institutes) {
            out.add(laneView(instituteId, snap, names, oldest));
        }
        return out;
    }


    // ── helpers ─────────────────────────────────────────────────────────────────

    private static String str(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Optional filters arrive as empty strings from query params; the SQL wants NULL. */
    private static String blankToNull(String s) {
        return isBlank(s) ? null : s.trim();
    }
}
