package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceipt;

import java.util.Collection;
import java.util.Optional;

public interface StockReceiptRepository extends JpaRepository<StockReceipt, String> {

    Optional<StockReceipt> findByInstituteIdAndId(String instituteId, String id);

    Optional<StockReceipt> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    /** Locks the receipt row (lock order 6) and returns its status; empty when it is not of the institute. */
    @Query(value = """
            SELECT r.status FROM stock_receipt r
            WHERE r.institute_id = :instituteId AND r.id = :id
            FOR UPDATE
            """, nativeQuery = true)
    Optional<String> lockStatus(@Param("instituteId") String instituteId, @Param("id") String id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_receipt
            SET status = 'REVERSED', reversed_by = :reversedBy, reversed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'POSTED'
            """, nativeQuery = true)
    int markReversed(@Param("instituteId") String instituteId, @Param("id") String id,
                     @Param("reversedBy") String reversedBy);

    /** UNBILLED to NO_BILL, for a posted supplier receipt. 1 = changed. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_receipt
            SET bill_status = 'NO_BILL', no_bill_reason = :reason, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'POSTED'
              AND bill_status = 'UNBILLED'
            """, nativeQuery = true)
    int markNoBill(@Param("instituteId") String instituteId, @Param("id") String id,
                   @Param("reason") String reason);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). */
    @Query("""
            SELECT r FROM StockReceipt r
            WHERE r.instituteId = :instituteId
              AND (:allLocations = TRUE OR r.locationId IN :locationIds)
              AND (:status IS NULL OR r.status = :status)
              AND (:billStatus IS NULL OR r.billStatus = :billStatus)
              AND (:supplierId IS NULL OR r.supplierId = :supplierId)
            """)
    Page<StockReceipt> search(@Param("instituteId") String instituteId,
                              @Param("allLocations") boolean allLocations,
                              @Param("locationIds") Collection<String> locationIds,
                              @Param("status") String status,
                              @Param("billStatus") String billStatus,
                              @Param("supplierId") String supplierId,
                              Pageable pageable);
}
