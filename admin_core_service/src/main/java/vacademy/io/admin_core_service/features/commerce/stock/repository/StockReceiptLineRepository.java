package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockReceiptLine;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

public interface StockReceiptLineRepository extends JpaRepository<StockReceiptLine, String> {

    /** A line read fresh, with the header facts a cost change needs. */
    interface LineRow {
        String getId();
        String getReceiptId();
        String getPackageSessionId();
        Integer getQtyReceived();
        Integer getQtyBilled();
        BigDecimal getUnitCost();
        String getCostSource();
        String getReceiptStatus();
        String getSourceKind();
        String getLocationId();
    }

    String ROW = """
            SELECT rl.id AS id, rl.receipt_id AS receiptId, rl.package_session_id AS packageSessionId,
                   rl.qty_received AS qtyReceived, rl.qty_billed AS qtyBilled, rl.unit_cost AS unitCost,
                   rl.cost_source AS costSource, r.status AS receiptStatus, r.source_kind AS sourceKind,
                   r.location_id AS locationId
            FROM stock_receipt_line rl
            JOIN stock_receipt r ON r.id = rl.receipt_id
            """;

    List<StockReceiptLine> findByInstituteIdAndReceiptIdOrderByPackageSessionIdAscIdAsc(String instituteId,
                                                                                         String receiptId);

    @Query(value = ROW + " WHERE rl.institute_id = :instituteId AND rl.id = :id", nativeQuery = true)
    Optional<LineRow> findRow(@Param("instituteId") String instituteId, @Param("id") String id);

    @Query(value = ROW + " WHERE rl.institute_id = :instituteId AND rl.receipt_id = :receiptId"
            + " ORDER BY rl.package_session_id, rl.id", nativeQuery = true)
    List<LineRow> findRowsOfReceipt(@Param("instituteId") String instituteId, @Param("receiptId") String receiptId);

    /** The cost in force on a line. Written only by StockLedgerService. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
            UPDATE stock_receipt_line
            SET unit_cost = CAST(:unitCost AS numeric), cost_source = :costSource, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND id = :id
            """, nativeQuery = true)
    int setCost(@Param("instituteId") String instituteId, @Param("id") String id,
                @Param("unitCost") BigDecimal unitCost, @Param("costSource") String costSource);
}
