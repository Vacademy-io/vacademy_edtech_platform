package vacademy.io.admin_core_service.features.learner_management.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Hard terminate + "delete payment history", in ONE transaction: if the history cannot be
 * deleted (an online payment, a referral reward, …) the termination is rolled back too, so the
 * admin never ends up with a removed course whose payments are still showing.
 *
 * <p>Courses tied together go together: an admission package's courses share their receipts, so
 * the package can only be deleted as a whole, and if one of them is refused none is removed.
 */
@Service
@RequiredArgsConstructor
public class CourseRemovalHistoryService {

    private final UserPlanService userPlanService;
    private final PaymentDeletionService paymentDeletionService;

    /** @return what was deleted, per enrolment plan */
    @Transactional
    public Map<String, Map<String, Object>> terminateAndDeleteHistory(List<String> userPlanIds, String instituteId,
                                                                      String adminUserId) {
        // Refuse BEFORE terminating: cancelUserPlan fires the SUBSCRIPTION_TERMINATED workflow in its
        // own (REQUIRES_NEW) transaction, which a later rollback here would not take back.
        for (String userPlanId : userPlanIds) {
            String blocker = paymentDeletionService.previewPlanHistory(userPlanId, instituteId, userPlanIds).blocker();
            if (blocker != null) {
                throw new VacademyException(blocker);
            }
        }
        for (String userPlanId : userPlanIds) {
            userPlanService.cancelUserPlan(userPlanId, true);
        }
        Map<String, Map<String, Object>> deleted = new LinkedHashMap<>();
        for (String userPlanId : userPlanIds) {
            deleted.put(userPlanId,
                    paymentDeletionService.deletePlanHistory(userPlanId, instituteId, adminUserId, userPlanIds));
        }
        return deleted;
    }
}
