package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockLocationRepository extends JpaRepository<StockLocation, String> {

    /** What the ledger needs to know about a location, read fresh. */
    interface LocationFacts {
        String getId();
        String getStatus();
        Boolean getSellsOnline();
        Boolean getIsSource();
    }

    Optional<StockLocation> findByInstituteIdAndId(String instituteId, String id);

    List<StockLocation> findByInstituteIdOrderByCodeAsc(String instituteId);

    boolean existsByInstituteIdAndCode(String instituteId, String code);

    @Query("SELECT l.id FROM StockLocation l WHERE l.instituteId = :instituteId AND l.id IN :ids")
    List<String> findIdsOfInstitute(@Param("instituteId") String instituteId, @Param("ids") Collection<String> ids);

    /**
     * Shared row lock for a posting. Postings do not block each other; a change of
     * sells_online takes the row FOR UPDATE and so waits for postings in flight.
     */
    @Query(value = """
            SELECT l.id AS id, l.status AS status, l.sells_online AS sellsOnline, l.is_source AS isSource
            FROM stock_location l
            WHERE l.institute_id = :instituteId AND l.id = :id
            FOR SHARE
            """, nativeQuery = true)
    Optional<LocationFacts> lockForPosting(@Param("instituteId") String instituteId, @Param("id") String id);

    @Query(value = """
            SELECT l.id AS id, l.status AS status, l.sells_online AS sellsOnline, l.is_source AS isSource
            FROM stock_location l
            WHERE l.institute_id = :instituteId AND l.id = :id
            FOR UPDATE
            """, nativeQuery = true)
    Optional<LocationFacts> lockForChange(@Param("instituteId") String instituteId, @Param("id") String id);

    /**
     * Variants of the institute with a sellable deficit: units that left the online location
     * although they were held or sold online, and that no inflow has made good yet.
     */
    @Query(value = """
            SELECT COUNT(*) FROM commerce_variant cv
            WHERE cv.institute_id = :instituteId AND cv.sellable_deficit > 0
            """, nativeQuery = true)
    long countVariantsShortForOnlineOrders(@Param("instituteId") String instituteId);

    @Query(value = """
            SELECT l.id FROM stock_location l
            WHERE l.institute_id = :instituteId AND l.sells_online AND l.id <> :exceptId
            """, nativeQuery = true)
    List<String> findOtherOnlineLocationIds(@Param("instituteId") String instituteId,
                                            @Param("exceptId") String exceptId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_location SET sells_online = :sellsOnline, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int setSellsOnline(@Param("instituteId") String instituteId, @Param("id") String id,
                       @Param("sellsOnline") boolean sellsOnline);
}
