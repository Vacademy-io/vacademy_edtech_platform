package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * The instalment view of an institute's fees: how far the instalment plans have got, and when the
 * rest comes in, month by month. Same window and course scope as the billing summary.
 *
 * <p>The two halves answer different questions, so they cover different plans. The progress
 * figures are instalment (CPO) plans only. {@link #months} covers everything on the Upcoming card
 * (future instalments, unpaid invoices not yet due, renewals within the horizon), so the months
 * always add up to {@code upcomingAll}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class InstalmentForecastResponseDTO {
    /** Every instalment's expected amount, across live instalment plans. */
    private Double instalmentBilled;
    /** Paid against those instalments so far. */
    private Double instalmentPaid;
    /** Unpaid on instalments whose due date has passed. */
    private Double instalmentOverdue;
    /** Unpaid on instalments not yet due. */
    private Double instalmentToCome;
    private Long instalmentPlans;
    private Long instalmentLearners;
    /** Upcoming money by month, earliest first; an undated bucket (month null) comes last. */
    private List<Month> months;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Month {
        /** yyyy-MM; null for instalments with no due date. */
        private String month;
        private Double amount;
        private Long learners;
        private Long dues;
        private LocalDate firstDueOn;
    }
}
