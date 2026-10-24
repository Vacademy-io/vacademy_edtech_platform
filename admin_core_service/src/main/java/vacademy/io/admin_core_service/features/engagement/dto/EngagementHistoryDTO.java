package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The learner's past tasks: every occurrence that has already run, newest first.
 *
 * Each entry is an {@link EngagementItemDTO} with {@code historyStatus} set —
 * DONE, MISSED, or CATCH_UP (missed, but still openable for reduced points).
 * Today's still-open tasks are NOT here; they belong on the home card.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EngagementHistoryDTO {

    public EngagementHistoryDTO(String from, String to, List<EngagementItemDTO> items,
                                int done, int missed, int catchUp, int pointsEarned) {
        this.from = from;
        this.to = to;
        this.items = items;
        this.done = done;
        this.missed = missed;
        this.catchUp = catchUp;
        this.pointsEarned = pointsEarned;
    }

    /** First date of the window (yyyy-MM-dd), institute-local. */
    private String from;
    /** Last date of the window (yyyy-MM-dd) = {@link #today}. */
    private String to;
    private List<EngagementItemDTO> items;
    private int done;
    /** Occurrences that can no longer be done (closed, or superseded by a newer run). */
    private int missed;
    /** Missed but still inside the catch-up window, and openable right now. */
    private int catchUp;
    private int pointsEarned;

    // ── Learner contract (WP-2A) ───────────────────────────────────────────

    /** Institute-local date the history was computed for (yyyy-MM-dd). */
    private String today;
    /** IANA zone {@link #today} is in (the first plan's timezone). */
    private String timezone;
}
