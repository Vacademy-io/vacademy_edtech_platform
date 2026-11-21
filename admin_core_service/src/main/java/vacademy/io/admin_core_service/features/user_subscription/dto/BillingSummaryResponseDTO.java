package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Collected / Due / Upcoming for an institute, as an admin means them: what came in, what learners
 * who have access still owe right now, and what falls due next.
 *
 * <p>{@code due} is only ever money on granted access — an overdue instalment, a lapsed
 * subscription renewal, an unpaid invoice. An unfinished checkout is not due (nobody has access),
 * and a one-time purchase is never due (it is paid or it is not enrolled). {@code totalBilled} is
 * always {@code collected + due}, so the cards can never disagree with each other.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BillingSummaryResponseDTO {
    /** collected + due. */
    private Double totalBilled;
    /** Sum of PAID payment logs in the window. */
    private Double collected;
    /** Overdue: obligations on live enrolments whose due date has passed, plus unpaid invoices. */
    private Double due;
    /** Obligations that fall due within {@link #upcomingDays}. Expected, not yet owed. */
    private Double upcoming;
    /** The horizon {@link #upcoming} was computed over. */
    private Integer upcomingDays;
    /** Distinct learners with something overdue — the rows on the Due list. */
    private Long learnersOwing;
    /** Distinct learners with something falling due within the horizon. */
    private Long learnersUpcoming;
    /** Live enrolments in the window. */
    private Long planCount;
    /**
     * The institute's fee model: live instalment (CPO) plans, and all live plans, across the whole
     * institute. Lets the screen tell an instalment institute from one that sells one-time courses
     * and has a handful of instalment plans. Deliberately NOT scoped to the date window or course
     * filter (unlike {@link #planCount}), so the screen keeps its shape while the admin filters.
     */
    private Long instalmentPlanCount;
    private Long livePlanCount;
    /**
     * Live, priced one-time plans with no payment recorded against them — activated by an admin.
     * Might be an offline payment nobody recorded or a free grant, so it is reported, not billed.
     */
    private Long activatedWithoutPaymentCount;
    /**
     * Everything still to collect on live enrolments — every unpaid instalment whatever its due
     * date, overdue renewals and unpaid invoices. Due and Upcoming are slices of it by date; this
     * is the whole. A future subscription renewal is not in it: that is not a balance yet.
     */
    private Double outstanding;
    /** Distinct learners with an outstanding balance — the rows on the Outstanding list. */
    private Long learnersOutstanding;
    /**
     * Everything expected but not yet owed, whatever the date: every unpaid instalment and invoice
     * not yet due, plus subscription renewals within {@link #upcomingDays}. For an instalment
     * institute this is what "upcoming" means — the next instalment may be months away, beyond the
     * horizon {@link #upcoming} is limited to.
     */
    private Double upcomingAll;
    /** Distinct learners behind {@link #upcomingAll}. */
    private Long learnersUpcomingAll;
    /** Earliest future due date carrying money, yyyy-MM-dd. null when nothing is scheduled. */
    private String nextDueDate;
    /**
     * Whether the institute has any instalment schedule, independent of the date window — lets the
     * cards pick instalment-friendly defaults without flipping as the admin changes the range.
     */
    private Boolean usesInstallments;
    /** Most common currency across the live enrolments. null when none is resolvable. */
    private String currency;
}
