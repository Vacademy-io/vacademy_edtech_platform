package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface CommerceGatewayOrderRepository extends JpaRepository<CommerceGatewayOrder, String> {

    /** The branch test of the webhook: one read on the unique key (vendor, gateway_order_id). */
    Optional<CommerceGatewayOrder> findByVendorAndGatewayOrderId(String vendor, String gatewayOrderId);

    List<CommerceGatewayOrder> findByCommerceOrderIdOrderByCreatedAtDesc(String commerceOrderId);

    /** Moves a row that is not PAID yet; a PAID row never goes back. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceGatewayOrder g SET g.status = :status, g.gatewayPaymentId = :paymentId, "
            + "g.statusAt = :now, g.updatedAt = :now WHERE g.id = :id AND g.status <> 'PAID'")
    int moveUnlessPaid(@Param("id") String id, @Param("status") String status,
                       @Param("paymentId") String paymentId, @Param("now") Date now);

    /**
     * This row's payment is the one that paid the order. Called in the transaction that claimed
     * the payment logs, so the claim and this mark commit together.
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE CommerceGatewayOrder g SET g.paying = true, g.status = 'PAID', "
            + "g.gatewayPaymentId = COALESCE(:paymentId, g.gatewayPaymentId), g.statusAt = :now, "
            + "g.updatedAt = :now WHERE g.id = :id")
    int markPaying(@Param("id") String id, @Param("paymentId") String paymentId, @Param("now") Date now);

    /** The payment id of a PAID row that was marked by an event that carried none. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceGatewayOrder g SET g.gatewayPaymentId = :paymentId, g.updatedAt = :now "
            + "WHERE g.id = :id AND g.gatewayPaymentId IS NULL")
    int rememberPaymentId(@Param("id") String id, @Param("paymentId") String paymentId, @Param("now") Date now);

    /** The row whose payment paid the order, if a payment has. */
    Optional<CommerceGatewayOrder> findFirstByCommerceOrderIdAndPayingTrue(String commerceOrderId);

    /** The order code has dealt with the payment of this commerce order. */
    @Transactional
    @Modifying
    @Query("UPDATE CommerceGatewayOrder g SET g.settledAt = :now, g.updatedAt = :now "
            + "WHERE g.commerceOrderId = :commerceOrderId AND g.settledAt IS NULL")
    int settle(@Param("commerceOrderId") String commerceOrderId, @Param("now") Date now);

    /** A payment was authorised on this order after {@code since} and is not captured or failed yet. */
    @Query("SELECT COUNT(g) FROM CommerceGatewayOrder g WHERE g.commerceOrderId = :commerceOrderId "
            + "AND g.status = 'AUTHORIZED' AND g.statusAt >= :since")
    long countAuthorizedSince(@Param("commerceOrderId") String commerceOrderId, @Param("since") Date since);
}
