package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * Raw aggregate behind the billing summary: what came in, what learners with access still owe,
 * and what falls due next. See {@code UserPlanRepository.DUE_OBLIGATION_CTES} for the rule.
 */
public interface BillingSummaryProjection {
    Double getCollected();
    /** Overdue obligations on live enrolments and unpaid invoices. */
    Double getDue();
    /** Obligations falling due within the upcoming horizon. */
    Double getUpcoming();
    Long getLearnersOwing();
    Long getLearnersUpcoming();
    Long getPlanCount();
    /** Live instalment (CPO) plans across the whole institute — any date, any course. */
    Long getInstalmentPlanCount();
    /** Live plans across the whole institute — any date, any course. */
    Long getLivePlanCount();
    /** Live, priced one-time plans with no payment recorded — activated by hand. */
    Long getActivatedWithoutPaymentCount();
    /** Every unpaid installment / invoice on live enrolments, whatever its due date. */
    Double getOutstanding();
    Long getLearnersOutstanding();
    /** Every unpaid instalment / invoice not yet due, plus subscription renewals in the horizon. */
    Double getUpcomingAll();
    Long getLearnersUpcomingAll();
    /** Earliest future due date with money on it, as yyyy-MM-dd. */
    String getNextDueDate();
    /** The institute has instalment schedules at all — whatever the window. */
    Boolean getUsesInstallments();
    String getCurrency();
}
