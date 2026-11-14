package vacademy.io.admin_core_service.features.user_subscription.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Enrolment and next-due dates for one user plan, for the optional Enrolled on / Next due columns
 * on the Manage Payments list. See {@code UserPlanRepository.findPlanDates}.
 */
public interface UserPlanDatesProjection {
    String getUserPlanId();

    /** The learner's stored enrolled_date on the batch this plan is for; null if never enrolled. */
    LocalDate getEnrolledDate();

    /** Active instalment plans: the first instalment not yet fully paid. */
    LocalDate getNextInstalmentDue();

    /** Active subscriptions: the end of the paid period (UTC), when the renewal falls due. */
    LocalDateTime getRenewalDue();
}
