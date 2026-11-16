package vacademy.io.admin_core_service.features.commerce.order.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;

import java.util.Date;
import java.util.List;

public interface CommerceOrderTenderRepository extends JpaRepository<CommerceOrderTender, String> {

    List<CommerceOrderTender> findByOrderIdOrderByCreatedAtAsc(String orderId);

    /** One PENDING tender to RECEIVED or VOID (the order desk); 1 = this caller moved it. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order_tender
            SET status = :toStatus, received_at = CAST(:receivedAt AS TIMESTAMP),
                reference = COALESCE(CAST(:reference AS VARCHAR), reference),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'PENDING'
            """, nativeQuery = true)
    int settleOne(@Param("id") String id, @Param("toStatus") String toStatus, @Param("receivedAt") Date receivedAt,
                  @Param("reference") String reference);

    /** PENDING to RECEIVED or VOID; a tender that already left PENDING is not touched. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order_tender
            SET status = :toStatus, received_at = CAST(:receivedAt AS TIMESTAMP),
                reference = COALESCE(CAST(:reference AS VARCHAR), reference),
                updated_at = CURRENT_TIMESTAMP
            WHERE order_id = :orderId AND status = 'PENDING'
            """, nativeQuery = true)
    int settlePending(@Param("orderId") String orderId, @Param("toStatus") String toStatus,
                      @Param("receivedAt") Date receivedAt, @Param("reference") String reference);
}
