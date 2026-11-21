package vacademy.io.admin_core_service.features.engagement.service;

import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEnums;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementItem;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * Decides whether a slot is open, revealed, upcoming or catchable — purely from
 * timestamps, evaluated at read time.
 *
 * No job ever flips a slot's state. Jobs that own visibility mean missed fires on
 * deploy, double fires across replicas, and a replay storm after downtime; the only
 * things scheduled in this feature are the push notification and the streak close.
 */
@Service
public class EngagementScheduleResolver {

    /** Where a slot sits relative to now, for one specific local date. */
    public enum SlotState {
        /** Before start_time — visible as a locked card, payload withheld. */
        UPCOMING,
        /** Inside [start_time, end_time) — attemptable for full points. */
        OPEN,
        /** Past end_time, still inside the catch-up window — attemptable, possibly reduced. */
        CATCH_UP,
        /** Past end_time with no catch-up left. */
        CLOSED
    }

    /** Does this slot run on the given local date? */
    public boolean runsOn(EngagementSlot slot, LocalDate date) {
        if (date.isBefore(slot.getStartDate())) return false;
        if (date.isAfter(slot.effectiveEndDate())) return false;
        Integer mask = slot.getDowMask();
        if (mask == null || mask == 0) return true;
        // DayOfWeek: MONDAY=1..SUNDAY=7 -> bit 1,2,4,...,64
        int bit = 1 << (date.getDayOfWeek().getValue() - 1);
        return (mask & bit) != 0;
    }

    /** The most recent local date on or before {@code onOrBefore} that this slot runs. */
    public LocalDate mostRecentRunDate(EngagementSlot slot, LocalDate onOrBefore) {
        LocalDate cursor = onOrBefore.isAfter(slot.effectiveEndDate())
                ? slot.effectiveEndDate()
                : onOrBefore;
        // Bounded walk: at most a week back covers any day-of-week mask.
        for (int i = 0; i < 7; i++) {
            if (cursor.isBefore(slot.getStartDate())) return null;
            if (runsOn(slot, cursor)) return cursor;
            cursor = cursor.minusDays(1);
        }
        return null;
    }

    public ZoneId zoneOf(EngagementPlan plan) {
        return InstituteTimezoneService.safeZone(plan.getTimezone());
    }

    /** Local "now" in the plan's timezone. */
    public ZonedDateTime nowIn(EngagementPlan plan) {
        return ZonedDateTime.now(zoneOf(plan));
    }

    /**
     * State of a slot for a specific run date, evaluated against the plan's timezone.
     * {@code runDate} must be a date the slot actually runs on.
     */
    public SlotState stateOn(EngagementPlan plan, EngagementSlot slot, EngagementItem item, LocalDate runDate) {
        return stateOn(plan, slot, item, runDate, nowIn(plan));
    }

    /**
     * Same, with "now" supplied — every branch here is a time comparison, so the clock
     * is a parameter rather than a hidden call. That is what makes this testable.
     */
    public SlotState stateOn(EngagementPlan plan, EngagementSlot slot, EngagementItem item,
                             LocalDate runDate, ZonedDateTime now) {
        ZoneId zone = zoneOf(plan);
        ZonedDateTime opensAt = LocalDateTime.of(runDate, slot.getStartTime()).atZone(zone);
        ZonedDateTime closesAt = LocalDateTime.of(runDate, slot.getEndTime()).atZone(zone);

        if (now.isBefore(opensAt)) return SlotState.UPCOMING;
        if (now.isBefore(closesAt)) return SlotState.OPEN;

        EngagementEnums.MissPolicy policy = resolveMissPolicy(plan, item);
        if (policy == EngagementEnums.MissPolicy.EXPIRES) return SlotState.CLOSED;

        int days = resolveCatchUpDays(plan, item);
        if (days <= 0) return SlotState.CLOSED;
        return now.isBefore(closesAt.plusDays(days)) ? SlotState.CATCH_UP : SlotState.CLOSED;
    }

    /** Have answers and the leaderboard been released for this run date? */
    public boolean isRevealed(EngagementPlan plan, EngagementSlot slot, LocalDate runDate) {
        return isRevealed(plan, slot, runDate, nowIn(plan));
    }

    public boolean isRevealed(EngagementPlan plan, EngagementSlot slot, LocalDate runDate,
                              ZonedDateTime now) {
        ZonedDateTime revealAt =
                LocalDateTime.of(runDate, slot.effectiveRevealTime()).atZone(zoneOf(plan));
        return !now.isBefore(revealAt);
    }

    /** Item override, else the plan default. */
    public EngagementEnums.MissPolicy resolveMissPolicy(EngagementPlan plan, EngagementItem item) {
        String raw = (item != null && item.getMissPolicy() != null && !item.getMissPolicy().isBlank())
                ? item.getMissPolicy()
                : plan.getDefaultMissPolicy();
        try {
            return EngagementEnums.MissPolicy.valueOf(raw);
        } catch (Exception e) {
            return EngagementEnums.MissPolicy.EXPIRES;
        }
    }

    public int resolveCatchUpDays(EngagementPlan plan, EngagementItem item) {
        if (item != null && item.getCatchUpDays() != null) return item.getCatchUpDays();
        return plan.getDefaultCatchUpDays() == null ? 0 : plan.getDefaultCatchUpDays();
    }

    /**
     * Percentage of points a late completion keeps. CATCH_UP_FULL is 100; a
     * CATCH_UP_REDUCED item with no percent configured defaults to half.
     */
    public int resolveCatchUpPercent(EngagementPlan plan, EngagementItem item) {
        EngagementEnums.MissPolicy policy = resolveMissPolicy(plan, item);
        if (policy == EngagementEnums.MissPolicy.CATCH_UP_FULL) return 100;
        if (policy == EngagementEnums.MissPolicy.EXPIRES) return 0;
        if (item != null && item.getCatchUpPercent() != null) return clampPercent(item.getCatchUpPercent());
        if (plan.getDefaultCatchUpPercent() != null) return clampPercent(plan.getDefaultCatchUpPercent());
        return 50;
    }

    private int clampPercent(int value) {
        return Math.max(0, Math.min(100, value));
    }
}
