package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Everything the Payment Dashboard draws, in one response.
 *
 * <p>Two kinds of figure, kept apart on purpose:
 * <ul>
 *   <li><b>Flows</b> — money that came in during the period (collected, payers, new payers,
 *       sources, methods, and the collected column of the batches). Same definition as the
 *       Collected card; compared with the same period a year earlier.</li>
 *   <li><b>Balances</b> — what is owed as of today on every live enrolment (overdue, due in the
 *       next days, still to come, ageing, forecast, and the balance columns of the batches). Same
 *       rules as the Due / Upcoming cards, over all dates, so "overdue" means overdue now.</li>
 * </ul>
 * The course/batch scope applies to both.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentDashboardResponseDTO {
    private LocalDateTime periodStart;
    private LocalDateTime periodEnd;
    /** Same period one year earlier; null for all time. */
    private LocalDateTime previousStart;
    private LocalDateTime previousEnd;
    private String timeZone;
    private String currency;

    private Kpis kpis;
    /** 24 calendar months ending with the period's last month, oldest first, zero-filled. */
    private List<SeriesPoint> months;
    /** The last four financial years (April–March) up to the period end, oldest first. */
    private List<YearPoint> years;
    /** The 182 days ending with the period end, oldest first, zero-filled. */
    private List<SeriesPoint> days;
    private List<Slice> sources;
    private List<Slice> methods;
    private List<BatchRow> batches;
    private List<AgeingBucket> ageing;
    /** Balances still to come, by the month they fall due (null month = no due date). */
    private List<ForecastMonth> forecast;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Kpis {
        private Double collected;
        private Double previousCollected;
        private Long payments;
        private Long previousPayments;
        private Long payingLearners;
        private Long previousPayingLearners;
        private Long newPayingLearners;
        private Long previousNewPayingLearners;
        /** Overdue right now, all live enrolments. */
        private Double overdue;
        private Long learnersOverdue;
        /** Falling due within {@link #upcomingDays}. */
        private Double dueSoon;
        private Long learnersDueSoon;
        private Integer upcomingDays;
        /** Every future instalment / invoice plus renewals within the horizon. */
        private Double stillToCome;
        private Long learnersStillToCome;
        /** Collected over all time, and everything still to collect — the collection rate. */
        private Double collectedAllTime;
        private Double outstanding;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class SeriesPoint {
        /** yyyy-MM or yyyy-MM-dd. */
        private String bucket;
        private Double collected;
        private Long payments;
        private Long payers;
        /** Months only: learners whose first payment was in this month. */
        private Long newPayers;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class YearPoint {
        /** e.g. "2025-26". */
        private String financialYear;
        private Double collected;
        /** The year the period ends in, still running. */
        private Boolean partial;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Slice {
        private String key;
        private Double amount;
        private Long payments;
        private Long payers;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class BatchRow {
        /** Null = money on no batch (institute-level options, invoices). */
        private String packageSessionId;
        private String packageId;
        private String packageName;
        private String levelName;
        private String sessionName;
        /** Collected in the period. */
        private Double collected;
        /** Collected over all time — with the balances, the batch's fee position. */
        private Double collectedAllTime;
        private Double overdue;
        private Double stillToCome;
        /** Learners on the batch with money still owed (overdue or still to come). */
        private Long learners;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AgeingBucket {
        private String bucket;
        private Double amount;
        private Long learners;
        private Integer oldestDays;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ForecastMonth {
        /** yyyy-MM; null for instalments with no due date. */
        private String month;
        private Double amount;
        private Long learners;
    }
}
