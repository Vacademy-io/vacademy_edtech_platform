package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementPlan;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementSlot;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementPlanRepository;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Plans scheduled in "days after joining" (schedule_mode RELATIVE).
 *
 * Each learner has their own Day 1: the later of the date they joined the batch and
 * the date the plan was first published — so learners already in the batch when a
 * plan goes live start it that day, and later joiners start on their join day. A
 * RELATIVE slot says "Day 3 to Day 5"; for one learner it is shifted onto real dates
 * (Day 1 + 2 .. Day 1 + 4) and from then on every existing rule — open/close,
 * catch-up, reveal, history — runs unchanged on the shifted copy.
 *
 * Stored RELATIVE slots keep a virtual calendar (Day 1 = {@link #VIRTUAL_DAY_ONE}) in
 * start_date/end_date so NOT NULL constraints and ordering hold.
 */
@Service
@RequiredArgsConstructor
public class EngagementRelativeSchedule {

    public static final LocalDate VIRTUAL_DAY_ONE = LocalDate.of(2000, 1, 1);

    private final EngagementPlanRepository planRepository;
    private final EngagementScheduleResolver scheduleResolver;

    /** Day 1 for a learner who joined at {@code joinedAt} (null = unknown → publish day). */
    public LocalDate dayOne(EngagementPlan plan, Timestamp joinedAt) {
        ZoneId zone = scheduleResolver.zoneOf(plan);
        Timestamp published = plan.getPublishedAt() != null ? plan.getPublishedAt() : plan.getCreatedAt();
        LocalDate start = published == null ? LocalDate.now(zone) : published.toInstant().atZone(zone).toLocalDate();
        if (joinedAt == null) return start;
        LocalDate joined = joinedAt.toInstant().atZone(zone).toLocalDate();
        return joined.isAfter(start) ? joined : start;
    }

    /** Day 1 per plan id for one learner, across the given plans (RELATIVE ones only). */
    public Map<String, LocalDate> dayOnesForUser(String userId, Collection<EngagementPlan> plans) {
        Map<String, LocalDate> out = new HashMap<>();
        List<String> batches = new ArrayList<>();
        for (EngagementPlan p : plans) if (p.isRelative()) batches.add(p.getPackageSessionId());
        if (batches.isEmpty()) return out;
        Map<String, Timestamp> joined = new HashMap<>();
        for (Object[] row : planRepository.findJoinDatesForUser(userId, batches)) {
            joined.put((String) row[0], toTimestamp(row[1]));
        }
        for (EngagementPlan p : plans) {
            if (!p.isRelative()) continue;
            out.put(p.getId(), dayOne(p, joined.get(p.getPackageSessionId())));
        }
        return out;
    }

    /** Day 1 per learner for one RELATIVE plan. */
    public Map<String, LocalDate> dayOnesForBatch(EngagementPlan plan) {
        Map<String, LocalDate> out = new HashMap<>();
        for (Object[] row : planRepository.findJoinDatesForBatch(plan.getPackageSessionId())) {
            out.put((String) row[0], dayOne(plan, toTimestamp(row[1])));
        }
        return out;
    }

    /**
     * The slot on real dates for a learner whose Day 1 is {@code dayOne}. CALENDAR plans'
     * slots are returned as they are.
     */
    public EngagementSlot localize(EngagementPlan plan, EngagementSlot slot, LocalDate dayOne) {
        if (plan == null || !plan.isRelative() || dayOne == null) return slot;
        int startDay = slot.getStartDay() != null ? slot.getStartDay() : 1;
        int endDay = slot.getEndDay() != null ? slot.getEndDay() : startDay;
        return slot.shiftedCopy(dayOne.plusDays(startDay - 1L), dayOne.plusDays(endDay - 1L));
    }

    /** Virtual start/end dates stored for a RELATIVE slot. */
    public static LocalDate virtualDate(int day) {
        return VIRTUAL_DAY_ONE.plusDays(Math.max(1, day) - 1L);
    }

    private static Timestamp toTimestamp(Object o) {
        if (o == null) return null;
        if (o instanceof Timestamp t) return t;
        if (o instanceof java.util.Date d) return new Timestamp(d.getTime());
        if (o instanceof java.time.Instant i) return Timestamp.from(i);
        if (o instanceof java.time.LocalDateTime l) return Timestamp.valueOf(l);
        return null;
    }
}
