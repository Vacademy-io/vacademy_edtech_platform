package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCount;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Stock counts. Every query names the institute first. */
public interface StockCountRepository extends JpaRepository<StockCount, String> {

    Optional<StockCount> findByInstituteIdAndId(String instituteId, String id);

    Optional<StockCount> findByInstituteIdAndClientRequestId(String instituteId, String clientRequestId);

    /** The count row, locked: the post and the cancel. */
    @Query(value = "SELECT * FROM stock_count WHERE institute_id = :instituteId AND id = :id FOR UPDATE",
            nativeQuery = true)
    Optional<StockCount> lockForUpdate(@Param("instituteId") String instituteId, @Param("id") String id);

    /** The status of the count, share-locked: line saves run side by side and wait for a post. */
    @Query(value = "SELECT status FROM stock_count WHERE institute_id = :instituteId AND id = :id FOR SHARE",
            nativeQuery = true)
    Optional<String> lockStatusShared(@Param("instituteId") String instituteId, @Param("id") String id);

    /** The open COUNT of a location (at most one, uq_stock_count_open). */
    @Query(value = """
            SELECT * FROM stock_count
            WHERE institute_id = :instituteId AND location_id = :locationId AND status = 'OPEN' AND kind = 'COUNT'
            """, nativeQuery = true)
    Optional<StockCount> findOpenCount(@Param("instituteId") String instituteId,
                                       @Param("locationId") String locationId);

    /** The recounts of a count, newest first. */
    @Query(value = """
            SELECT * FROM stock_count
            WHERE institute_id = :instituteId AND recount_of_count_id = :countId
            ORDER BY started_at DESC, id DESC
            """, nativeQuery = true)
    List<StockCount> findRecountsOf(@Param("instituteId") String instituteId, @Param("countId") String countId);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). */
    @Query("""
            SELECT c FROM StockCount c
            WHERE c.instituteId = :instituteId
              AND (:allLocations = TRUE OR c.locationId IN :locationIds)
              AND (:locationId IS NULL OR c.locationId = :locationId)
              AND (:status IS NULL OR c.status = :status)
              AND (:kind IS NULL OR c.kind = :kind)
            """)
    Page<StockCount> search(@Param("instituteId") String instituteId, @Param("allLocations") boolean allLocations,
                            @Param("locationIds") Collection<String> locationIds,
                            @Param("locationId") String locationId, @Param("status") String status,
                            @Param("kind") String kind, Pageable pageable);
}
