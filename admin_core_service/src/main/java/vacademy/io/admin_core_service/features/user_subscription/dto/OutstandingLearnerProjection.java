package vacademy.io.admin_core_service.features.user_subscription.dto;

import java.time.LocalDate;

/** One learner who still owes money, as the billing query returns them. */
public interface OutstandingLearnerProjection {

    String getUserId();

    /** Course / membership the balance is against (the first one, when a learner has several). */
    String getCourseName();

    /** Custom Installment (CPO), Course / Package, Live Class, Sub-Org … */
    String getPaymentType();

    String getPlanStatus();

    Double getBilled();

    Double getPaid();

    /** Overdue right now. */
    Double getDue();

    /** Falling due within the upcoming horizon. */
    Double getUpcoming();

    Long getPlanCount();

    /** CPO only: instalments on their schedule that are not yet fully paid. */
    Long getPendingInstallments();

    /** CPO only: the earliest unpaid instalment's due date. */
    LocalDate getNextDueDate();

    String getCurrency();
}
