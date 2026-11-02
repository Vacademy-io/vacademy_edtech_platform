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
 *
 * A RELATIVE plan with start_trigger CONTENT counts Day 1 from the day the learner
 * completes a chosen subject, module or chapter instead of their join day (still never
 * before the publish day). Until they complete it the plan is not theirs: they have no
 * Day 1, so every caller already leaves them out. Reads never write; the completion
 * moment is frozen by {@code EngagementContentStartJob}.
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

    /**
     * Day 1 per plan id for one learner, across the given plans (RELATIVE ones only).
     * A CONTENT-start plan the learner has not reached yet has no entry: it is not theirs
     * until they complete its start content.
     */
    public Map<String, LocalDate> dayOnesForUser(String userId, Collection<EngagementPlan> plans) {
        Map<String, LocalDate> out = new HashMap<>();
        List<String> batches = new ArrayList<>();
        for (EngagementPlan p : plans) {
            if (p.isContentStart()) {
                LocalDate dayOne = contentDayOneForUser(p, userId);
                if (dayOne != null) out.put(p.getId(), dayOne);
            } else if (p.isRelative()) {
                batches.add(p.getPackageSessionId());
            }
        }
        if (batches.isEmpty()) return out;
        Map<String, Timestamp> joined = new HashMap<>();
        for (Object[] row : planRepository.findJoinDatesForUser(userId, batches)) {
            joined.put((String) row[0], toTimestamp(row[1]));
        }
        for (EngagementPlan p : plans) {
            if (!p.isRelative() || p.isContentStart()) continue;
            out.put(p.getId(), dayOne(p, joined.get(p.getPackageSessionId())));
        }
        return out;
    }

    /**
     * Day 1 per learner for one RELATIVE plan. For a CONTENT-start plan only the learners
     * who have completed its start content are in the map.
     */
    public Map<String, LocalDate> dayOnesForBatch(EngagementPlan plan) {
        Map<String, LocalDate> out = new HashMap<>();
        if (plan.isContentStart()) {
            ContentSource src = ContentSource.of(plan.getStartSourceType());
            if (src == null) return out;
            for (Object[] row : planRepository.findContentStartsForBatch(plan.getId(), plan.getPackageSessionId(),
                    src.source, plan.getStartSourceId(), src.operation, plan.effectiveStartThreshold())) {
                Timestamp startedAt = toTimestamp(row[1]);
                if (row[0] != null && startedAt != null) out.put((String) row[0], dayOne(plan, startedAt));
            }
            return out;
        }
        for (Object[] row : planRepository.findJoinDatesForBatch(plan.getPackageSessionId())) {
            out.put((String) row[0], dayOne(plan, toTimestamp(row[1])));
        }
        return out;
    }

    /**
     * Freeze the completion moment of learners who have just reached a CONTENT-start plan's
     * start content, so their Day 1 stays put when progress is recomputed. Returns the rows
     * written; 0 for any other plan.
     */
    public int freezeContentStarts(EngagementPlan plan) {
        if (!plan.isContentStart()) return 0;
        ContentSource src = ContentSource.of(plan.getStartSourceType());
        if (src == null) return 0;
        return planRepository.freezeContentStarts(plan.getId(), plan.getPackageSessionId(),
                src.source, plan.getStartSourceId(), src.operation, plan.effectiveStartThreshold());
    }

    private LocalDate contentDayOneForUser(EngagementPlan plan, String userId) {
        ContentSource src = ContentSource.of(plan.getStartSourceType());
        if (src == null) return null;
        List<Object> rows = planRepository.findContentStartForUser(plan.getId(), userId,
                src.source, plan.getStartSourceId(), src.operation, plan.effectiveStartThreshold());
        Timestamp startedAt = rows == null || rows.isEmpty() ? null : toTimestamp(rows.get(0));
        return startedAt == null ? null : dayOne(plan, startedAt);
    }

    /** Where learner progress stores completion for each start content type. */
    public enum ContentSource {
        /** The whole course of the plan's batch; its id is the batch (package session) id. */
        COURSE("PACKAGE_SESSION", "PERCENTAGE_PACKAGE_SESSION_COMPLETED"),
        SUBJECT("SUBJECT", "PERCENTAGE_SUBJECT_COMPLETED"),
        MODULE("MODULE", "PERCENTAGE_MODULE_COMPLETED"),
        CHAPTER("CHAPTER", "PERCENTAGE_CHAPTER_COMPLETED");

        final String source;
        final String operation;

        ContentSource(String source, String operation) {
            this.source = source;
            this.operation = operation;
        }

        /** Null for anything that is not COURSE, SUBJECT, MODULE or CHAPTER. */
        public static ContentSource of(String raw) {
            if (raw == null) return null;
            for (ContentSource s : values()) if (s.name().equalsIgnoreCase(raw.trim())) return s;
            return null;
        }
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
