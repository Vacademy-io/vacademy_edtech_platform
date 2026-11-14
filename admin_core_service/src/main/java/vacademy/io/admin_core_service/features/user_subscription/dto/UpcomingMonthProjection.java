package vacademy.io.admin_core_service.features.user_subscription.dto;

import java.time.LocalDate;

/**
 * One calendar month of the Upcoming card: what falls due in it and from how many learners.
 * See {@code UserPlanRepository.getUpcomingByMonth}.
 */
public interface UpcomingMonthProjection {
    /** First day of the month; null for instalments with no due date. */
    LocalDate getMonthStart();
    Double getAmount();
    /** Distinct learners with something due in the month. */
    Long getLearners();
    /** Instalments, invoices and renewals behind {@link #getAmount()}. */
    Long getDues();
    /** Earliest due date inside the month. */
    LocalDate getFirstDueOn();
}
