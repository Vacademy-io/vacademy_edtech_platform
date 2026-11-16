package vacademy.io.admin_core_service.features.commerce.stock.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLevel;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * What the stock code reads and writes on commerce_variant, in SQL. The catalogue entity is
 * not used here: a managed copy could be older than the cost another transaction just wrote,
 * and saving it would write that old cost back. The cost columns are written by
 * StockLedgerService only, after {@link #lockCost}.
 */
public interface StockVariantRepository extends Repository<StockLevel, String> {

    interface VariantFacts {
        String getPackageSessionId();
        String getPackageId();
        String getSku();
        String getBarcode();
        String getLabelCode();
        String getStockPolicy();
        String getStatus();
        BigDecimal getCostPrice();
        BigDecimal getStandardCost();
        String getStockMode();
        String getUnit();
        Integer getQtyScale();
        String getVariantName();
        String getProductName();
    }

    interface VariantCost {
        BigDecimal getCostPrice();
        BigDecimal getStandardCost();
    }

    String FACTS = """
            SELECT cv.package_session_id AS packageSessionId, cv.package_id AS packageId, cv.sku AS sku,
                   cv.barcode AS barcode, cv.label_code AS labelCode, cv.stock_policy AS stockPolicy,
                   cv.status AS status, cv.cost_price AS costPrice, cv.standard_cost AS standardCost,
                   cp.stock_mode AS stockMode, cp.unit AS unit, cp.qty_scale AS qtyScale,
                   ps.name AS variantName, p.package_name AS productName
            FROM commerce_variant cv
            JOIN commerce_product cp ON cp.package_id = cv.package_id AND cp.institute_id = cv.institute_id
            LEFT JOIN package_session ps ON ps.id = cv.package_session_id
            LEFT JOIN package p ON p.id = cv.package_id
            """;

    /** Empty when the package session is not a shop variant of this institute. */
    @Query(value = FACTS + " WHERE cv.institute_id = :instituteId AND cv.package_session_id = :packageSessionId",
            nativeQuery = true)
    Optional<VariantFacts> findFacts(@Param("instituteId") String instituteId,
                                     @Param("packageSessionId") String packageSessionId);

    @Query(value = FACTS + " WHERE cv.institute_id = :instituteId AND cv.package_session_id IN (:packageSessionIds)",
            nativeQuery = true)
    List<VariantFacts> findFactsIn(@Param("instituteId") String instituteId,
                                   @Param("packageSessionIds") java.util.Collection<String> packageSessionIds);

    @Query(value = FACTS + " WHERE cv.institute_id = :instituteId AND cv.label_code = :labelCode", nativeQuery = true)
    Optional<VariantFacts> findFactsByLabelCode(@Param("instituteId") String instituteId,
                                                @Param("labelCode") String labelCode);

    @Query(value = FACTS + " WHERE cv.institute_id = :instituteId AND cv.barcode = :barcode", nativeQuery = true)
    Optional<VariantFacts> findFactsByBarcode(@Param("instituteId") String instituteId,
                                              @Param("barcode") String barcode);

    @Query(value = FACTS + " WHERE cv.institute_id = :instituteId AND cv.sku = :sku", nativeQuery = true)
    Optional<VariantFacts> findFactsBySku(@Param("instituteId") String instituteId, @Param("sku") String sku);

    /** Locks the variant row (lock order 9) and returns its costs, read after the lock. */
    @Query(value = """
            SELECT cv.cost_price AS costPrice, cv.standard_cost AS standardCost
            FROM commerce_variant cv
            WHERE cv.institute_id = :instituteId AND cv.package_session_id = :packageSessionId
            FOR UPDATE
            """, nativeQuery = true)
    Optional<VariantCost> lockCost(@Param("instituteId") String instituteId,
                                   @Param("packageSessionId") String packageSessionId);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_variant SET cost_price = CAST(:costPrice AS numeric), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND package_session_id = :packageSessionId
            """, nativeQuery = true)
    int setCostPrice(@Param("instituteId") String instituteId, @Param("packageSessionId") String packageSessionId,
                     @Param("costPrice") BigDecimal costPrice);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_variant SET standard_cost = CAST(:standardCost AS numeric), updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND package_session_id = :packageSessionId
            """, nativeQuery = true)
    int setStandardCost(@Param("instituteId") String instituteId,
                        @Param("packageSessionId") String packageSessionId,
                        @Param("standardCost") BigDecimal standardCost);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_variant
            SET last_purchase_cost = CAST(:cost AS numeric), last_purchase_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND package_session_id = :packageSessionId
            """, nativeQuery = true)
    int setLastPurchaseCost(@Param("instituteId") String instituteId,
                            @Param("packageSessionId") String packageSessionId,
                            @Param("cost") BigDecimal cost);

    /** Gives the variant its scan label once. 1 = this code was stored, 0 = it already had one. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE commerce_variant SET label_code = :labelCode, updated_at = CURRENT_TIMESTAMP
            WHERE institute_id = :instituteId AND package_session_id = :packageSessionId
              AND label_code IS NULL
            """, nativeQuery = true)
    int setLabelCodeIfMissing(@Param("instituteId") String instituteId,
                              @Param("packageSessionId") String packageSessionId,
                              @Param("labelCode") String labelCode);

    @Query(value = "SELECT COUNT(*) FROM commerce_variant cv WHERE cv.label_code = :labelCode", nativeQuery = true)
    long countByLabelCode(@Param("labelCode") String labelCode);

    // -- commerce_counter: running numbers, taken in a short transaction of their own.

    @Modifying(flushAutomatically = true)
    @Query(value = """
            INSERT INTO commerce_counter (id, institute_id, scope_key, next_value)
            VALUES (:id, :instituteId, :scopeKey, 1)
            ON CONFLICT (institute_id, scope_key)
            DO UPDATE SET next_value = commerce_counter.next_value + 1, updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    int bumpCounter(@Param("id") String id, @Param("instituteId") String instituteId,
                    @Param("scopeKey") String scopeKey);

    /** Read in the transaction that just bumped the row, which still holds its lock. */
    @Query(value = """
            SELECT c.next_value FROM commerce_counter c
            WHERE c.institute_id = :instituteId AND c.scope_key = :scopeKey
            """, nativeQuery = true)
    Long readCounter(@Param("instituteId") String instituteId, @Param("scopeKey") String scopeKey);
}
