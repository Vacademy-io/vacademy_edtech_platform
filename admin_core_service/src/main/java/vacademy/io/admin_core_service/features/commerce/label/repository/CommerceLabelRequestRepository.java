package vacademy.io.admin_core_service.features.commerce.label.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.label.entity.CommerceLabelRequest;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

/** The label queue. Every query names the institute first; status changes are conditional UPDATEs. */
public interface CommerceLabelRequestRepository extends JpaRepository<CommerceLabelRequest, String> {

    List<CommerceLabelRequest> findByInstituteIdAndIdIn(String instituteId, Collection<String> ids);

    List<CommerceLabelRequest> findByInstituteIdAndSourceTypeAndSourceIdAndStatus(String instituteId,
                                                                                String sourceType, String sourceId,
                                                                                String status);

    List<CommerceLabelRequest> findByInstituteIdAndSourceTypeAndSourceIdOrderByCreatedAtAscIdAsc(
            String instituteId, String sourceType, String sourceId);

    /**
     * The queue of a receipt line, once: the partial unique index
     * {@code uq_commerce_label_request_receipt} turns a repeat into nothing.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_label_request (id, institute_id, location_id, package_session_id, piece_id, quantity,
                                                reason, source_type, source_id, status, requested_by)
            VALUES (:id, :instituteId, :locationId, :packageSessionId, CAST(:pieceId AS varchar), :quantity,
                    'NEW_RECEIPT', 'STOCK_RECEIPT', :receiptId, 'PENDING', CAST(:requestedBy AS varchar))
            ON CONFLICT (institute_id, source_id, package_session_id, (COALESCE(piece_id, '')))
                WHERE reason = 'NEW_RECEIPT'
            DO NOTHING
            """, nativeQuery = true)
    int queueReceiptRow(@Param("id") String id, @Param("instituteId") String instituteId,
                        @Param("locationId") String locationId, @Param("packageSessionId") String packageSessionId,
                        @Param("pieceId") String pieceId, @Param("quantity") int quantity,
                        @Param("receiptId") String receiptId, @Param("requestedBy") String requestedBy);

    /** PENDING rows of a source become CANCELLED (a receipt reversed). */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_label_request
            SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = CAST(:actor AS varchar),
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND source_type = :sourceType AND source_id = :sourceId
              AND status = 'PENDING'
            """, nativeQuery = true)
    int cancelPendingOfSource(@Param("instituteId") String instituteId, @Param("sourceType") String sourceType,
                              @Param("sourceId") String sourceId, @Param("actor") String actor);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_label_request
            SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = CAST(:actor AS varchar),
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id IN (:ids) AND status = 'PENDING'
            """, nativeQuery = true)
    int cancelPending(@Param("instituteId") String instituteId, @Param("ids") Collection<String> ids,
                      @Param("actor") String actor);

    /** 1 = this caller marked the row printed; 0 = it was not PENDING. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_label_request
            SET status = 'PRINTED', printed_at = :printedAt, printed_by = CAST(:actor AS varchar),
                printed_price = CAST(:price AS numeric), printed_mrp = CAST(:mrp AS numeric),
                updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'PENDING'
            """, nativeQuery = true)
    int markPrinted(@Param("instituteId") String instituteId, @Param("id") String id,
                    @Param("printedAt") LocalDateTime printedAt, @Param("actor") String actor,
                    @Param("price") BigDecimal price, @Param("mrp") BigDecimal mrp);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). */
    @Query("""
            SELECT r FROM CommerceLabelRequest r
            WHERE r.instituteId = :instituteId
              AND (:allLocations = TRUE OR r.locationId IN :locationIds)
              AND (:locationId IS NULL OR r.locationId = :locationId)
              AND (:status IS NULL OR r.status = :status)
              AND (:reason IS NULL OR r.reason = :reason)
              AND (:sourceType IS NULL OR r.sourceType = :sourceType)
              AND (:sourceId IS NULL OR r.sourceId = :sourceId)
            """)
    Page<CommerceLabelRequest> search(@Param("instituteId") String instituteId,
                                      @Param("allLocations") boolean allLocations,
                                      @Param("locationIds") Collection<String> locationIds,
                                      @Param("locationId") String locationId, @Param("status") String status,
                                      @Param("reason") String reason, @Param("sourceType") String sourceType,
                                      @Param("sourceId") String sourceId, Pageable pageable);

    /** The last PRINTED row of each variant at a location (quantity rows and pieces alike). */
    interface LastPrinted {
        String getPackageSessionId();
        BigDecimal getPrintedPrice();
        BigDecimal getPrintedMrp();
    }

    @Query(value = """
            SELECT DISTINCT ON (r.package_session_id) r.package_session_id AS packageSessionId,
                   r.printed_price AS printedPrice, r.printed_mrp AS printedMrp
            FROM commerce_label_request r
            WHERE r.institute_id = :instituteId AND r.location_id = :locationId AND r.status = 'PRINTED'
            ORDER BY r.package_session_id, r.printed_at DESC, r.id DESC
            """, nativeQuery = true)
    List<LastPrinted> lastPrinted(@Param("instituteId") String instituteId, @Param("locationId") String locationId);
}
