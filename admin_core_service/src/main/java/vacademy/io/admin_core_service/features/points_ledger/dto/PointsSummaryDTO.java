package vacademy.io.admin_core_service.features.points_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * The learner's own points state — replaces the browser-computed XP figure.
 *
 * <p>The streak fields are additive and nullable: an older learner app ignores them, and
 * they are null (not 0) when the streak could not be computed, so a client can fall back
 * to its own estimate instead of showing a false "0-day streak".
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PointsSummaryDTO {
    private long totalPoints;
    /** Points earned since the start of the current week (institute timezone). */
    private long weekPoints;
    /** Points earned today (institute timezone). */
    private long todayPoints;
    private int level;
    /** Points still needed to reach the next level. */
    private int pointsToNextLevel;
    /** Per-source split, for the "where did my points come from" explainer. */
    private List<PointsBreakdownItemDTO> breakdown;

    // ── Streak (one source for every streak display) ─────────────────────────

    /**
     * Consecutive institute-local days with learning activity, a completed engagement
     * task or earned points, ending today when today already counts, else yesterday.
     * Yesterday counts so a streak is not shown as broken before today is over.
     */
    private Integer currentStreak;
    /** Longest run inside the look-back window (the last year). */
    private Integer longestStreak;
    /** True once today already counts toward the streak; false = the streak is at risk today. */
    private Boolean keptToday;
    /** The last seven institute-local days, oldest first, today last. */
    private List<StreakDay> last7Days;
    /** yyyy-MM-dd today in the institute's timezone (the day keptToday refers to). */
    private String today;
    /** The institute's IANA timezone, so a client can count down to its midnight. */
    private String timezone;

    /** Kept for existing callers: the pre-streak shape. */
    public PointsSummaryDTO(long totalPoints, long weekPoints, long todayPoints, int level,
                            int pointsToNextLevel, List<PointsBreakdownItemDTO> breakdown) {
        this.totalPoints = totalPoints;
        this.weekPoints = weekPoints;
        this.todayPoints = todayPoints;
        this.level = level;
        this.pointsToNextLevel = pointsToNextLevel;
        this.breakdown = breakdown;
    }

    /** One day of the streak strip. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StreakDay {
        /** yyyy-MM-dd, institute-local. */
        private String date;
        private boolean active;
    }
}
