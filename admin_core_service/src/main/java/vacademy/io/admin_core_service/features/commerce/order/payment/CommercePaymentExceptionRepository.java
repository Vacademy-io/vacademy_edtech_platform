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
}
