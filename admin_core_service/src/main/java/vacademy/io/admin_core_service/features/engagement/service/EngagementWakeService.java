package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * B4: CRM activity wakes the engine for that lead. A note, a follow-up, a status or owner change,
 * a re-enquiry, an AI call outcome or a finished call analysis asks for a look at the person's
 * live members within minutes, instead of at the engine's next scheduled look (72 h and more,
 * stretched further for a quiet lead). A new form lead is enrolled the same way.
 *
 * <p>Requests are queued after the writer commits (a rolled-back save wakes nobody) and drained
 * every few seconds on one thread, off the request path; a wake failure never touches the CRM
 * write. The queue is per pod and in memory: a request lost to a restart only delays that lead to
 * its next scheduled look, where the fingerprint's CRM bands still see the change.
 *
 * <p>Bulk guard: one person (or one system source) waking more than {@code cap} leads within the
 * window is a bulk change, not a conversation, and wakes none of them: each sees the change at its
 * next normal look. Per-event sources (an AI call ending, an analysis finishing, a follow-up going
 * overdue) are one real thing per lead and are not capped.
 *
 * <p>The wake time is a lease or more out (see EngagementMemberRepository.wake), so it never cuts a
 * running decision short; several events in that time make one decision.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class EngagementWakeService {

    public static final String NOTE = "NOTE";
    public static final String HUMAN_CALL = "HUMAN_CALL";
    public static final String FOLLOWUP = "FOLLOWUP";
    public static final String FOLLOWUP_OVERDUE = "FOLLOWUP_OVERDUE";
    public static final String STATUS = "STATUS";
    public static final String OWNER_CHANGED = "OWNER_CHANGED";
    public static final String RE_ENQUIRY = "RE_ENQUIRY";
    public static final String LIST_CHANGED = "LIST_CHANGED";
    public static final String PAYMENT = "PAYMENT";
    public static final String AI_CALL = "AI_CALL";
    public static final String CALL_ANALYZED = "CALL_ANALYZED";
    /** Not a wake: a lead that just landed is enrolled into the engines targeting its list. */
    public static final String NEW_LEAD = "NEW_LEAD";
    /** Not a wake (L7): a lead moved to another list leaves the old list's engines, joins the new one's. */
    public static final String LEAD_MOVED = "LEAD_MOVED";

    /** One real thing that happened to one lead: never a bulk edit, so never capped. */
    static final Set<String> UNCAPPED = Set.of(AI_CALL, CALL_ANALYZED, FOLLOWUP_OVERDUE);

    /** Beyond this many queued requests something is wrong upstream; drop rather than grow. */
    static final int MAX_QUEUED = 20_000;

    /**
     * Who the activity is about (any of lead row, account, lead profile, enquiry or call; the
     * drain resolves them to members), what it was, whether a person spoke to or wrote about the
     * lead, and who did it (the bulk guard counts per actor).
     */
    public record WakeRequest(String instituteId, String leadRowId, String userId, String profileId,
                              String enquiryId, String callLogId, String reason, boolean human,
                              String actorKey) {
        String subjectKey() {
            return leadRowId + "|" + userId + "|" + profileId + "|" + enquiryId + "|" + callLogId;
        }
    }

    private record Queued(WakeRequest request, long queuedAtMs) {}

    private final EngagementWakeDao dao;
    private final EngagementMemberRepository memberRepository;
    private final EngagementEngineService engineService;
    private final EngagementLeadMoveService moveService;

    private final ConcurrentLinkedQueue<Queued> queue = new ConcurrentLinkedQueue<>();
    private final AtomicInteger queued = new AtomicInteger();
    /** Bulk guard windows, actor → {window start ms, leads counted}. Touched by the drain thread only. */
    private final Map<String, long[]> windows = new HashMap<>();

    @Value("${engagement.wake.enabled:true}")
    private boolean enabled = true;

    @Value("${engagement.wake.bulk-cap:50}")
    private int bulkCap = 50;

    @Value("${engagement.wake.bulk-window-minutes:5}")
    private int bulkWindowMinutes = 5;

    /** Must be at least the sweep lease: a wake earlier than a lease end would cut it short. */
    @Value("${engagement.sweep.lease-minutes:15}")
    private int leaseMinutes = 15;

    @Value("${engagement.wake.jitter-minutes:5}")
    private int jitterMinutes = 5;

    /**
     * A request waits this long before it is drained. Journey events commit in their own
     * transaction (REQUIRES_NEW) ahead of the caller's, so the lead row they name may not be
     * visible yet; a few seconds covers it.
     */
    @Value("${engagement.wake.settle-ms:5000}")
    private long settleMs = 5000;

    /** Set while the engine itself writes to the CRM (B6 actions): those writes must not wake it. */
    private static final ThreadLocal<Boolean> SUPPRESSED = ThreadLocal.withInitial(() -> false);

    /** Run a CRM write the engine makes (a follow-up, a status change) without waking the engine. */
    public static <T> T withoutWakes(java.util.function.Supplier<T> work) {
        boolean before = SUPPRESSED.get();
        SUPPRESSED.set(true);
        try {
            return work.get();
        } finally {
            SUPPRESSED.set(before);
        }
    }

    /** Queue a wake; when called inside a transaction, only once it commits. Never throws. */
    public void request(WakeRequest r) {
        if (!enabled || r == null || r.reason() == null || SUPPRESSED.get()) return;
        try {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        enqueue(r);
                    }
                });
            } else {
                enqueue(r);
            }
        } catch (Exception e) {
            log.warn("Engagement wake not queued ({}): {}", r.reason(), e.getMessage());
        }
    }

    /** A system event on one lead (AI call ended, follow-up overdue). */
    public void wakeLead(String instituteId, String leadRowId, String userId, String reason, boolean human) {
        request(new WakeRequest(instituteId, leadRowId, userId, null, null, null, reason, human,
                "SYSTEM:" + reason));
    }

    /** L7: the lead row now sits in another list (its audience_id was changed and is being saved). */
    public void leadMoved(String instituteId, String leadRowId, String actorUserId) {
        request(new WakeRequest(instituteId, leadRowId, null, null, null, null, LEAD_MOVED, false,
                actorUserId != null ? "user:" + actorUserId : "SYSTEM:" + LEAD_MOVED));
    }

    /** ai_service finished analysing a call (whether a person or an AI agent made it is read from the call). */
    public void callAnalyzed(String instituteId, String callLogId) {
        request(new WakeRequest(instituteId, null, null, null, null, callLogId, CALL_ANALYZED, true,
                "SYSTEM:" + CALL_ANALYZED));
    }

    private void enqueue(WakeRequest r) {
        if (queued.incrementAndGet() > MAX_QUEUED) {
            queued.decrementAndGet();
            log.warn("Engagement wake queue full — dropping {} for {}", r.reason(), r.subjectKey());
            return;
        }
        queue.add(new Queued(r, System.currentTimeMillis()));
    }

    @Scheduled(fixedDelayString = "${engagement.wake.drain-ms:15000}")
    public void drain() {
        drain(System.currentTimeMillis());
    }

    /** Drains what has settled. Returns how many requests were applied (bulk-dropped ones excluded). */
    int drain(long nowMs) {
        List<WakeRequest> batch = new ArrayList<>();
        Queued head;
        while ((head = queue.peek()) != null && head.queuedAtMs() <= nowMs - settleMs) {
            if (queue.remove(head)) {
                queued.decrementAndGet();
                batch.add(head.request());
            }
        }
        if (batch.isEmpty()) return 0;

        // Per actor and institute, distinct leads only (a note + status change + follow-up on one
        // lead is one lead), first reason kept per lead.
        Map<String, Map<String, WakeRequest>> groups = new LinkedHashMap<>();
        for (WakeRequest r : batch) {
            r = withInstitute(r);
            String group = Objects.toString(r.instituteId(), "?") + "|" + Objects.toString(r.actorKey(), "?");
            groups.computeIfAbsent(group, k -> new LinkedHashMap<>()).merge(r.subjectKey(), r, EngagementWakeService::merge);
        }

        windows.values().removeIf(w -> nowMs - w[0] > Duration.ofMinutes(bulkWindowMinutes).toMillis());
        Instant now = Instant.ofEpochMilli(nowMs).truncatedTo(ChronoUnit.MILLIS);
        int applied = 0;
        for (Map.Entry<String, Map<String, WakeRequest>> g : groups.entrySet()) {
            List<WakeRequest> leads = new ArrayList<>(g.getValue().values());
            boolean bulk = overBulkCap(g.getKey(), leads, nowMs);
            if (bulk) {
                log.info("Engagement wake: {} leads from one source ({}) within {} min — a bulk change, none woken; "
                        + "each sees it at its next scheduled look", leads.size(), g.getKey(), bulkWindowMinutes);
            }
            for (WakeRequest r : leads) {
                // A bulk list move still takes the leads out of the old list's engines (no LLM, and it
                // stops messages meant for the old list); only the joins wait for the reconcile.
                if (bulk && !LEAD_MOVED.equals(r.reason())) continue;
                try {
                    applied += apply(r, now, bulk) ? 1 : 0;
                } catch (Exception e) {
                    log.warn("Engagement wake failed ({} on {}): {}", r.reason(), r.subjectKey(), e.getMessage());
                }
            }
        }
        return applied;
    }

    /**
     * The bulk guard counts per institute, so a request that came without one (a journey event
     * written before the lead row was visible, a background job) takes its lead row's.
     */
    private WakeRequest withInstitute(WakeRequest r) {
        if (r.instituteId() != null || r.leadRowId() == null) return r;
        try {
            List<EngagementWakeDao.LeadRow> rows = dao.leadRows(r.leadRowId(), null);
            if (rows.isEmpty() || rows.get(0).instituteId() == null) return r;
            return new WakeRequest(rows.get(0).instituteId(), r.leadRowId(), r.userId(), r.profileId(),
                    r.enquiryId(), r.callLogId(), r.reason(), r.human(), r.actorKey());
        } catch (Exception e) {
            return r;
        }
    }

    /** Two requests for one lead in one drain: one wake, human if either was. */
    private static WakeRequest merge(WakeRequest a, WakeRequest b) {
        if (a.human() || !b.human()) return a;
        return b;
    }

    private boolean overBulkCap(String group, List<WakeRequest> leads, long nowMs) {
        if (leads.stream().allMatch(r -> UNCAPPED.contains(r.reason()))) return false;
        long[] w = windows.computeIfAbsent(group, k -> new long[]{nowMs, 0});
        if (w[1] + leads.size() > bulkCap) {
            w[1] = bulkCap + 1L; // stays a bulk change until the window ends
            return true;
        }
        w[1] += leads.size();
        return false;
    }

    boolean apply(WakeRequest r, Instant now) {
        return apply(r, now, false);
    }

    /** Resolve one request to members and wake them (or enrol / move a lead). True if anyone was. */
    boolean apply(WakeRequest r, Instant now, boolean bulk) {
        if (NEW_LEAD.equals(r.reason())) return enrollNewLead(r);
        if (LEAD_MOVED.equals(r.reason())) return moveLead(r, now, !bulk);

        String instituteId = r.instituteId();
        String reason = r.reason();
        boolean human = r.human();
        Set<String> leadRowIds = new LinkedHashSet<>();
        Set<String> userIds = new LinkedHashSet<>();
        Set<String> phones = new LinkedHashSet<>();
        String leadRowId = r.leadRowId();

        if (r.callLogId() != null) {
            EngagementWakeDao.CallRow call = dao.call(r.callLogId());
            if (call == null) return false;
            // The internal endpoint names the institute; a call from another one is not ours to act on.
            if (instituteId != null && !instituteId.equals(call.instituteId())) return false;
            instituteId = call.instituteId();
            if (call.aiAgent()) {
                human = false;
                if (HUMAN_CALL.equals(reason)) reason = AI_CALL;
            }
            if (leadRowId == null) leadRowId = call.responseId();
            add(userIds, call.userId());
        }

        if (leadRowId != null || r.enquiryId() != null) {
            List<EngagementWakeDao.LeadRow> rows = dao.leadRows(leadRowId, r.enquiryId());
            // A call event is keyed by the account when the call had no lead row.
            if (rows.isEmpty() && leadRowId != null) add(userIds, leadRowId);
            for (EngagementWakeDao.LeadRow row : rows) {
                if (instituteId != null && row.instituteId() != null && !instituteId.equals(row.instituteId())) continue;
                if (instituteId == null) instituteId = row.instituteId();
                leadRowIds.add(row.id());
                add(userIds, row.userId());
                add(userIds, row.studentUserId());
                add(phones, row.phone10());
            }
        }
        if (r.profileId() != null) {
            String[] profile = dao.leadProfile(r.profileId());
            if (profile != null) {
                if (instituteId == null) instituteId = profile[1];
                if (instituteId != null && instituteId.equals(profile[1])) add(userIds, profile[0]);
            }
        }
        add(userIds, r.userId());

        List<String> memberIds = dao.liveMemberIds(instituteId, leadRowIds, userIds, phones);
        if (memberIds.isEmpty()) return false;
        Instant wakeAt = now.plus(Duration.ofMinutes(Math.max(leaseMinutes, 1)
                + ThreadLocalRandom.current().nextLong(Math.max(jitterMinutes, 0) + 1L)));
        int woken = memberRepository.wake(memberIds, now, wakeAt, reason, human, RE_ENQUIRY.equals(reason));
        log.debug("Engagement wake {}: {} member(s) of {} due by {}", reason, woken, r.subjectKey(), wakeAt);
        return woken > 0;
    }

    private boolean enrollNewLead(WakeRequest r) {
        boolean any = false;
        for (EngagementWakeDao.LeadRow row : dao.leadRows(r.leadRowId(), null)) {
            if (row.audienceId() == null || row.instituteId() == null) continue;
            any |= engineService.enrollNewLead(row.instituteId(), row.audienceId(), row.id(), row.userId()) > 0;
        }
        return any;
    }

    private boolean moveLead(WakeRequest r, Instant now, boolean enroll) {
        boolean any = false;
        for (EngagementWakeDao.LeadRow row : dao.leadRows(r.leadRowId(), null)) {
            if (row.audienceId() == null || row.instituteId() == null) continue;
            any |= moveService.leadMoved(row.instituteId(), row.id(), row.audienceId(), row.userId(), enroll, now) > 0;
        }
        return any;
    }

    private static void add(Set<String> set, String v) {
        if (v != null && !v.isBlank()) set.add(v);
    }

    int queuedCount() {
        return queued.get();
    }
}
