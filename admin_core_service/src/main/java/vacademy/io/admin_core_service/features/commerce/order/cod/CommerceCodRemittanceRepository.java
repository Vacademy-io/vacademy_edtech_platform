package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * The courier remittances of COD orders, and the few order queries of cash on delivery (the
 * conditional "remitted" mark and the orders the confirmation timer cancels).
 */
public interface CommerceCodRemittanceRepository extends JpaRepository<CommerceCodRemittance, String> {

    Optional<CommerceCodRemittance> findByIdAndInstituteId(String id, String instituteId);

    Optional<CommerceCodRemittance> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    Optional<CommerceCodRemittance> findByInstituteIdAndReference(String instituteId, String reference);

    @Query(value = """
            SELECT r.* FROM commerce_cod_remittance r
            WHERE r.institute_id = :instituteId
              AND (CAST(:fromDate AS DATE) IS NULL OR r.received_on >= CAST(:fromDate AS DATE))
              AND (CAST(:toDate AS DATE) IS NULL OR r.received_on <= CAST(:toDate AS DATE))
            ORDER BY r.received_on DESC, r.created_at DESC, r.id DESC
            """,
            countQuery = """
            SELECT COUNT(*) FROM commerce_cod_remittance r
            WHERE r.institute_id = :instituteId
              AND (CAST(:fromDate AS DATE) IS NULL OR r.received_on >= CAST(:fromDate AS DATE))
              AND (CAST(:toDate AS DATE) IS NULL OR r.received_on <= CAST(:toDate AS DATE))
            """,
            nativeQuery = true)
    Page<CommerceCodRemittance> search(@Param("instituteId") String instituteId, @Param("fromDate") LocalDate from,
                                       @Param("toDate") LocalDate to, Pageable pageable);

    /** The orders a remittance settled, by order number. */
    interface RemittedOrder {
        String getOrderId();
        String getOrderNumber();
        java.math.BigDecimal getCodAmount();
    }

    @Query(value = """
            SELECT o.id AS orderId, o.order_number AS orderNumber, o.cod_amount AS codAmount
            FROM commerce_order o
            WHERE o.institute_id = :instituteId AND o.cod_remittance_id = :remittanceId
            ORDER BY o.order_number
            """, nativeQuery = true)
    List<RemittedOrder> findOrders(@Param("instituteId") String instituteId,
                                   @Param("remittanceId") String remittanceId);

    /**
     * Marks one order remitted and paid: only while no remittance names it (the second of two
     * remittances naming one order changes nothing and gets 0).
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_order
            SET cod_remittance_id = :remittanceId, cod_collected_at = :collectedAt, amount_paid = cod_amount,
                payment_status = 'PAID', updated_at = CURRENT_TIMESTAMP
            WHERE id = :orderId AND institute_id = :instituteId AND cod_remittance_id IS NULL
              AND payment_method = 'COD' AND status = 'DELIVERED' AND payment_status = 'UNPAID'
            """, nativeQuery = true)
    int markRemitted(@Param("instituteId") String instituteId, @Param("orderId") String orderId,
                     @Param("remittanceId") String remittanceId, @Param("collectedAt") Date collectedAt);

    /** COD orders past their staff-confirmation time, oldest due first ({@code idx_commerce_order_cod_confirm}). */
    @Query(value = """
            SELECT o.id FROM commerce_order o
            WHERE o.status = 'COD_PENDING_CONFIRMATION' AND o.cod_confirm_due_at <= :now
            ORDER BY o.cod_confirm_due_at ASC, o.id ASC
            LIMIT :maxRows
            """, nativeQuery = true)
    List<String> findOrdersPastConfirmation(@Param("now") Date now, @Param("maxRows") int maxRows);

    /** The ids of the orders named, of this institute (a check that every one exists). */
    @Query(value = "SELECT o.id FROM commerce_order o WHERE o.institute_id = :instituteId AND o.id IN (:ids)",
            nativeQuery = true)
    List<String> findOrderIdsOfInstitute(@Param("instituteId") String instituteId,
                                         @Param("ids") Collection<String> ids);
}
