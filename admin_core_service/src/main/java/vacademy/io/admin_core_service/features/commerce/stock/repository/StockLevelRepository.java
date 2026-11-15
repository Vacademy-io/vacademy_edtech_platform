package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLevel;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Every write here is called by StockLedgerService only (one writer per number). Reads return
 * scalars or projections, never entities, so a count is always read from the table.
 */
public interface StockLevelRepository extends JpaRepository<StockLevel, String> {

    interface LevelRow {
        String getId();
        String getLocationId();
        String getPackageSessionId();
        Integer getOnHand();
        Integer getReorderLevel();
        String getSku();
        String getVariantName();
        String getProductName();
    }

    interface LevelQuantity {
        String getPackageSessionId();
        Integer getOnHand();
    }

    /** Makes sure the row exists, with nothing on hand. No effect when it is already there. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO stock_level (id, institute_id, location_id, package_session_id, on_hand)
            VALUES (:id, :instituteId, :locationId, :packageSessionId, 0)
            ON CONFLICT (location_id, package_session_id) DO NOTHING
            """, nativeQuery = true)
    int insertIfMissing(@Param("id") String id, @Param("instituteId") String instituteId,
                        @Param("locationId") String locationId,
                        @Param("packageSessionId") String packageSessionId);

    /** Locks the level row and returns what is on hand. */
    @Query(value = """
            SELECT sl.on_hand FROM stock_level sl
            WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId
              AND sl.package_session_id = :packageSessionId
            FOR UPDATE
            """, nativeQuery = true)
    Optional<Integer> lockOnHand(@Param("instituteId") String instituteId,
                                 @Param("locationId") String locationId,
                                 @Param("packageSessionId") String packageSessionId);

    /**
     * The one statement that changes a physical quantity. It refuses to go below zero:
     * 1 = applied, 0 = not that much here. Two decrements of the last unit cannot both win.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_level SET on_hand = on_hand + :delta, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND location_id = :locationId
              AND package_session_id = :packageSessionId AND on_hand + :delta >= 0
            """, nativeQuery = true)
    int applyDelta(@Param("instituteId") String instituteId, @Param("locationId") String locationId,
                   @Param("packageSessionId") String packageSessionId, @Param("delta") int delta);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_level SET reorder_level = CAST(:reorderLevel AS integer), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND location_id = :locationId
              AND package_session_id = :packageSessionId
            """, nativeQuery = true)
    int setReorderLevel(@Param("instituteId") String instituteId, @Param("locationId") String locationId,
                        @Param("packageSessionId") String packageSessionId,
                        @Param("reorderLevel") Integer reorderLevel);

    /** On hand over every location of the institute. */
    @Query(value = """
            SELECT COALESCE(SUM(sl.on_hand), 0) FROM stock_level sl
            WHERE sl.institute_id = :instituteId AND sl.package_session_id = :packageSessionId
            """, nativeQuery = true)
    long sumOnHand(@Param("instituteId") String instituteId, @Param("packageSessionId") String packageSessionId);

    /** Locks every stocked level row of a location, in package-session order, and returns them. */
    @Query(value = """
            SELECT sl.package_session_id AS packageSessionId, sl.on_hand AS onHand
            FROM stock_level sl
            WHERE sl.institute_id = :instituteId AND sl.location_id = :locationId AND sl.on_hand > 0
            ORDER BY sl.package_session_id
            FOR UPDATE
            """, nativeQuery = true)
    List<LevelQuantity> lockStockedLevelsOfLocation(@Param("instituteId") String instituteId,
                                                    @Param("locationId") String locationId);

    // -- Reconciliation (StockReconciliationJob). Read only.

    /** The counters of a TRACKED variant beside what the ledger and the holds say they should be. */
    interface SellableRow {
        String getInstituteId();
        String getPackageSessionId();
        Integer getMaxSeats();
        Integer getAvailableSlots();
        Long getOnlineOnHand();
        Long getHeld();
        Long getSoldUnshipped();
        Long getDeficit();
    }

    /**
     * TRACKED variants whose counters do not match the ledger and the holds:
     * <pre>
     * max_seats                          = on hand at locations that sell online
     * available_slots - sellable_deficit = that quantity - held - sold and not shipped
     * </pre>
     * and never both available_slots and the deficit above zero. "Sold and not shipped" is the
     * quantity of the variant's stock_hold rows in status SOLD that took stock (not oversold):
     * a SOLD row is closed when its goods ship or its order is cancelled. Every number is
     * worked out in this one statement, so the test and the row limit see the same snapshot.
     */
    @Query(value = """
            SELECT x.institute_id AS instituteId, x.package_session_id AS packageSessionId,
                   x.max_seats AS maxSeats, x.available_slots AS availableSlots,
                   x.online AS onlineOnHand, x.held AS held, x.sold AS soldUnshipped, x.deficit AS deficit
            FROM (
                SELECT cv.institute_id, cv.package_session_id, ps.max_seats, ps.available_slots,
                       COALESCE(cv.sellable_deficit, 0) AS deficit,
                       COALESCE((SELECT SUM(sl.on_hand) FROM stock_level sl
                                 JOIN stock_location l ON l.id = sl.location_id AND l.sells_online
                                 WHERE sl.package_session_id = cv.package_session_id
                                   AND sl.institute_id = cv.institute_id), 0) AS online,
                       COALESCE((SELECT SUM(sh.quantity) FROM stock_hold sh
                                 WHERE sh.package_session_id = cv.package_session_id
                                   AND sh.status = 'HELD'), 0) AS held,
                       COALESCE((SELECT SUM(sh.quantity) FROM stock_hold sh
                                 WHERE sh.package_session_id = cv.package_session_id
                                   AND sh.status = 'SOLD' AND sh.kind = 'PURCHASE'
                                   AND sh.oversold IS NOT TRUE), 0) AS sold
                FROM commerce_variant cv
                JOIN package_session ps ON ps.id = cv.package_session_id
                WHERE cv.stock_policy = 'TRACKED'
            ) x
            WHERE x.max_seats IS DISTINCT FROM x.online
               OR x.available_slots IS NULL
               OR (x.available_slots - x.deficit) <> (x.online - x.held - x.sold)
               OR (x.available_slots > 0 AND x.deficit > 0)
            ORDER BY x.institute_id, x.package_session_id
            LIMIT :maxRows
            """, nativeQuery = true)
    List<SellableRow> findSellableDrift(@Param("maxRows") int maxRows);

    interface PieceDriftRow {
        String getInstituteId();
        String getLocationId();
        String getPackageSessionId();
        Integer getOnHand();
        Long getPieces();
    }

    /** One-of-a-kind stock: on_hand at a location against its pieces IN_STOCK or RESERVED there. */
    @Query(value = """
            SELECT x.institute_id AS instituteId, x.location_id AS locationId,
                   x.package_session_id AS packageSessionId, x.on_hand AS onHand, x.pieces AS pieces
            FROM (
                SELECT sl.institute_id, sl.location_id, sl.package_session_id, sl.on_hand,
                       (SELECT COUNT(*) FROM commerce_piece cpi
                        WHERE cpi.institute_id = sl.institute_id AND cpi.location_id = sl.location_id
                          AND cpi.package_session_id = sl.package_session_id
                          AND cpi.status IN ('IN_STOCK', 'RESERVED')) AS pieces
                FROM stock_level sl
                JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                        AND cv.institute_id = sl.institute_id
                JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
                WHERE cp.stock_mode = 'PIECE'
            ) x
            WHERE x.on_hand <> x.pieces
            ORDER BY x.institute_id, x.package_session_id, x.location_id
            LIMIT :maxRows
            """, nativeQuery = true)
    List<PieceDriftRow> findPieceDrift(@Param("maxRows") int maxRows);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). :q is a lower-cased LIKE pattern. */
    @Query(value = """
            SELECT sl.id AS id, sl.location_id AS locationId, sl.package_session_id AS packageSessionId,
                   sl.on_hand AS onHand, sl.reorder_level AS reorderLevel, cv.sku AS sku,
                   ps.name AS variantName, p.package_name AS productName
            FROM stock_level sl
            JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                    AND cv.institute_id = sl.institute_id
            LEFT JOIN package_session ps ON ps.id = sl.package_session_id
            LEFT JOIN package p ON p.id = cv.package_id
            WHERE sl.institute_id = :instituteId
              AND (:allLocations = TRUE OR sl.location_id IN (:locationIds))
              AND (CAST(:packageSessionId AS varchar) IS NULL OR sl.package_session_id = CAST(:packageSessionId AS varchar))
              AND (:lowOnly = FALSE OR (sl.reorder_level IS NOT NULL AND sl.on_hand <= sl.reorder_level))
              AND (CAST(:q AS varchar) IS NULL OR lower(cv.sku) LIKE CAST(:q AS varchar)
                   OR lower(p.package_name) LIKE CAST(:q AS varchar)
                   OR lower(ps.name) LIKE CAST(:q AS varchar))
            ORDER BY sl.package_session_id, sl.location_id
            """, countQuery = """
            SELECT COUNT(*)
            FROM stock_level sl
            JOIN commerce_variant cv ON cv.package_session_id = sl.package_session_id
                                    AND cv.institute_id = sl.institute_id
            LEFT JOIN package_session ps ON ps.id = sl.package_session_id
            LEFT JOIN package p ON p.id = cv.package_id
            WHERE sl.institute_id = :instituteId
              AND (:allLocations = TRUE OR sl.location_id IN (:locationIds))
              AND (CAST(:packageSessionId AS varchar) IS NULL OR sl.package_session_id = CAST(:packageSessionId AS varchar))
              AND (:lowOnly = FALSE OR (sl.reorder_level IS NOT NULL AND sl.on_hand <= sl.reorder_level))
              AND (CAST(:q AS varchar) IS NULL OR lower(cv.sku) LIKE CAST(:q AS varchar)
                   OR lower(p.package_name) LIKE CAST(:q AS varchar)
                   OR lower(ps.name) LIKE CAST(:q AS varchar))
            """, nativeQuery = true)
    Page<LevelRow> search(@Param("instituteId") String instituteId,
                          @Param("allLocations") boolean allLocations,
                          @Param("locationIds") Collection<String> locationIds,
                          @Param("packageSessionId") String packageSessionId,
                          @Param("lowOnly") boolean lowOnly,
                          @Param("q") String q,
                          Pageable pageable);
}
