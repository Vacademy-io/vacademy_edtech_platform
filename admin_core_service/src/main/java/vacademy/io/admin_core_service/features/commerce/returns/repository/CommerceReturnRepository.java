package vacademy.io.admin_core_service.features.commerce.returns.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.returns.entity.CommerceReturn;

import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface CommerceReturnRepository extends JpaRepository<CommerceReturn, String> {

    Optional<CommerceReturn> findByIdAndInstituteId(String id, String instituteId);

    Optional<CommerceReturn> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    /** The return row locked FOR UPDATE; taken after its order's lock. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM CommerceReturn r WHERE r.id = :id")
    Optional<CommerceReturn> lockById(@Param("id") String id);

    List<CommerceReturn> findByOrderIdOrderByCreatedAtAsc(String orderId);

    List<CommerceReturn> findByOrderIdInOrderByCreatedAtAsc(Collection<String> orderIds);

    /** The RECEIVED returns of an order, oldest first, locked (after the order). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM CommerceReturn r WHERE r.orderId = :orderId AND r.status = 'RECEIVED' "
            + "ORDER BY r.createdAt ASC, r.id ASC")
    List<CommerceReturn> lockReceivedOfOrder(@Param("orderId") String orderId);

    /**
     * Units of an order line on returns still open (REQUESTED or APPROVED): with qty_returned,
     * what may not be asked again.
     */
    @Query(value = """
            SELECT COALESCE(SUM(l.quantity), 0) FROM commerce_return_line l
            JOIN commerce_return r ON r.id = l.return_id
            WHERE l.order_line_id = :orderLineId AND r.status IN ('REQUESTED', 'APPROVED')
            """, nativeQuery = true)
    long openQuantity(@Param("orderLineId") String orderLineId);

    /** The smallest return window of the collections the products are in; null when none sets one. */
    @Query(value = """
            SELECT MIN(c.return_window_days) FROM commerce_product_collection pc
            JOIN commerce_collection c ON c.id = pc.collection_id
            WHERE pc.institute_id = :instituteId AND c.institute_id = :instituteId
              AND pc.package_id IN (:packageIds) AND c.return_window_days IS NOT NULL
            """, nativeQuery = true)
    Integer smallestCollectionWindow(@Param("instituteId") String instituteId,
                                     @Param("packageIds") Collection<String> packageIds);

    @Query(value = "SELECT r.* FROM commerce_return r WHERE " + FILTER
            + " ORDER BY r.created_at DESC, r.id DESC",
            countQuery = "SELECT COUNT(*) FROM commerce_return r WHERE " + FILTER,
            nativeQuery = true)
    Page<CommerceReturn> search(@Param("instituteId") String instituteId, @Param("status") String status,
                                @Param("orderId") String orderId, @Param("fromTime") Date fromTime,
                                @Param("toTime") Date toTime, Pageable pageable);

    String FILTER = """
            r.institute_id = :instituteId
              AND (CAST(:status AS VARCHAR) IS NULL OR r.status = CAST(:status AS VARCHAR))
              AND (CAST(:orderId AS VARCHAR) IS NULL OR r.order_id = CAST(:orderId AS VARCHAR))
              AND (CAST(:fromTime AS TIMESTAMP) IS NULL OR r.created_at >= CAST(:fromTime AS TIMESTAMP))
              AND (CAST(:toTime AS TIMESTAMP) IS NULL OR r.created_at < CAST(:toTime AS TIMESTAMP))
            """;
}
