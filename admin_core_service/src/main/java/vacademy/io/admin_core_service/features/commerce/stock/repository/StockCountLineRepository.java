package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCountLine;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Count lines. Written by native upserts only: a new or changed line takes
 * {@code counted_at = CURRENT_TIMESTAMP}, the database time the posting formula compares with
 * {@code stock_movement.created_at}.
 */
public interface StockCountLineRepository extends JpaRepository<StockCountLine, String> {

    List<StockCountLine> findByInstituteIdAndCountIdOrderByCreatedAtAscIdAsc(String instituteId, String countId);

    long countByInstituteIdAndCountId(String instituteId, String countId);

    Optional<StockCountLine> findByInstituteIdAndCountIdAndPackageSessionIdAndPieceIdIsNull(
            String instituteId, String countId, String packageSessionId);

    Optional<StockCountLine> findByInstituteIdAndCountIdAndPieceId(String instituteId, String countId,
                                                                    String pieceId);

    interface CountTotals {
        String getCountId();
        Long getLineCount();
    }

    @Query(value = """
            SELECT l.count_id AS countId, COUNT(*) AS lineCount FROM stock_count_line l
            WHERE l.institute_id = :instituteId AND l.count_id IN (:countIds)
            GROUP BY l.count_id
            """, nativeQuery = true)
    List<CountTotals> totals(@Param("instituteId") String instituteId, @Param("countIds") Collection<String> countIds);

    /** SET: the counted quantity of a quantity line becomes :quantity. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            INSERT INTO stock_count_line (id, institute_id, count_id, package_session_id, piece_id, counted_qty,
                                          counted_at, counted_by)
            VALUES (:id, :instituteId, :countId, :packageSessionId, NULL, :quantity, CURRENT_TIMESTAMP, :countedBy)
            ON CONFLICT (count_id, package_session_id) WHERE piece_id IS NULL
            DO UPDATE SET counted_qty = EXCLUDED.counted_qty, counted_at = CURRENT_TIMESTAMP,
                          counted_by = EXCLUDED.counted_by, updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int upsertSet(@Param("id") String id, @Param("instituteId") String instituteId, @Param("countId") String countId,
                  @Param("packageSessionId") String packageSessionId, @Param("quantity") int quantity,
                  @Param("countedBy") String countedBy);

    /** ADD: :quantity more units of a quantity line. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            INSERT INTO stock_count_line (id, institute_id, count_id, package_session_id, piece_id, counted_qty,
                                          counted_at, counted_by)
            VALUES (:id, :instituteId, :countId, :packageSessionId, NULL, :quantity, CURRENT_TIMESTAMP, :countedBy)
            ON CONFLICT (count_id, package_session_id) WHERE piece_id IS NULL
            DO UPDATE SET counted_qty = stock_count_line.counted_qty + EXCLUDED.counted_qty,
                          counted_at = CURRENT_TIMESTAMP, counted_by = EXCLUDED.counted_by,
                          updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int upsertAdd(@Param("id") String id, @Param("instituteId") String instituteId, @Param("countId") String countId,
                  @Param("packageSessionId") String packageSessionId, @Param("quantity") int quantity,
                  @Param("countedBy") String countedBy);

    /** A scanned piece. Scanned twice, it counts once. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            INSERT INTO stock_count_line (id, institute_id, count_id, package_session_id, piece_id, counted_qty,
                                          counted_at, counted_by)
            VALUES (:id, :instituteId, :countId, :packageSessionId, :pieceId, 1, CURRENT_TIMESTAMP, :countedBy)
            ON CONFLICT (count_id, piece_id) WHERE piece_id IS NOT NULL DO NOTHING
            """, nativeQuery = true)
    int insertPiece(@Param("id") String id, @Param("instituteId") String instituteId, @Param("countId") String countId,
                    @Param("packageSessionId") String packageSessionId, @Param("pieceId") String pieceId,
                    @Param("countedBy") String countedBy);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "DELETE FROM stock_count_line WHERE institute_id = :instituteId AND count_id = :countId AND id = :id",
            nativeQuery = true)
    int deleteLine(@Param("instituteId") String instituteId, @Param("countId") String countId, @Param("id") String id);

    /** The results of the post, written once. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_count_line
            SET on_hand_at_post = :onHand, moved_since = :movedSince, adjustment = :adjustment,
                movement_id = CAST(:movementId AS varchar), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int stampPost(@Param("instituteId") String instituteId, @Param("id") String id, @Param("onHand") int onHand,
                  @Param("movedSince") int movedSince, @Param("adjustment") int adjustment,
                  @Param("movementId") String movementId);
}
