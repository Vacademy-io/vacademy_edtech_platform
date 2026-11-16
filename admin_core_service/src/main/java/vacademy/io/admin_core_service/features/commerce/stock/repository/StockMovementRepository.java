package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Insert and read only. There is no update or delete of a movement anywhere. */
public interface StockMovementRepository extends JpaRepository<StockMovement, String> {

    Optional<StockMovement> findByInstituteIdAndIdempotencyKey(String instituteId, String idempotencyKey);

    Optional<StockMovement> findByInstituteIdAndId(String instituteId, String id);

    /**
     * The signed quantity that corrections of one movement have already put back or taken
     * out. Read under the level row lock of that movement, where every correction of it posts.
     */
    @Query(value = """
            SELECT COALESCE(SUM(m.quantity_delta), 0) FROM stock_movement m
            WHERE m.institute_id = :instituteId AND m.reverses_movement_id = :movementId
            """, nativeQuery = true)
    long sumReversed(@Param("instituteId") String instituteId, @Param("movementId") String movementId);

    List<StockMovement> findByInstituteIdAndReferenceTypeAndReferenceId(String instituteId, String referenceType,
                                                                        String referenceId);

    /** The movements of several references of one type (the lines of a shipment), oldest first. */
    List<StockMovement> findByInstituteIdAndReferenceTypeAndReferenceIdInOrderByCreatedAtAsc(
            String instituteId, String referenceType, Collection<String> referenceIds);

    /**
     * Units sent on a transfer and not yet received: minus the sum of TRANSFER_OUT (negative)
     * and TRANSFER_IN (positive, posted for the full sent quantity) rows.
     */
    @Query(value = """
            SELECT COALESCE(-SUM(m.quantity_delta), 0) FROM stock_movement m
            WHERE m.institute_id = :instituteId AND m.package_session_id = :packageSessionId
              AND m.type IN ('TRANSFER_OUT', 'TRANSFER_IN')
            """, nativeQuery = true)
    long sumInTransit(@Param("instituteId") String instituteId, @Param("packageSessionId") String packageSessionId);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). */
    @Query("""
            SELECT m FROM StockMovement m
            WHERE m.instituteId = :instituteId
              AND (:allLocations = TRUE OR m.locationId IN :locationIds)
              AND (:packageSessionId IS NULL OR m.packageSessionId = :packageSessionId)
              AND (:type IS NULL OR m.type = :type)
              AND m.createdAt >= :fromTime AND m.createdAt < :toTime
            """)
    Page<StockMovement> search(@Param("instituteId") String instituteId,
                               @Param("allLocations") boolean allLocations,
                               @Param("locationIds") Collection<String> locationIds,
                               @Param("packageSessionId") String packageSessionId,
                               @Param("type") String type,
                               @Param("fromTime") LocalDateTime fromTime,
                               @Param("toTime") LocalDateTime toTime,
                               Pageable pageable);
}
