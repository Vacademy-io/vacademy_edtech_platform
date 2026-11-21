package vacademy.io.admin_core_service.features.enrolment_break.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.enrolment_break.entity.EnrolmentBreak;
import vacademy.io.admin_core_service.features.enrolment_break.repository.EnrolmentBreakRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The one question every reminder sender and billing job asks: "is this learner on a break that
 * stops this?" (docs/ENROLMENT_BREAKS.md).
 *
 * <p>All live (ACTIVE or SCHEDULED) breaks are held in memory and reloaded at most once a minute (the table is small:
 * only learners on a break have rows). An institute with no active break is answered from that
 * snapshot without touching the database, so every institute that never uses breaks keeps exactly
 * its old behaviour. Writes on this pod refresh the snapshot at once; other pods see a change
 * within a minute.
 *
 * <p>Every method is fail-open: if the lookup fails, nothing is held back and nothing is skipped.
 */
@Slf4j
@Component
public class EnrolmentBreakGuard {

    public enum Category { CLASS, FEE }

    private static final long TTL_MS = 60_000L;

    private final EnrolmentBreakRepository repository;
    private final InstituteTimezoneService timezoneService;

    private volatile Snapshot snapshot = new Snapshot(List.of(), 0L);
    private final Map<String, ZoneId> zoneCache = new ConcurrentHashMap<>();

    @Autowired
    public EnrolmentBreakGuard(EnrolmentBreakRepository repository, InstituteTimezoneService timezoneService) {
        this.repository = repository;
        this.timezoneService = timezoneService;
    }

    private record Snapshot(List<EnrolmentBreak> active, long loadedAt) {}

    /** Drop the snapshot so the next check reloads it (call after any write). */
    public void invalidate() {
        snapshot = new Snapshot(snapshot.active(), 0L);
    }

    private List<EnrolmentBreak> active() {
        Snapshot s = snapshot;
        if (System.currentTimeMillis() - s.loadedAt() < TTL_MS) return s.active();
        synchronized (this) {
            s = snapshot;
            if (System.currentTimeMillis() - s.loadedAt() < TTL_MS) return s.active();
            try {
                List<EnrolmentBreak> rows = List.copyOf(repository.findByStatusIn(List.of(EnrolmentBreak.STATUS_ACTIVE, EnrolmentBreak.STATUS_SCHEDULED)));
                snapshot = new Snapshot(rows, System.currentTimeMillis());
            } catch (Exception e) {
                // Fail open: keep the last good snapshot, retry in a minute.
                log.warn("[enrolment-break] could not load active breaks: {}", e.getMessage());
                snapshot = new Snapshot(s.active(), System.currentTimeMillis());
            }
            return snapshot.active();
        }
    }

    /** The institute's time zone (cached; settings rarely change). */
    public ZoneId zone(String instituteId) {
        return instituteId == null ? InstituteTimezoneService.DEFAULT_ZONE
                : zoneCache.computeIfAbsent(instituteId, timezoneService::getZone);
    }

    /** Today in the institute's own time zone (breaks are whole days). */
    public LocalDate today(String instituteId) {
        return LocalDate.now(zone(instituteId));
    }

    /** Cheap: true when any institute has a live break (false = nothing anywhere to check). */
    public boolean anyLive() {
        return !active().isEmpty();
    }

    /**
     * Fee reminder check when only the membership is known (no institute): true when a live break
     * on this plan stops fee reminders today, or the plan is paused.
     */
    public boolean isPlanFeeHeld(String userPlanId) {
        if (userPlanId == null) return false;
        try {
            for (EnrolmentBreak b : active()) {
                if (!userPlanId.equals(b.getUserPlanId())) continue;
                if (b.isPause() && EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus())) return true;
                if (b.isStopFeeReminders() && b.covers(today(b.getInstituteId()))) return true;
            }
        } catch (Exception e) {
            log.warn("[enrolment-break] plan fee-hold check failed for {}: {}", userPlanId, e.getMessage());
        }
        return false;
    }

    /** Cheap: true when this institute has at least one live (active or scheduled) break. */
    public boolean instituteHasActiveBreaks(String instituteId) {
        if (instituteId == null) return false;
        for (EnrolmentBreak b : active()) {
            if (instituteId.equals(b.getInstituteId())) return true;
        }
        return false;
    }

    /**
     * True when a break of this learner at this institute stops messages of this category today.
     * {@code packageSessionId} / {@code userPlanId} narrow it when the message is about one course;
     * pass null when the message is not tied to a course (then any break of the learner counts).
     */
    public boolean isHeld(String instituteId, String userId, Category category,
                          String packageSessionId, String userPlanId) {
        if (instituteId == null || userId == null || category == null) return false;
        try {
            List<EnrolmentBreak> all = active();
            if (all.isEmpty()) return false;
            LocalDate today = null;
            for (EnrolmentBreak b : all) {
                if (!instituteId.equals(b.getInstituteId()) || !userId.equals(b.getUserId())) continue;
                if (category == Category.CLASS ? !b.isStopClassReminders() : !b.isStopFeeReminders()) continue;
                if (!appliesToCourse(b, packageSessionId, userPlanId)) continue;
                if (today == null) today = today(instituteId);
                if (b.covers(today)) return true;
            }
            return false;
        } catch (Exception e) {
            log.warn("[enrolment-break] hold check failed for {}: {}", userId, e.getMessage());
            return false;
        }
    }

    /**
     * Removes held learners from a list of recipients. {@code userIdOf} reads a recipient's user
     * id (null ids are kept). Returns the same list object when nothing is held.
     */
    public <T> List<T> withoutHeld(String instituteId, Category category, String packageSessionId,
                                   List<T> recipients, Function<T, String> userIdOf) {
        if (recipients == null || recipients.isEmpty() || !instituteHasActiveBreaks(instituteId)) return recipients;
        Set<String> held = new HashSet<>();
        for (T r : recipients) {
            String uid = userIdOf.apply(r);
            if (uid != null && isHeld(instituteId, uid, category, packageSessionId, null)) held.add(uid);
        }
        if (held.isEmpty()) return recipients;
        log.info("[enrolment-break] {} {} reminder(s) held at institute {}", held.size(), category, instituteId);
        return recipients.stream()
                .filter(r -> { String uid = userIdOf.apply(r); return uid == null || !held.contains(uid); })
                .collect(Collectors.toList());
    }

    /**
     * The break category a workflow run belongs to, from the event that fired it: live-class
     * events are CLASS, the membership-expiry reminder is FEE. Anything else (scheduled runs,
     * hand-started runs, every other event) returns null and is never held here; scheduled fee
     * reminders are filtered where their recipients are queried.
     */
    public static Category categoryForWorkflow(Map<String, Object> context) {
        if (context == null) return null;
        Object event = context.get("triggerEvents");
        if (event == null) return null;
        String name = String.valueOf(event).trim();
        return switch (name) {
            case "LIVE_SESSION_START", "LIVE_SESSION_END" -> Category.CLASS;
            case "MEMBERSHIP_EXPIRY" -> Category.FEE;
            default -> null;
        };
    }

    /** Fee/renewal reminder check for one membership: breaks on the plan, or the learner's all-course hold. */
    public boolean isFeeHeldForPlan(String instituteId, String userId, String userPlanId) {
        if (!anyLive()) return false;
        return isPlanFeeHeld(userPlanId)
                || (instituteId != null && userId != null && isHeld(instituteId, userId, Category.FEE, null, userPlanId));
    }

    /** True when the plan is under an active pause: charging, renewal and expiry skip it. */
    public boolean isPlanPaused(String userPlanId) {
        if (userPlanId == null) return false;
        try {
            for (EnrolmentBreak b : active()) {
                if (b.isPause() && userPlanId.equals(b.getUserPlanId())
                        && (EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus()) || b.covers(today(b.getInstituteId())))) {
                    return true;
                }
            }
        } catch (Exception e) {
            log.warn("[enrolment-break] pause check failed for plan {}: {}", userPlanId, e.getMessage());
        }
        return false;
    }

    /** True when an active pause has switched this learner's access to this course off. */
    public boolean isCourseAccessPaused(String userId, String packageSessionId) {
        if (userId == null || packageSessionId == null) return false;
        try {
            for (EnrolmentBreak b : active()) {
                if (b.isPause() && b.isRemoveAccess() && EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus())
                        && userId.equals(b.getUserId()) && packageSessionId.equals(b.getPackageSessionId())) {
                    return true;
                }
            }
        } catch (Exception e) {
            log.warn("[enrolment-break] access-pause check failed for {}: {}", userId, e.getMessage());
        }
        return false;
    }

    /** The subset of these plans that are paused. */
    public Set<String> pausedPlanIds(Collection<String> userPlanIds) {
        Set<String> out = new HashSet<>();
        if (userPlanIds == null || userPlanIds.isEmpty()) return out;
        for (String id : userPlanIds) if (isPlanPaused(id)) out.add(id);
        return out;
    }

    private static boolean appliesToCourse(EnrolmentBreak b, String packageSessionId, String userPlanId) {
        if (b.getPackageSessionId() == null) return true;           // every course of the learner
        if (packageSessionId == null && userPlanId == null) return true; // message not tied to a course
        if (packageSessionId != null && packageSessionId.equals(b.getPackageSessionId())) return true;
        return userPlanId != null && userPlanId.equals(b.getUserPlanId());
    }
}
