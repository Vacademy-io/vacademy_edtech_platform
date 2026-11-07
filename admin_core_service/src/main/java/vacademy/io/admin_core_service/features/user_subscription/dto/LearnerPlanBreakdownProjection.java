package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * One enrolment of one learner, priced. Backs the Due side view, which has to show every plan a
 * learner holds — including the ones that are NOT counted as due — so an admin can see for
 * themselves why a cancelled enrolment contributes nothing.
 */
public interface LearnerPlanBreakdownProjection {
    String getUserPlanId();

    String getCourseName();

    String getPlanStatus();

    String getPaymentType();

    Double getBilled();

    Double getPaid();

    /** Overdue on this enrolment right now. */
    Double getDue();

    /** Falling due on this enrolment within the upcoming horizon. */
    Double getUpcoming();

    /**
     * True for a live CPO / subscription plan or an unpaid invoice — the kinds that can owe. A
     * one-time purchase or a dead plan carries false and contributes nothing to the learner's due.
     */
    Boolean getCountsTowardsDue();

    String getCurrency();
}
