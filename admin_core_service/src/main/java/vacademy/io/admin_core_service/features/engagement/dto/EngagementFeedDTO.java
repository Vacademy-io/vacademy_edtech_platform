package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The learner's "today" payload across every batch they belong to.
 *
 * <p>Two views live side by side so deployed clients keep working:
 * <ul>
 *   <li><b>Legacy</b>: {@code items} (today's open tasks, capped, THEN the catch-ups),
 *       {@code totalToday} (= items.size()) and {@code capApplied}.</li>
 *   <li><b>Contract</b>: {@code scheduledToday} / {@code completedToday} for a progress
 *       total that never moves, {@code catchUp[]} kept apart (and out of the cap),
 *       {@code doneToday[]} and {@code hiddenByCap}. A client reading these filters the
 *       catch-up ids out of {@code items}.</li>
 * </ul>
 */
@Data
@NoArgsConstructor
public class EngagementFeedDTO {

    public EngagementFeedDTO(List<EngagementItemDTO> items, List<EngagementItemDTO> upcoming,
                             int totalToday, int completedToday, boolean capApplied) {
        this.items = items;
        this.upcoming = upcoming;
        this.totalToday = totalToday;
        this.completedToday = completedToday;
        this.capApplied = capApplied;
        this.revealed = List.of();
        this.streakDays = 0;
        this.catchUp = List.of();
        this.doneToday = List.of();
        this.scheduledToday = 0;
        this.hiddenByCap = 0;
    }

    /**
     * Items openable right now, already ordered and capped: today's open tasks (required,
     * then closing soonest, then the item's order), followed by the catch-ups. Contract
     * clients take today's tasks as {@code items} minus the ids in {@code catchUp}.
     */
    private List<EngagementItemDTO> items;
    /** Locked future items (including today's not-yet-open ones) — metadata only. */
    private List<EngagementItemDTO> upcoming;
    /** Legacy: the size of {@code items}. Use {@code scheduledToday} for progress. */
    private int totalToday;
    /** Tasks whose run today is COMPLETED (a STARTED row never counts). */
    private int completedToday;
    /** True when the cap hid additional items; they are NOT counted as missed. */
    private boolean capApplied;
    /**
     * Recently revealed questions and polls the learner completed — the "here's the
     * answer" moment. Only QUESTION_OF_DAY and POLL ever appear here.
     */
    private List<EngagementItemDTO> revealed;
    /**
     * Consecutive days (institute-local) ending today or yesterday with a completion.
     * Deprecated: the streak shown to learners comes from the points summary.
     */
    private int streakDays;

    // ── Learner contract (WP-2A) ───────────────────────────────────────────

    /**
     * Every task scheduled for today across the learner's batches, in any state
     * (not yet open, open, done, closed, hidden by the cap). Constant through the day;
     * a catch-up from an earlier day never enters it.
     */
    private int scheduledToday;
    /**
     * Still-doable tasks from an earlier run (or today's run after it closed), at the
     * catch-up percent. At most 2, soonest-closing first; they never use the daily cap.
     */
    private List<EngagementItemDTO> catchUp;
    /**
     * Tasks finished today, with the outcome: today's runs that are COMPLETED, plus any
     * catch-up completed today. Newest completion first.
     */
    private List<EngagementItemDTO> doneToday;
    /** Today's open tasks the daily cap is holding back; falls as the learner finishes. */
    private int hiddenByCap;
    /** When the earliest listed catch-up window closes (ISO instant), or null. */
    private String catchUpClosesAt;
    /** Institute-local date the feed was computed for (yyyy-MM-dd), from the first plan. */
    private String today;
    /** Server clock at response time (epoch ms), so countdowns can correct device skew. */
    private Long serverTimeMs;
}
