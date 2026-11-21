package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Transfers. Every query names the institute first. */
public interface StockTransferRepository extends JpaRepository<StockTransfer, String> {

    Optional<StockTransfer> findByInstituteIdAndId(String instituteId, String id);

    Optional<StockTransfer> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    /**
     * The transfer row, locked. The first read of the row in a state-changing transaction, so the
     * managed copy is the one read under the lock.
     */
    @Query(value = "SELECT * FROM stock_transfer WHERE institute_id = :instituteId AND id = :id FOR UPDATE",
            nativeQuery = true)
    Optional<StockTransfer> lockForUpdate(@Param("instituteId") String instituteId, @Param("id") String id);

    /**
     * Transfers by status and place. {@code direction} is OUT (from), IN (to) or ANY. With
     * {@code locationId} the place is that location; otherwise the caller's locations
     * ({@code allLocations} true for an institute ADMIN; pass any non-empty list then).
     */
    @Query("""
            SELECT t FROM StockTransfer t
            WHERE t.instituteId = :instituteId
              AND (:status IS NULL OR t.status = :status)
              AND (:locationId IS NULL
                   OR (:direction <> 'IN' AND t.fromLocationId = :locationId)
                   OR (:direction <> 'OUT' AND t.toLocationId = :locationId))
              AND (:allLocations = TRUE
                   OR (:direction <> 'IN' AND t.fromLocationId IN :locationIds)
                   OR (:direction <> 'OUT' AND t.toLocationId IN :locationIds))
            """)
    Page<StockTransfer> search(@Param("instituteId") String instituteId, @Param("status") String status,
                               @Param("direction") String direction, @Param("locationId") String locationId,
                               @Param("allLocations") boolean allLocations,
                               @Param("locationIds") Collection<String> locationIds, Pageable pageable);

    /** A DISPATCHED transfer to or from the location (served by idx_stock_transfer_from / _to). */
    @Query(value = """
            SELECT t.transfer_number FROM stock_transfer t
            WHERE t.institute_id = :instituteId AND t.from_location_id = :locationId AND t.status = 'DISPATCHED'
            UNION ALL
            SELECT t.transfer_number FROM stock_transfer t
            WHERE t.institute_id = :instituteId AND t.to_location_id = :locationId AND t.status = 'DISPATCHED'
            LIMIT 1
            """, nativeQuery = true)
    List<String> findDispatchedTouching(@Param("instituteId") String instituteId,
                                        @Param("locationId") String locationId);
}
