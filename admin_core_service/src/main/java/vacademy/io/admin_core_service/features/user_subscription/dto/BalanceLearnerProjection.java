package vacademy.io.admin_core_service.features.user_subscription.dto;

/**
 * A learner with any balance still to collect (the "Outstanding" list) — the Due-list row plus
 * the total outstanding and what falls due on the next due date.
 */
public interface BalanceLearnerProjection extends OutstandingLearnerProjection {

    /** Every unpaid installment and invoice on live enrolments, whatever its due date. */
    Double getOutstanding();

    /** What falls due on {@link #getNextDueDate()}. */
    Double getNextDueAmount();
}
