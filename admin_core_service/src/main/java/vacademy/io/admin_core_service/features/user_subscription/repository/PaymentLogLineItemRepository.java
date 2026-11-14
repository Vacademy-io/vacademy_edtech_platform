package vacademy.io.admin_core_service.features.user_subscription.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLogLineItem;

import java.util.List;

@Repository
public interface PaymentLogLineItemRepository extends JpaRepository<PaymentLogLineItem, String> {
    // Example: Find line items for a specific payment log
    List<PaymentLogLineItem> findByPaymentLog(PaymentLog paymentLog);

    // Example: Find line items by type
    // List<PaymentLogLineItem> findByType(String type);

    /**
     * True when any PaymentLog of this UserPlan already has a line item with
     * the given source_id. Used by PaymentService to skip recording the same
     * coupon discount twice (e.g. when LearnerInstallmentPaymentService
     * re-invokes handlePayment for subsequent installments on a UserPlan that
     * was originally enrolled with a coupon).
     */
    @org.springframework.data.jpa.repository.Query(
            "SELECT COUNT(li) > 0 FROM PaymentLogLineItem li " +
                    "WHERE li.paymentLog.userPlan.id = :userPlanId " +
                    "AND li.sourceId = :sourceId")
    boolean existsByPaymentLog_UserPlan_IdAndSourceId(
            @org.springframework.data.repository.query.Param("userPlanId") String userPlanId,
            @org.springframework.data.repository.query.Param("sourceId") String sourceId);

    /** Per-payment-log variant, for renewals where each charge carries its own discount line. */
    @org.springframework.data.jpa.repository.Query(
            "SELECT COUNT(li) > 0 FROM PaymentLogLineItem li " +
                    "WHERE li.paymentLog.id = :paymentLogId " +
                    "AND li.sourceId = :sourceId")
    boolean existsByPaymentLogIdAndSourceId(
            @org.springframework.data.repository.query.Param("paymentLogId") String paymentLogId,
            @org.springframework.data.repository.query.Param("sourceId") String sourceId);
}