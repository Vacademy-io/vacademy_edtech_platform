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

    /**
     * Takes this row for one fetch: marks it as being fetched since {@code now} and moves its
     * next fetch to {@code claimNext} (the retry should this run never write a result). False
     * (0) when the row was settled or paid meanwhile, or another run took it after
     * {@code staleBefore}: the caller then leaves it alone.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_gateway_order
            SET fetch_started_at = :now, next_fetch_at = :claimNext
            WHERE id = :id AND settled_at IS NULL AND paying = false AND status <> 'PAID'
              AND (fetch_started_at IS NULL OR fetch_started_at < :staleBefore)
            """, nativeQuery = true)
    int claimFetch(@Param("id") String id, @Param("now") Date now, @Param("claimNext") Date claimNext,
                   @Param("staleBefore") Date staleBefore);

    /**
     * One fetch of this row got an answer: the count, when, the next time (null: no more, except
     * the final fetch) and, when the final stage is over, its time. The error run starts again
     * and the row is free for the next run. A next time that {@link #fetchSoon} set while the
     * fetch was running (earlier than {@code claimNext}, which {@link #claimFetch} wrote) is
     * kept when it is the earlier one.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_gateway_order
            SET fetch_count = fetch_count + 1, fetch_errors = 0, last_fetched_at = :now,
                next_fetch_at = CASE
                    WHEN next_fetch_at IS NOT NULL AND next_fetch_at < CAST(:claimNext AS TIMESTAMP)
                    THEN LEAST(next_fetch_at, COALESCE(CAST(:next AS TIMESTAMP), next_fetch_at))
                    ELSE CAST(:next AS TIMESTAMP) END,
                final_fetched_at = COALESCE(CAST(:finalAt AS TIMESTAMP), final_fetched_at),
                fetch_started_at = NULL,
                updated_at = :now
            WHERE id = :id
            """, nativeQuery = true)
    int recordFetch(@Param("id") String id, @Param("now") Date now, @Param("next") Date next,
                    @Param("finalAt") Date finalAt, @Param("claimNext") Date claimNext);

    /**
     * One fetch of this row failed (gateway or confirm step): one more error in the run and the
     * next try (or an earlier one {@link #fetchSoon} set meanwhile). The fetch count and the
     * final time are left alone, so the schedules are kept; the row is free for the next run.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_gateway_order
            SET fetch_errors = fetch_errors + 1, last_fetched_at = :now,
                next_fetch_at = CASE
                    WHEN next_fetch_at IS NOT NULL AND next_fetch_at < CAST(:claimNext AS TIMESTAMP)
                    THEN LEAST(next_fetch_at, CAST(:next AS TIMESTAMP))
                    ELSE CAST(:next AS TIMESTAMP) END,
                fetch_started_at = NULL,
                updated_at = :now
            WHERE id = :id
            """, nativeQuery = true)
    int recordFetchError(@Param("id") String id, @Param("now") Date now, @Param("next") Date next,
                         @Param("claimNext") Date claimNext);

    /**
     * Asks the fetch job to look at this gateway order at {@code at} at the latest (after the
     * storefront said a payment went through). An earlier time already set is kept.
     */
    @Transactional
    @Modifying
    @Query(value = """
            UPDATE commerce_gateway_order SET next_fetch_at = :at
            WHERE id = :id AND settled_at IS NULL AND (next_fetch_at IS NULL OR next_fetch_at > :at)
            """, nativeQuery = true)
    int fetchSoon(@Param("id") String id, @Param("at") Date at);

    /** A payment was authorised on this order after {@code since} and is not captured or failed yet. */
    @Query("SELECT COUNT(g) FROM CommerceGatewayOrder g WHERE g.commerceOrderId = :commerceOrderId "
            + "AND g.status = 'AUTHORIZED' AND g.statusAt >= :since")
    long countAuthorizedSince(@Param("commerceOrderId") String commerceOrderId, @Param("since") Date since);
}
