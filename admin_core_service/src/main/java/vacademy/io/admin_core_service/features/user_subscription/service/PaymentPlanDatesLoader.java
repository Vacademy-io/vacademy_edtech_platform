package vacademy.io.admin_core_service.features.user_subscription.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDatesProjection;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads the optional Enrollment Date / Next Due Date values for a page of the payment list.
 *
 * <p>Runs in its own read-only transaction. PaymentLogService is transactional, and a failed query
 * inside its transaction would mark it rollback-only (and leave the Postgres transaction aborted),
 * failing the whole payment list even though the caller catches the error. Isolated here, a
 * failure costs only these two columns.
 */
@Component
public class PaymentPlanDatesLoader {

    /** The values copied out of the projection, so nothing is read after this transaction ends. */
    public record PlanDates(LocalDate enrolledDate, LocalDate nextInstalmentDue, LocalDateTime renewalDue) {
    }

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Map<String, PlanDates> load(List<String> userPlanIds) {
        Map<String, PlanDates> out = new HashMap<>();
        for (UserPlanDatesProjection d : userPlanRepository.findPlanDates(userPlanIds)) {
            out.put(d.getUserPlanId(),
                    new PlanDates(d.getEnrolledDate(), d.getNextInstalmentDue(), d.getRenewalDue()));
        }
        return out;
    }
}
