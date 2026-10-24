package vacademy.io.admin_core_service.features.plan_change.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.plan_change.entity.UserPlanChangeRequest;

import java.util.Date;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserPlanChangeRequestRepository extends JpaRepository<UserPlanChangeRequest, String> {

    /**
     * The one open request for a plan, if any. At most one can exist — {@code requestChange}
     * refuses a second while one is PENDING_PAYMENT or SCHEDULED — so "first" is the only.
     */
    Optional<UserPlanChangeRequest> findFirstByUserPlanIdAndStatusInOrderByCreatedAtDesc(
            String userPlanId, List<String> statuses);

    /** Webhook entry point: the gateway hands back only the order id (= payment_log.id). */
    Optional<UserPlanChangeRequest> findFirstByPaymentLogIdOrderByCreatedAtDesc(String paymentLogId);

    List<UserPlanChangeRequest> findByUserPlanIdOrderByCreatedAtDesc(String userPlanId);

    /**
     * Scheduled changes whose cycle has ended. {@code scheduled_for} is null-tolerant on
     * purpose: a plan with no end date can never reach its end of cycle, so such a row
     * would sit forever and is excluded rather than applied early.
     */
    @Query("SELECT r FROM UserPlanChangeRequest r " +
            "WHERE r.status = 'SCHEDULED' " +
            "AND r.scheduledFor IS NOT NULL " +
            "AND r.scheduledFor <= :now")
    List<UserPlanChangeRequest> findDueScheduled(@Param("now") Date now);
}
