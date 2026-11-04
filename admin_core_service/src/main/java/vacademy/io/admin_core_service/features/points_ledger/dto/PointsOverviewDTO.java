package vacademy.io.admin_core_service.features.points_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/** Staff view of points and badges earned across some batches, for Gamification and Points. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PointsOverviewDTO {
    private long totalPoints;
    private long learnersEarning;
    private long badgesAwarded;
    private long learnersWithBadge;
    /** DAY, WEEK or MONTH: the size of each period. */
    private String granularity;
    /** Oldest first, empty periods included. */
    private List<Period> periods;
    /** Highest first. */
    private List<Source> sources;
    /** Highest first. */
    private List<Earner> topEarners;
    /** Most awarded first. */
    private List<BadgeRow> badges;
    /** Newest first. */
    private List<RecentBadge> recentBadges;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Period {
        /** yyyy-MM-dd of the first day inside the dates. */
        private String start;
        /** yyyy-MM-dd of the last day inside the dates. */
        private String end;
        private long points;
        private long badges;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Source {
        private String key;
        private String label;
        private long points;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Earner {
        private String userId;
        private String fullName;
        private long points;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BadgeRow {
        private String name;
        private String icon;
        private long awards;
        private long learners;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RecentBadge {
        private String userId;
        private String fullName;
        private String badgeName;
        private String badgeIcon;
        private Timestamp awardedAt;
    }
}
