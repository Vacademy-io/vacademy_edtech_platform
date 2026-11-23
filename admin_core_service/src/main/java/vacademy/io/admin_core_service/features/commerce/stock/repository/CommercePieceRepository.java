package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.CommercePiece;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommercePieceRepository extends JpaRepository<CommercePiece, String> {

    /** A piece read fresh; the entity copy in the session may be older than a compare-and-set. */
    interface PieceRow {
        String getId();
        String getPackageSessionId();
        String getCode();
        String getLocationId();
        String getStatus();
        BigDecimal getUnitCost();
        String getReceiptLineId();
    }

    String ROW = """
            SELECT cp.id AS id, cp.package_session_id AS packageSessionId, cp.code AS code,
                   cp.location_id AS locationId, cp.status AS status, cp.unit_cost AS unitCost,
                   cp.receipt_line_id AS receiptLineId
            FROM commerce_piece cp
            """;

    boolean existsByCode(String code);

    @Query(value = ROW + " WHERE cp.institute_id = :instituteId AND cp.id = :id", nativeQuery = true)
    Optional<PieceRow> findRow(@Param("instituteId") String instituteId, @Param("id") String id);

    @Query(value = ROW + " WHERE cp.institute_id = :instituteId AND cp.id = :id FOR UPDATE", nativeQuery = true)
    Optional<PieceRow> lockRow(@Param("instituteId") String instituteId, @Param("id") String id);

    @Query(value = ROW + " WHERE cp.institute_id = :instituteId AND cp.code = :code", nativeQuery = true)
    Optional<PieceRow> findRowByCode(@Param("instituteId") String instituteId, @Param("code") String code);

    @Query(value = ROW + " WHERE cp.institute_id = :instituteId AND cp.receipt_line_id = :receiptLineId"
            + " ORDER BY cp.id", nativeQuery = true)
    List<PieceRow> findRowsByReceiptLine(@Param("instituteId") String instituteId,
                                         @Param("receiptLineId") String receiptLineId);

    /**
     * Compare-and-set of the status. The piece must be in :fromStatus and, when
     * :fromLocationId is given, at that location. 1 = this caller moved it.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece
            SET status = :toStatus, location_id = CAST(:toLocationId AS varchar), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = :fromStatus
              AND (CAST(:fromLocationId AS varchar) IS NULL OR location_id = CAST(:fromLocationId AS varchar))
            """, nativeQuery = true)
    int transition(@Param("instituteId") String instituteId, @Param("id") String id,
                   @Param("fromStatus") String fromStatus, @Param("fromLocationId") String fromLocationId,
                   @Param("toStatus") String toStatus, @Param("toLocationId") String toLocationId);

    // -- Order desk (WP-30) --

    /** The pieces named for an order line (packed, shipped or back from an RTO), by code. */
    @Query(value = ROW + " WHERE cp.institute_id = :instituteId AND cp.order_line_id = :orderLineId"
            + " ORDER BY cp.code", nativeQuery = true)
    List<PieceRow> findRowsByOrderLine(@Param("instituteId") String instituteId,
                                       @Param("orderLineId") String orderLineId);

    /** Packing: a piece IN_STOCK at the location becomes RESERVED for the order line. 1 = this caller won. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece
            SET status = 'RESERVED', order_line_id = :orderLineId, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'IN_STOCK' AND location_id = :locationId
            """, nativeQuery = true)
    int reserveForLine(@Param("instituteId") String instituteId, @Param("id") String pieceId,
                       @Param("locationId") String locationId, @Param("orderLineId") String orderLineId);

    /** Unpacking or a line cancel: a piece RESERVED for the line goes back IN_STOCK. 1 = this caller won. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece
            SET status = 'IN_STOCK', order_line_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'RESERVED' AND order_line_id = :orderLineId
            """, nativeQuery = true)
    int unreserve(@Param("instituteId") String instituteId, @Param("id") String pieceId,
                  @Param("orderLineId") String orderLineId);

    // -- Counter sale (WP-42) --

    /**
     * A counter sale: the piece the ledger just moved IN_STOCK to SOLD (its compare-and-set, under
     * the piece row lock, in the caller's transaction) is named for the order line. 1 = linked;
     * 0 = the piece is not SOLD. A piece that came back from an earlier sale (a return) still
     * names that sale's line, so the old line is replaced, as packing does.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece
            SET order_line_id = :orderLineId, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'SOLD'
            """, nativeQuery = true)
    int linkSoldToLine(@Param("instituteId") String instituteId, @Param("id") String pieceId,
                       @Param("orderLineId") String orderLineId);

    /**
     * The void of a counter sale: the piece the ledger just moved back IN_STOCK leaves its line.
     * 1 = unlinked.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece
            SET order_line_id = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id AND status = 'IN_STOCK' AND order_line_id = :orderLineId
            """, nativeQuery = true)
    int unlinkFromLine(@Param("instituteId") String instituteId, @Param("id") String pieceId,
                       @Param("orderLineId") String orderLineId);

    /** Written only by StockLedgerService, with the piece row locked. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_piece SET unit_cost = CAST(:unitCost AS numeric), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int setUnitCost(@Param("instituteId") String instituteId, @Param("id") String id,
                    @Param("unitCost") BigDecimal unitCost);

    /** :locationIds is ignored when :allLocations is true (pass any non-empty list). */
    @Query("""
            SELECT p FROM CommercePiece p
            WHERE p.instituteId = :instituteId
              AND (:allLocations = TRUE OR p.locationId IN :locationIds)
              AND (:packageSessionId IS NULL OR p.packageSessionId = :packageSessionId)
              AND (:status IS NULL OR p.status = :status)
            """)
    Page<CommercePiece> search(@Param("instituteId") String instituteId,
                               @Param("allLocations") boolean allLocations,
                               @Param("locationIds") Collection<String> locationIds,
                               @Param("packageSessionId") String packageSessionId,
                               @Param("status") String status,
                               Pageable pageable);
}
