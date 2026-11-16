package vacademy.io.admin_core_service.features.commerce.order.payment;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Date;

public interface CommercePaymentExceptionRepository extends JpaRepository<CommercePaymentException, String> {

    /**
     * Records one exception. The same order, kind and gateway payment a second time (a webhook
     * delivered again, the reconcile job) changes nothing.
     *
     * @return 1 when the row is new
     */
    @Transactional
    @Modifying
    @Query(value = """
            INSERT INTO commerce_payment_exception
                (id, institute_id, commerce_order_id, order_number, kind, gateway_order_id, gateway_payment_id,
                 amount, currency, status, detail)
            VALUES (:id, :instituteId, :orderId, CAST(:orderNumber AS VARCHAR), :kind,
                    CAST(:gatewayOrderId AS VARCHAR), :gatewayPaymentId, CAST(:amount AS NUMERIC),
                    CAST(:currency AS VARCHAR), 'OPEN', CAST(:detail AS VARCHAR))
            ON CONFLICT (commerce_order_id, kind, gateway_payment_id) DO NOTHING
            """, nativeQuery = true)
    int record(@Param("id") String id, @Param("instituteId") String instituteId, @Param("orderId") String orderId,
               @Param("orderNumber") String orderNumber, @Param("kind") String kind,
               @Param("gatewayOrderId") String gatewayOrderId, @Param("gatewayPaymentId") String gatewayPaymentId,
               @Param("amount") BigDecimal amount, @Param("currency") String currency,
               @Param("detail") String detail);

    Page<CommercePaymentException> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);

    Page<CommercePaymentException> findByInstituteIdAndStatusOrderByCreatedAtDesc(String instituteId, String status,
                                                                                  Pageable pageable);

    /** OPEN to RESOLVED, once; the institute is part of the key. */
    @Transactional
    @Modifying
    @Query("UPDATE CommercePaymentException e SET e.status = 'RESOLVED', e.resolvedAt = :now, "
            + "e.resolvedBy = :userId, e.resolutionNote = :note "
            + "WHERE e.id = :id AND e.instituteId = :instituteId AND e.status = 'OPEN'")
    int resolve(@Param("id") String id, @Param("instituteId") String instituteId, @Param("userId") String userId,
                @Param("note") String note, @Param("now") Date now);

    // -- Refunds (WP-32) --

    /** The automatic refund made for an exception row; set once. */
    @Modifying
    @Query(value = """
            UPDATE commerce_payment_exception SET refund_id = :refundId, updated_at = CURRENT_TIMESTAMP
            WHERE commerce_order_id = :orderId AND kind = :kind AND gateway_payment_id = :gatewayPaymentId
              AND refund_id IS NULL
            """, nativeQuery = true)
    int linkRefund(@Param("orderId") String orderId, @Param("kind") String kind,
                   @Param("gatewayPaymentId") String gatewayPaymentId, @Param("refundId") String refundId);

    /** The OPEN rows whose automatic refund was paid out are resolved. */
    @Modifying
    @Query(value = """
            UPDATE commerce_payment_exception
            SET status = 'RESOLVED', resolved_at = :now, resolved_by = NULL, resolution_note = :note,
                updated_at = CURRENT_TIMESTAMP
            WHERE refund_id = :refundId AND status = 'OPEN'
            """, nativeQuery = true)
    int resolveByRefund(@Param("refundId") String refundId, @Param("note") String note, @Param("now") Date now);

    /** The OPEN REFUND_DUE rows (written before WP-32) of an order whose due is refunded in full. */
    @Modifying
    @Query(value = """
            UPDATE commerce_payment_exception
            SET status = 'RESOLVED', resolved_at = :now, resolved_by = NULL, resolution_note = 'Refunded',
                updated_at = CURRENT_TIMESTAMP
            WHERE commerce_order_id = :orderId AND kind = 'REFUND_DUE' AND status = 'OPEN'
            """, nativeQuery = true)
    int resolveRefundDue(@Param("orderId") String orderId, @Param("now") Date now);

    /**
     * The OPEN oversold row of an order with nothing left owing (staff refunded it another way
     * before the automatic refund was made) is resolved.
     */
    @Modifying
    @Query(value = """
            UPDATE commerce_payment_exception
            SET status = 'RESOLVED', resolved_at = :now, resolved_by = NULL, resolution_note = :note,
                updated_at = CURRENT_TIMESTAMP
            WHERE commerce_order_id = :orderId AND kind = 'OVERSOLD_PAID' AND status = 'OPEN' AND refund_id IS NULL
            """, nativeQuery = true)
    int resolveOversoldRefundedOtherwise(@Param("orderId") String orderId, @Param("note") String note,
                                         @Param("now") Date now);

    /**
     * OPEN oversold and duplicate rows without their automatic refund, older than
     * {@code createdBefore}: the refund hook is called again for them. An oversold row is read
     * only when its order has a paying gateway payment (the refund needs one) and something is
     * still to do (the due is not raised to what was paid yet, or part of it is not committed to
     * a refund): an order staff refunded another way is never retried. A duplicate row is read
     * only when it names the payment and an amount above zero.
     */
    @Query(value = """
            SELECT e.* FROM commerce_payment_exception e
            WHERE e.status = 'OPEN' AND e.refund_id IS NULL AND e.kind IN ('OVERSOLD_PAID', 'DUPLICATE_PAYMENT')
              AND e.created_at <= :createdBefore
              AND ((e.kind = 'DUPLICATE_PAYMENT' AND e.gateway_payment_id <> '' AND e.amount > 0)
                   OR (e.kind = 'OVERSOLD_PAID'
                       AND EXISTS (SELECT 1 FROM commerce_gateway_order g WHERE g.commerce_order_id = e.commerce_order_id
                                     AND g.paying AND g.gateway_payment_id IS NOT NULL)
                       AND EXISTS (SELECT 1 FROM commerce_order o WHERE o.id = e.commerce_order_id
                                     AND (o.refund_due < o.amount_paid OR o.refund_due > o.refund_committed))))
            ORDER BY e.created_at ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    java.util.List<CommercePaymentException> findUnrefunded(@Param("createdBefore") Date createdBefore,
                                                            @Param("maxRows") int maxRows);
}
