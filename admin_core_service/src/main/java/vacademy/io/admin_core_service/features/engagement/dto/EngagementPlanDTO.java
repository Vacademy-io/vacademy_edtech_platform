package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Admin-facing plan with its slots and items. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EngagementPlanDTO {
    private String id;
    private String instituteId;
    private String packageSessionId;
    private String title;
    private String description;
    private String subjectId;
    private String status;
    private String timezone;
    /** CALENDAR or RELATIVE. */
    private String scheduleMode;
    private String publishedAt;
    /** RELATIVE plans: the last day number any slot runs on. */
    private Integer lastDay;
    private String defaultMissPolicy;
    private Integer defaultCatchUpDays;
    private Integer defaultCatchUpPercent;
    private String createdByUserId;
    private String createdAt;
    private List<EngagementSlotDTO> slots;

    // ── Summary (additive; filled by /plan/list and GET /plan/{id}) ───────────
    // Everything below is derived from the active slots and items, evaluated in the
    // plan's timezone. All are optional: a client that ignores them keeps working.

    /** Human batch name ("Course · Session · Level", or the batch's own name). */
    private String packageSessionLabel;
    /** The plan's local "today" (yyyy-MM-dd) that todayState and todayTaskCount use. */
    private String today;
    /** First and last dates any active slot actually runs on (weekday mask applied). */
    private String firstDate;
    private String lastDate;
    /** Distinct dates with at least one active slot. */
    private Integer dayCount;
    /** Active slots (days / recurring schedules). */
    private Integer slotCount;
    /** Active tasks across all slots (a recurring slot's task counts once). */
    private Integer taskCount;
    /** DRAFT | UPCOMING | RUNNING | ENDED | ARCHIVED. */
    private String todayState;
    /** Active tasks in the slots that run today (0 when nothing runs today). */
    private Integer todayTaskCount;
    /** Active learners enrolled in the batch — the denominator for "x / N learners". */
    private Long learnerCount;
    /**
     * Distinct learners with any attempt / a completion on today's tasks. Attempts are
     * per task, not per occurrence, so a recurring slot also counts earlier days.
     */
    private Long todayStartedLearners;
    private Long todayCompletedLearners;
}
