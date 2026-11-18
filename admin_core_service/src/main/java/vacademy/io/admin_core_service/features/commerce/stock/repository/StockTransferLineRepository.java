package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransferLine;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;

/** Lines of a transfer. Written only by StockTransferService while it holds the transfer row lock. */
public interface StockTransferLineRepository extends JpaRepository<StockTransferLine, String> {

    List<StockTransferLine> findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(String instituteId,
                                                                                 String transferId);

    /** Line count and units sent per transfer, for a list page. */
    interface LineTotals {
        String getTransferId();
        Long getLineCount();
        Long getQtySent();
    }

    @Query(value = """
            SELECT l.transfer_id AS transferId, COUNT(*) AS lineCount, COALESCE(SUM(l.qty_sent), 0) AS qtySent
            FROM stock_transfer_line l
            WHERE l.institute_id = :instituteId AND l.transfer_id IN (:transferIds)
            GROUP BY l.transfer_id
            """, nativeQuery = true)
    List<LineTotals> totals(@Param("instituteId") String instituteId,
                            @Param("transferIds") Collection<String> transferIds);

    /** A draft's lines are replaced as a whole. */
    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query(value = "DELETE FROM stock_transfer_line WHERE institute_id = :instituteId AND transfer_id = :transferId",
            nativeQuery = true)
    int deleteOfTransfer(@Param("instituteId") String instituteId, @Param("transferId") String transferId);

    /** Copied at dispatch, so the challan reads the same whenever it is printed. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_transfer_line
            SET unit_value = CAST(:unitValue AS numeric), hsn_code = CAST(:hsnCode AS varchar),
                sku = CAST(:sku AS varchar), item_name = CAST(:itemName AS varchar), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int stampDispatch(@Param("instituteId") String instituteId, @Param("id") String id,
                      @Param("unitValue") BigDecimal unitValue, @Param("hsnCode") String hsnCode,
                      @Param("sku") String sku, @Param("itemName") String itemName);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_transfer_line
            SET qty_received = :qtyReceived, shortfall_reason = CAST(:reason AS varchar), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int stampReceived(@Param("instituteId") String instituteId, @Param("id") String id,
                      @Param("qtyReceived") int qtyReceived, @Param("reason") String reason);
}
