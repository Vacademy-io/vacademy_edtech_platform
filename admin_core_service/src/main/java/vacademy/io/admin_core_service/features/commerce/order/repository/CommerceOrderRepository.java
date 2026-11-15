package vacademy.io.admin_core_service.features.commerce.order.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;

import java.util.Date;
import java.util.Optional;

public interface CommerceOrderRepository extends JpaRepository<CommerceOrder, String> {

    Optional<CommerceOrder> findByIdAndInstituteId(String id, String instituteId);

    Optional<CommerceOrder> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    Optional<CommerceOrder> findByInstituteIdAndOrderNumber(String instituteId, String orderNumber);

    Optional<CommerceOrder> findByPaymentGroupId(String paymentGroupId);

    /** The order row, locked FOR UPDATE: the first lock of every flow that changes an order. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM CommerceOrder o WHERE o.id = :id")
    Optional<CommerceOrder> lockById(@Param("id") String id);

    Page<CommerceOrder> findByInstituteIdOrderByCreatedAtDesc(String instituteId, Pageable pageable);

    Page<CommerceOrder> findByInstituteIdAndStatusOrderByCreatedAtDesc(String instituteId, String status,
                                                                       Pageable pageable);

    @Query("""
            SELECT o FROM CommerceOrder o
            WHERE o.instituteId = :instituteId
              AND (o.orderNumber = :text OR o.customerPhone = :phone)
            ORDER BY o.createdAt DESC
            """)
    Page<CommerceOrder> search(@Param("instituteId") String instituteId, @Param("text") String text,
                               @Param("phone") String phone, Pageable pageable);

    Page<CommerceOrder> findByInstituteIdAndCustomerIdOrderByCreatedAtDesc(String instituteId, String customerId,
                                                                           Pageable pageable);

    /** Unpaid online orders of a phone that still hold stock. */
    @Query(value = """
            SELECT COUNT(*) FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.customer_phone = :phone
              AND o.status = 'PENDING_PAYMENT'
            """, nativeQuery = true)
    long countOpenUnpaidByPhone(@Param("instituteId") String instituteId, @Param("phone") String phone);

    @Query(value = """
            SELECT COUNT(*) FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.customer_email = :email
              AND o.status = 'PENDING_PAYMENT'
            """, nativeQuery = true)
    long countOpenUnpaidByEmail(@Param("instituteId") String instituteId, @Param("email") String email);

    /**
     * Claims the right to create the gateway order. Only one caller gets 1 inside the window,
     * so a double click, a replayed checkout and a retry never talk to the gateway at once.
     * The claim lapses after {@code staleBefore}, for a caller that died in the middle.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_attempt_at = :now, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id
              AND status = 'PENDING_PAYMENT'
              AND gateway_order_id IS NULL
              AND (gateway_attempt_at IS NULL OR gateway_attempt_at < :staleBefore)
            """, nativeQuery = true)
    int claimGatewayAttempt(@Param("id") String id, @Param("now") Date now, @Param("staleBefore") Date staleBefore);

    /** Stores the gateway order once; a second writer changes nothing. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_vendor = :vendor, gateway_order_id = :gatewayOrderId, gateway_key_id = CAST(:keyId AS VARCHAR),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND gateway_order_id IS NULL
            """, nativeQuery = true)
    int storeGatewayOrder(@Param("id") String id, @Param("vendor") String vendor,
                          @Param("gatewayOrderId") String gatewayOrderId, @Param("keyId") String keyId);

    /** Gives the claim back after a failed gateway call, so the shopper can retry at once. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET gateway_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND gateway_order_id IS NULL
            """, nativeQuery = true)
    int releaseGatewayAttempt(@Param("id") String id);
}
