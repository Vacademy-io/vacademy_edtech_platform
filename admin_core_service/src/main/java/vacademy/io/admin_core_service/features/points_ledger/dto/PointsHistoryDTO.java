package vacademy.io.admin_core_service.features.points_ledger.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.sql.Timestamp;
import java.util.List;

/** Staff view of one learner's points over time, for the student side view. */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PointsHistoryDTO {
    /** The latest awards, newest first. */
    private List<Award> recent;
    /** Points per week for the last 12 weeks, oldest first, empty weeks included. */
    private List<Week> weeks;
    /** yyyy-MM-dd days with learning activity in the last six months, oldest first. */
    private List<String> activeDays;
    /** yyyy-MM-dd today in the institute timezone. */
    private String today;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Award {
        private String id;
        private String sourceType;
        private String label;
        private int points;
        private String reason;
        private Timestamp awardedAt;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Week {
        /** yyyy-MM-dd of the Monday. */
        private String weekStart;
        private long points;
    }
}
