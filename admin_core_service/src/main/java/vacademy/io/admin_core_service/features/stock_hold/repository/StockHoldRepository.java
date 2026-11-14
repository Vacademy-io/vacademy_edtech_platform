package vacademy.io.admin_core_service.features.stock_hold.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;

import java.util.Collection;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Reads return {@link StockHoldRow} projections, not entities: a projection is read from the
 * database every time, while an entity query hands back whatever copy this transaction already
 * holds, which may be stale. Every status change is a compare-and-set UPDATE
 * ({@code WHERE status = :from}), so the webhook, the expiry job and the release endpoint can race
 * on one row and only one of them wins.
 *
 * <p>The writes carry no {@code @Transactional} of their own: they always run inside a
 * StockHoldService transaction, and a participating repository proxy would mark that (webhook)
 * transaction rollback-only on any exception, even one the service catches.
 */
@Repository
public interface StockHoldRepository extends JpaRepository<StockHold, String> {

    interface StockHoldRow {
        String getId();
        String getPackageSessionId();
        String getUserId();
        String getInstituteId();
        String getUserPlanId();
        String getPaymentLogId();
        String getKind();
        Integer getQuantity();
        String getStatus();
        String getClaimedByUserPlanId();
    }

    interface HeldQuantityRow {
        String getPackageSessionId();
        Long getHeld();
    }

    String ROW_SELECT = "SELECT h.id AS id, h.packageSessionId AS packageSessionId, h.userId AS userId, "
            + "h.instituteId AS instituteId, h.userPlanId AS userPlanId, h.paymentLogId AS paymentLogId, h.kind AS kind, "
            + "h.quantity AS quantity, h.status AS status, h.claimedByUserPlanId AS claimedByUserPlanId "
            + "FROM StockHold h ";

    @Query(ROW_SELECT + "WHERE h.id = :id")
    Optional<StockHoldRow> findRowById(@Param("id") String id);

    /** Rows the plan owns, plus RENT_PREFERENCE rows it claimed. */
    @Query(ROW_SELECT + "WHERE h.userPlanId = :userPlanId OR h.claimedByUserPlanId = :userPlanId")
    List<StockHoldRow> findRowsOwnedOrClaimedByPlan(@Param("userPlanId") String userPlanId);

    @Query(ROW_SELECT + "WHERE h.paymentLogId = :paymentLogId AND h.status = 'HELD'")
    List<StockHoldRow> findHeldRowsByPaymentLogId(@Param("paymentLogId") String paymentLogId);

    /** HELD rows past their expiry whose order payment log is not PAID (or was never linked). */
    @Query(ROW_SELECT + "WHERE h.status = 'HELD' AND h.expiresAt < :now "
            + "AND NOT EXISTS (SELECT pl.id FROM PaymentLog pl "
            + "WHERE pl.id = h.paymentLogId AND pl.paymentStatus = 'PAID') "
            + "ORDER BY h.expiresAt")
    List<StockHoldRow> findExpiredUnpaidHeldRows(@Param("now") Date now, Pageable pageable);

    /** This learner's paid rent picks that no admin assignment has used yet, oldest first. */
    @Query(ROW_SELECT + "WHERE h.userId = :userId AND h.kind = 'RENT_PREFERENCE' AND h.status = 'SOLD' "
            + "AND h.claimedByUserPlanId IS NULL ORDER BY h.createdAt")
    List<StockHoldRow> findUnclaimedSoldRentPreferences(@Param("userId") String userId);

    boolean existsByUserPlanIdOrClaimedByUserPlanId(String userPlanId, String claimedByUserPlanId);

    @Query("SELECT COALESCE(SUM(h.quantity), 0L) FROM StockHold h "
            + "WHERE h.packageSessionId = :packageSessionId AND h.status = 'HELD'")
    Long sumHeldQuantity(@Param("packageSessionId") String packageSessionId);

    @Query("SELECT h.packageSessionId AS packageSessionId, SUM(h.quantity) AS held FROM StockHold h "
            + "WHERE h.packageSessionId IN :packageSessionIds AND h.status = 'HELD' "
            + "GROUP BY h.packageSessionId")
    List<HeldQuantityRow> sumHeldQuantityByPackageSession(
            @Param("packageSessionIds") Collection<String> packageSessionIds);

    // ── Compare-and-set writes. Each returns 1 when this caller won the row, 0 otherwise. ──
    // flushAutomatically: rows saved earlier in the same transaction must reach the table
    // before the UPDATE looks for them.

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET status = :toStatus, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = :fromStatus
            """, nativeQuery = true)
    int transitionStatus(@Param("id") String id, @Param("fromStatus") String fromStatus,
                         @Param("toStatus") String toStatus);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET status = 'SOLD', oversold = :oversold, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = :fromStatus
            """, nativeQuery = true)
    int markSold(@Param("id") String id, @Param("fromStatus") String fromStatus,
                 @Param("oversold") boolean oversold);

    /** HELD → RELEASED, but never once the order's payment log reads PAID. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold h SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP
            WHERE h.id = :id AND h.status = 'HELD'
              AND NOT EXISTS (SELECT 1 FROM payment_log pl
                              WHERE pl.id = h.payment_log_id AND pl.payment_status = 'PAID')
            """, nativeQuery = true)
    int releaseIfUnpaid(@Param("id") String id);

    /** SOLD → RESTORED for a row the plan owns that no admin assignment claimed. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET status = 'RESTORED', updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'SOLD' AND claimed_by_user_plan_id IS NULL
            """, nativeQuery = true)
    int restoreUnclaimed(@Param("id") String id);

    /** SOLD → RESTORED for a RENT_PREFERENCE row this plan claimed. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET status = 'RESTORED', updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND status = 'SOLD' AND claimed_by_user_plan_id = :userPlanId
            """, nativeQuery = true)
    int restoreClaimed(@Param("id") String id, @Param("userPlanId") String userPlanId);

    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET claimed_by_user_plan_id = :userPlanId, updated_at = CURRENT_TIMESTAMP
            WHERE id = :id AND kind = 'RENT_PREFERENCE' AND status = 'SOLD'
              AND claimed_by_user_plan_id IS NULL
            """, nativeQuery = true)
    int claim(@Param("id") String id, @Param("userPlanId") String userPlanId);

    // ── attach(): one column per statement, so a null argument leaves that column alone ──

    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE stock_hold SET user_id = :userId, updated_at = CURRENT_TIMESTAMP WHERE id IN (:ids)",
            nativeQuery = true)
    int setUserId(@Param("ids") Collection<String> ids, @Param("userId") String userId);

    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE stock_hold SET user_plan_id = :userPlanId, updated_at = CURRENT_TIMESTAMP WHERE id IN (:ids)",
            nativeQuery = true)
    int setUserPlanId(@Param("ids") Collection<String> ids, @Param("userPlanId") String userPlanId);

    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE stock_hold SET payment_log_id = :paymentLogId, updated_at = CURRENT_TIMESTAMP WHERE id IN (:ids)",
            nativeQuery = true)
    int setPaymentLogId(@Param("ids") Collection<String> ids, @Param("paymentLogId") String paymentLogId);
}
