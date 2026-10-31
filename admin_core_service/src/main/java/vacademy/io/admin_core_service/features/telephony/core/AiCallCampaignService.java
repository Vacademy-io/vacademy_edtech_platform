package vacademy.io.admin_core_service.features.telephony.core;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

/**
 * "AI calls first for an audience list." Places an AI call for every eligible lead
 * in an audience; each call's outcome (and the counsellor assignment that follows)
 * is driven by the end-of-call webhook + {@link AiCallOutcomeProcessor}.
 *
 * <p>Dispatch is <b>the shared AI call queue</b>: validation + counting run on the
 * request thread, then every eligible lead is INSERTED into {@code ai_call_queue} in
 * one batch and {@code AiCallQueueDrainJob} dials them as lines free up. Phone numbers
 * are still resolved per lead at call time ({@code parent_mobile} → user profile), so a
 * lead with only a profile number still gets called.
 *
 * <p>What that replaced: a background thread per campaign running its own
 * completion-aware sliding window, sized by a {@code MAX_PARALLEL} constant. That
 * window was per CAMPAIGN, so two institutes running campaigns put twice the intended
 * number of calls on a voice box that carries a fixed few — the overflow came back to
 * leads as a spoken "all lines busy". It also lived in one replica's heap, so a deploy
 * mid-campaign dropped whatever had not dialled yet. The queue is fleet-wide, durable,
 * visible and cancellable; fairness between institutes comes from the per-lane
 * concurrency cap rather than from each campaign politely limiting itself.
 *
 * <p>{@code telephony.ai.queue.enabled=false} restores the old in-memory loop. That is
 * a rollback lever, not a supported mode — it dials without a fleet-wide limit.
 */
@Service
@RequiredArgsConstructor
public class AiCallCampaignService {

    private static final Logger log = LoggerFactory.getLogger(AiCallCampaignService.class);

    private final AudienceResponseRepository audienceResponseRepository;
    private final AudienceRepository audienceRepository;
    private final AiCallingSettingsService settingsService;
    private final AiCallService aiCallService;
    private final vacademy.io.admin_core_service.features.telephony.persistence.repository
            .TelephonyCallLogRepository callLogRepo;

    private final AiCallQueueService queueService;

    // Field-injected (not via @RequiredArgsConstructor) because there are multiple
    // Executor beans and this project's lombok.config doesn't copy @Qualifier onto
    // the generated constructor — by-type injection would be ambiguous. Used by the
    // legacy path only.
    @Autowired
    @Qualifier("aiCallDispatchExecutor")
    private Executor dispatchExecutor;

    /** Rollback lever: false = the pre-queue background sliding window. */
    @Value("${telephony.ai.queue.enabled:true}")
    private boolean queueEnabled;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    /** Gap between consecutive calls in a bulk run, to stay under Aavtaar's rate limit. */
    @Value("${aavtaar.bulk.pace-ms:800}")
    private long paceMs;

    /** A bulk run for the same audience is refused within this window (idempotency —
     *  prevents a re-fire of the same list from double-dialing every lead). */
    @Value("${aavtaar.bulk.cooldown-sec:300}")
    private long bulkCooldownSec;

    public record StartResult(int total, int eligible, boolean dispatched, String message) {}

    /**
     * Legacy cap for calls-in-parallel, and the upper bound still applied to the
     * {@code parallel} request field.
     *
     * <p>Under the queue this number no longer decides anything: how many of this
     * campaign's calls run at once is the institute's LANE capacity, which is a
     * fleet-wide decision made in {@code AiCallCapacityService} rather than something a
     * campaign gets to ask for. The field is accepted and ignored so existing clients
     * keep working.
     */
    public static final int MAX_PARALLEL = 3;

    /** Providers that place AI-agent calls — the dial the cooldown de-duplicates.
     *  Keep in sync with the AI implementations of {@code AiOutboundCaller}. */
    private static final List<String> AI_PROVIDERS =
            List.of(ProviderType.AAVTAAR, ProviderType.VACADEMY_AI, ProviderType.MOCK);

    /**
     * @param actorUserId the admin/counsellor who started the run. Stamped on every
     *        call this campaign places as {@code counsellor_user_id} — outbound rows
     *        are documented (V320) as "the actor who placed the call (always set)",
     *        and the call-log scope filter only rescues an unowned row when it is
     *        INBOUND. Passing null here left bulk calls owned by nobody, so a scoped
     *        counsellor could not see her own campaign in the log while the same
     *        lead dialled one-by-one showed up fine.
     */
    public StartResult startForAudience(String instituteId, String audienceId, boolean dryRun,
                                        String campaignIdOverride, String preferredNumberId,
                                        List<String> responseIds, Integer parallelRequested,
                                        String actorUserId) {
        AiCallingSettingsPojo settings = settingsService.get(instituteId);
        if (!settings.isEnabled()) {
            throw new VacademyException("AI calling is disabled for this institute.");
        }
        // Agent: an explicit chooser pick wins; else the institute default (resolved through the
        // settings resolver so a defaultCampaignId holding an agent NAME maps to the real id).
        String campaignId = !isBlank(campaignIdOverride) ? campaignIdOverride
                : settings.resolveCampaignId(settings.getProvider(), null);
        if (isBlank(campaignId)) {
            throw new VacademyException("No default Campaign ID set in AI Calling settings.");
        }

        // ACTIVE-only, hardcoded: a soft-deleted lead must never be dialled by a bulk campaign.
        List<AudienceResponse> leads = audienceResponseRepository.findActiveByAudienceId(audienceId);
        // Eligible = has a user id; the phone is resolved at call time (parent_mobile
        // first, then the user's profile number), so we don't pre-filter on phone.
        // Optional scope: only the leads the admin check-selected on the list page.
        // Filter SERVER-side against the audience's own rows — the client-sent ids are
        // never trusted to dial outside this audience/institute.
        Set<String> scope = (responseIds == null || responseIds.isEmpty())
                ? null : new HashSet<>(responseIds);
        List<LeadRef> refs = leads.stream()
                .filter(l -> !isBlank(l.getUserId()))
                .filter(l -> scope == null || scope.contains(l.getId()))
                .map(l -> new LeadRef(l.getId(), l.getUserId(), l.getParentMobile()))
                .toList();
        int parallel = Math.max(1, Math.min(MAX_PARALLEL,
                parallelRequested == null ? 1 : parallelRequested));

        if (refs.isEmpty()) {
            return new StartResult(leads.size(), 0, false, "No eligible leads (none have a user id).");
        }

        // Dry run: report the counts the confirm dialog needs, WITHOUT placing any calls.
        // Reports RAW eligibility on purpose. The cooldown below is a dispatch-time
        // guard, NOT an eligibility rule — subtracting it here returned eligible=0 for
        // the whole cooldown window, and the confirm button disables itself on
        // eligible === 0 and renders "no contact number" copy. One campaign therefore
        // left the list looking permanently broken for five minutes.
        if (dryRun) {
            return new StartResult(leads.size(), refs.size(), false,
                    refs.size() + " eligible lead(s) will be called.");
        }

        // Cooldown, applied PER LEAD. The real guarantee we owe is "no lead is dialled
        // twice by a re-fire" — not "this audience is frozen". The audience-level claim
        // below can't tell "call these 10 checked leads" from "call the whole list", so
        // it locked a counsellor out for the full window after working one small
        // selection. Dropping leads already AI-dialled inside the window keeps the
        // anti-double-spend guarantee while letting a DIFFERENT selection through, and
        // it also stops a follow-up whole-list run from re-dialling the subset that was
        // just called (which the audience claim alone never covered).
        List<LeadRef> callable = dropRecentlyAiCalled(instituteId, refs);
        int skippedRecent = refs.size() - callable.size();
        if (callable.isEmpty()) {
            // Logged, not silent: "nothing dialled" must be explainable from the logs.
            log.info("ai-call bulk: audience={} all {} eligible lead(s) already AI-called "
                    + "within the {}s cooldown — nothing dispatched", audienceId, refs.size(), bulkCooldownSec);
            return new StartResult(leads.size(), 0, false,
                    "Every eligible lead here was already AI-called in the last few minutes.");
        }

        // Idempotency for a WHOLE-LIST run: claim this audience for the cooldown window.
        // An atomic conditional UPDATE, so two concurrent/re-fired starts can't both win.
        // Subset runs deliberately don't claim — they're guarded per lead above, and
        // claiming here is what blocked the next selection from the same list.
        boolean claimed = false;
        if (scope == null) {
            if (audienceRepository.tryClaimAiCampaign(audienceId, bulkCooldownSec) == 0) {
                throw new VacademyException(
                        "A bulk AI call for this list was started in the last few minutes — "
                        + "please wait before starting another.");
            }
            claimed = true;
        }

        if (queueEnabled) {
            int queued;
            try {
                queued = queueService.enqueueBatch(instituteId, toRequests(instituteId, callable,
                                campaignId, preferredNumberId), CallTrigger.BULK_MANUAL,
                        AiCallQueueService.SOURCE_BULK, audienceId, actorUserId);
            } catch (RuntimeException e) {
                // Nothing was queued, so the claim must not outlive the attempt —
                // otherwise this list is locked for the full cooldown having placed no calls.
                if (claimed) audienceRepository.releaseAiCampaignClaim(audienceId);
                throw e;
            }
            // Honest up front: the fleet carries a fixed number of simultaneous calls, so
            // a big list is hours of dialing. An admin who can see that can decide to
            // trim the list or cancel; an admin told only "Queued 500" finds out by
            // watching nothing happen.
            long eta = queueService.etaMinutes(instituteId, settings.getProvider(), queued);
            log.info("ai-call bulk: audience={} total={} eligible={} callable={} queued={} (eta ~{} min)",
                    audienceId, leads.size(), refs.size(), callable.size(), queued, eta);
            return new StartResult(leads.size(), queued, queued > 0,
                    "Queued " + queued + " AI call" + (queued == 1 ? "" : "s")
                    + (skippedRecent > 0
                            ? " (" + skippedRecent + " skipped — already called in the last few minutes)"
                            : "")
                    + (eta > 0 ? "; roughly " + formatEta(eta) + " to work through the list" : "")
                    + ". Outcomes arrive as each call finishes.");
        }

        try {
            // The refs are plain records (snapshot) — safe to hand to another thread;
            // no managed JPA entities cross the boundary.
            dispatchExecutor.execute(() -> dispatch(instituteId, audienceId, campaignId,
                    preferredNumberId, callable, parallel, actorUserId));
        } catch (RejectedExecutionException rej) {
            // Nothing was dispatched, so the claim must not outlive the attempt —
            // otherwise this list is locked for the full cooldown having placed no calls.
            if (claimed) audienceRepository.releaseAiCampaignClaim(audienceId);
            throw new VacademyException("Too many AI bulk campaigns are running right now — try again shortly.");
        }

        log.info("ai-call bulk (legacy): audience={} total={} eligible={} callable={} dispatched async (pace={}ms)",
                audienceId, leads.size(), refs.size(), callable.size(), paceMs);
        return new StartResult(leads.size(), callable.size(), true,
                "Queued " + callable.size() + " AI calls"
                + (skippedRecent > 0
                        ? " (" + skippedRecent + " skipped — already called in the last few minutes)"
                        : "")
                + "; outcomes will arrive via the webhook.");
    }

    /** One queue request per eligible lead. Mirrors what the legacy loop built per call. */
    private List<AiCallRequestDTO> toRequests(String instituteId, List<LeadRef> refs,
                                              String campaignId, String preferredNumberId) {
        List<AiCallRequestDTO> out = new ArrayList<>(refs.size());
        for (LeadRef ref : refs) {
            AiCallRequestDTO req = new AiCallRequestDTO();
            req.setInstituteId(instituteId);
            req.setUserId(ref.userId());
            req.setPhoneNumber(ref.phone());   // may be blank → placeCall resolves from profile
            req.setResponseId(ref.responseId());
            req.setCampaignId(campaignId);
            req.setPreferredNumberId(preferredNumberId);
            out.add(req);
        }
        return out;
    }

    /** "2 h 40 min" reads better than "160 minutes" on a campaign confirmation. */
    private static String formatEta(long minutes) {
        if (minutes < 60) return minutes + " min";
        long hours = minutes / 60;
        long rest = minutes % 60;
        return rest == 0 ? hours + " h" : hours + " h " + rest + " min";
    }

    /**
     * Drop leads that already received an AI call inside the campaign cooldown window,
     * so a re-fire (whole list or overlapping selection) never dials — or bills — the
     * same lead twice.
     */
    private List<LeadRef> dropRecentlyAiCalled(String instituteId, List<LeadRef> refs) {
        if (bulkCooldownSec <= 0) return refs;
        java.sql.Timestamp since = java.sql.Timestamp.from(
                java.time.Instant.now().minusSeconds(bulkCooldownSec));
        Set<String> recentlyCalled = new HashSet<>(
                callLogRepo.findAiCalledUserIdsSince(instituteId, since, AI_PROVIDERS));
        if (recentlyCalled.isEmpty()) return refs;
        return refs.stream().filter(r -> !recentlyCalled.contains(r.userId())).toList();
    }

    /** Grace before a never-terminal call stops occupying a parallel slot (webhook
     *  lost / provider never called back). Generous: max call is typically 6-10 min. */
    private static final long STUCK_CALL_MS = 12 * 60_000L;
    /** Small gap between dial-outs inside the window — avoids a Plivo CPS burst. */
    private static final long INTER_DIAL_GAP_MS = 3_000L;
    /** How often the runner re-checks in-flight calls for completion. */
    private static final long POLL_MS = 4_000L;

    /**
     * Background worker: COMPLETION-AWARE sliding window. Keeps at most
     * {@code parallel} calls in flight; when one reaches a terminal status (polled
     * off telephony_call_log — the webhooks land regardless of this thread) the next
     * lead dials. The previous fixed-pace loop (800ms between dials) effectively
     * dialed the whole list near-simultaneously and let the voice box's busy-cap
     * shed the overflow — callers got "busy" instead of a queued call.
     */
    private void dispatch(String instituteId, String audienceId, String campaignId,
                          String preferredNumberId, List<LeadRef> refs, int parallel,
                          String actorUserId) {
        Deque<LeadRef> queue = new ArrayDeque<>(refs);
        Map<String, Long> inFlight = new LinkedHashMap<>(); // callLogId -> dialedAtMs
        int placed = 0, failed = 0, skipped = 0;
        try {
            while (!queue.isEmpty() || !inFlight.isEmpty()) {
                // Reap finished/stuck calls to free window slots.
                if (!inFlight.isEmpty()) {
                    List<String> ids = new ArrayList<>(inFlight.keySet());
                    for (var row : callLogRepo.findAllById(ids)) {
                        if (CallStatus.parseOrDefault(row.getStatus()).isTerminal()) {
                            inFlight.remove(row.getId());
                        }
                    }
                    long now = System.currentTimeMillis();
                    inFlight.entrySet().removeIf(e -> {
                        boolean stuck = now - e.getValue() > STUCK_CALL_MS;
                        if (stuck) log.warn("ai-call bulk: call {} never went terminal — freeing its slot", e.getKey());
                        return stuck;
                    });
                }
                // Fill the window.
                while (inFlight.size() < parallel && !queue.isEmpty()) {
                    LeadRef ref = queue.poll();
                    AiCallRequestDTO req = new AiCallRequestDTO();
                    req.setInstituteId(instituteId);
                    req.setUserId(ref.userId());
                    req.setPhoneNumber(ref.phone());   // may be blank → placeCall resolves from profile
                    req.setResponseId(ref.responseId());
                    req.setCampaignId(campaignId);
                    req.setPreferredNumberId(preferredNumberId);
                    try {
                        // Actor-owned, exactly like the one-off "Click to AI call" path —
                        // so the starter (and their manager, via hierarchy scope) sees
                        // these rows in the call log.
                        // BULK_MANUAL: a person picked these leads and pressed Call, so the
                        // already-assigned guard must not apply — on a counsellor's own
                        // list EVERY lead is assigned to her, which silently reduced the
                        // whole campaign to zero dials while still reporting "Queued N".
                        // The daily cap and the duplicate window still apply: bounding a
                        // fan-out is exactly what those two are for.
                        var resp = aiCallService.placeCall(req, actorUserId, CallTrigger.BULK_MANUAL);
                        // Only a call the provider accepted is "placed". The 30s dedup
                        // returns dispatched=false with no call-log row, and a provider
                        // rejection returns a FAILED row — counting either as placed made
                        // the DONE line claim calls that never happened, which is exactly
                        // the number you reach for when asking "why did only some leads
                        // get called?". In-flight tracking is unchanged: a FAILED row is
                        // terminal and frees its slot on the next poll either way.
                        if (resp != null && resp.isDispatched()) {
                            placed++;
                        } else if (resp != null && !isBlank(resp.getCallLogId())) {
                            failed++;
                        } else {
                            skipped++;
                        }
                        if (resp != null && !isBlank(resp.getCallLogId())) {
                            inFlight.put(resp.getCallLogId(), System.currentTimeMillis());
                        }
                    } catch (Exception e) {
                        failed++;
                        log.warn("ai-call bulk: failed for lead {} in audience {}: {}",
                                ref.responseId(), audienceId, e.getMessage());
                    }
                    if (!queue.isEmpty() && inFlight.size() < parallel) {
                        Thread.sleep(INTER_DIAL_GAP_MS);
                    }
                }
                if (queue.isEmpty() && inFlight.isEmpty()) break;
                Thread.sleep(POLL_MS);
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("ai-call bulk: interrupted for audience {} after {} placed", audienceId, placed);
        }
        log.info("ai-call bulk DONE: audience={} eligible={} placed={} failed={} skipped={} parallel={}",
                audienceId, refs.size(), placed, failed, skipped, parallel);
    }

    /**
     * Live rows for the campaign progress dialog: every AI call placed for THIS
     * audience's leads since the run began, with the latest disposition when the
     * report has landed. Institute-scoped in SQL — the audience join means a caller
     * can never read another institute's calls even with a guessed audience id.
     */
    @SuppressWarnings("unchecked")
    public List<java.util.Map<String, Object>> campaignCallStatuses(
            String instituteId, String audienceId, long sinceEpochMs) {
        var rows = entityManager.createNativeQuery(
                "SELECT t.id, t.response_id, t.status, t.duration_seconds, "
                + "       t.created_at, "
                + "       (SELECT r.disposition FROM ai_call_result r "
                + "         WHERE r.call_log_id = t.id AND r.disposition IS NOT NULL "
                + "         ORDER BY r.created_at DESC LIMIT 1) AS disposition "
                + "FROM telephony_call_log t "
                + "JOIN audience_response ar ON ar.id = t.response_id "
                + "WHERE ar.audience_id = :audienceId "
                + "  AND t.institute_id = :instituteId "
                + "  AND t.created_at >= :since "
                + "ORDER BY t.created_at")
                .setParameter("audienceId", audienceId)
                .setParameter("instituteId", instituteId)
                .setParameter("since", new java.sql.Timestamp(sinceEpochMs))
                .getResultList();
        List<java.util.Map<String, Object>> out = new ArrayList<>();
        for (Object rowObj : (List<Object[]>) rows) {
            Object[] r = (Object[]) rowObj;
            java.util.Map<String, Object> m = new LinkedHashMap<>();
            m.put("callLogId", r[0]);
            m.put("responseId", r[1]);
            m.put("status", r[2]);
            m.put("durationSeconds", r[3]);
            m.put("createdAt", r[4] == null ? null : r[4].toString());
            m.put("disposition", r[5]);
            out.add(m);
        }
        return out;
    }

    private record LeadRef(String responseId, String userId, String phone) {}

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
