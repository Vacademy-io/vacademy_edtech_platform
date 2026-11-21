package vacademy.io.admin_core_service.features.commerce.order.repository;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;

/**
 * What an order reads and writes on the legacy tables ({@code payment_log}, {@code user_plan},
 * {@code stock_hold}) and on the sale links of a variant. Every statement names its rows by id,
 * and the ids are those of one commerce order, so nothing here can touch a course row. Column
 * updates, not entity saves: a save would write a whole row back over a status the webhook or
 * the expiry job set in the meantime.
 */
public interface CommerceOrderLegacyRepository extends Repository<CommerceOrder, String> {

    /** The sale link of a variant: the invite, the payment option and its ACTIVE plans. */
    interface SaleLinkRow {
        String getPackageSessionId();
        String getEnrollInviteId();
        String getPaymentOptionId();
        String getPaymentPlanId();
        BigDecimal getActualPrice();
        String getCurrency();
    }

    /**
     * The same rows, in the same order, as the cart prices from: the first link of a variant
     * and its first ACTIVE plan decide. A package session of another institute, or one that is
     * not a variant, has no row.
     */
    @Query(value = """
            SELECT l.package_session_id AS packageSessionId, l.enroll_invite_id AS enrollInviteId,
                   l.payment_option_id AS paymentOptionId, pl.id AS paymentPlanId,
                   CAST(pl.actual_price AS NUMERIC(14, 2)) AS actualPrice, pl.currency AS currency
            FROM package_session_learner_invitation_to_payment_option l
            JOIN enroll_invite ei ON ei.id = l.enroll_invite_id
            JOIN commerce_variant v ON v.package_session_id = l.package_session_id
            LEFT JOIN payment_plan pl ON pl.payment_option_id = l.payment_option_id AND pl.status = 'ACTIVE'
            WHERE ei.institute_id = :instituteId
              AND ei.tag = 'COMMERCE'
              AND v.institute_id = :instituteId
              AND l.package_session_id IN (:packageSessionIds)
            ORDER BY l.created_at ASC, l.id ASC, pl.created_at ASC, pl.id ASC
            """, nativeQuery = true)
    List<SaleLinkRow> findSaleLinks(@Param("instituteId") String instituteId,
                                    @Param("packageSessionIds") Collection<String> packageSessionIds);

    /** A new log becomes a pending payment of the order's group. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE payment_log
            SET status = 'ACTIVE', payment_status = 'PAYMENT_PENDING', payment_group_id = :groupId
            WHERE id IN (:ids) AND payment_status IS NULL
            """, nativeQuery = true)
    int markLogsPending(@Param("ids") Collection<String> ids, @Param("groupId") String groupId);

    /** The gateway order on every log of the order; the JSON keeps originalRequest.order_id. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE payment_log SET payment_specific_data = :json
            WHERE id IN (:ids) AND payment_group_id = :groupId
            """, nativeQuery = true)
    int storeGatewayDataOnLogs(@Param("ids") Collection<String> ids, @Param("groupId") String groupId,
                               @Param("json") String json);

    @Query(value = "SELECT pl.payment_group_id FROM payment_log pl WHERE pl.id = :id", nativeQuery = true)
    String findGroupIdOfLog(@Param("id") String id);

    interface LogRow {
        String getId();
        String getPaymentStatus();
        BigDecimal getAmount();
        String getUserPlanId();
    }

    @Query(value = """
            SELECT pl.id AS id, pl.payment_status AS paymentStatus,
                   CAST(pl.payment_amount AS NUMERIC(14, 2)) AS amount, pl.user_plan_id AS userPlanId
            FROM payment_log pl
            WHERE pl.payment_group_id = :groupId
            ORDER BY pl.id
            """, nativeQuery = true)
    List<LogRow> findLogsOfGroup(@Param("groupId") String groupId);

    /**
     * An unpaid order was cancelled: its plans that were waiting for the payment close, and so
     * do the plans a failed attempt left PAYMENT_FAILED. A late payment still activates a
     * CANCELED plan ({@code activateCommercePlan}).
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE user_plan SET status = 'CANCELED'
            WHERE id IN (:ids) AND status IN ('PENDING_FOR_PAYMENT', 'PAYMENT_FAILED')
            """, nativeQuery = true)
    int cancelPendingPlans(@Param("ids") Collection<String> ids);

    /**
     * A cancelled order (or line): its plans close, paid or not. A late payment still activates
     * a CANCELED plan, so this is only for orders staff have cancelled.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE user_plan SET status = 'CANCELED'
            WHERE id IN (:ids) AND status IN ('ACTIVE', 'PENDING_FOR_PAYMENT', 'PAYMENT_FAILED')
            """, nativeQuery = true)
    int cancelPlans(@Param("ids") Collection<String> ids);

    /** The amount a log of an unpaid order carries, after a line cancel; a PAID log is never changed. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE payment_log SET payment_amount = CAST(:amount AS DOUBLE PRECISION)
            WHERE id = :id AND payment_group_id = :groupId AND payment_status IS DISTINCT FROM 'PAID'
            """, nativeQuery = true)
    int setLogAmount(@Param("id") String id, @Param("groupId") String groupId, @Param("amount") BigDecimal amount);

    /** Logs of an order paid outside the gateway (cash on delivery, a staff order): vendor and mode. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE payment_log SET vendor = 'OFFLINE', vendor_id = 'OFFLINE', payment_mode = CAST(:mode AS VARCHAR)
            WHERE id IN (:ids) AND payment_group_id = :groupId
            """, nativeQuery = true)
    int markLogsOffline(@Param("ids") Collection<String> ids, @Param("groupId") String groupId,
                        @Param("mode") String paymentMode);

    interface HoldRow {
        String getId();
        String getUserPlanId();
        String getPackageSessionId();
        String getStatus();
        Boolean getOversold();
        Integer getQuantity();
    }

    @Query(value = """
            SELECT h.id AS id, h.user_plan_id AS userPlanId, h.package_session_id AS packageSessionId,
                   h.status AS status, h.oversold AS oversold, h.quantity AS quantity
            FROM stock_hold h
            WHERE h.user_plan_id IN (:planIds)
            ORDER BY h.package_session_id, h.id
            """, nativeQuery = true)
    List<HoldRow> findHoldsOfPlans(@Param("planIds") Collection<String> planIds);

    /**
     * An unpaid order was cancelled: the one use it took of its coupon goes back. A coupon
     * without a limit (NULL) is left alone. The caller holds the order row lock and calls this
     * once per order.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE coupon_code SET usage_limit = usage_limit + 1
            WHERE id = (SELECT a.coupon_code_id FROM applied_coupon_discount a WHERE a.id = :appliedId)
              AND usage_limit IS NOT NULL
            """, nativeQuery = true)
    int giveCouponUseBack(@Param("appliedId") String appliedCouponDiscountId);

    /** A late payment confirmed a cancelled order: its coupon use is taken again if one is left. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE coupon_code SET usage_limit = usage_limit - 1
            WHERE id = (SELECT a.coupon_code_id FROM applied_coupon_discount a WHERE a.id = :appliedId)
              AND usage_limit IS NOT NULL AND usage_limit > 0
            """, nativeQuery = true)
    int takeCouponUseAgain(@Param("appliedId") String appliedCouponDiscountId);

    /** 1 when the coupon of this applied discount has a usage limit, else 0. */
    @Query(value = """
            SELECT COUNT(*) FROM coupon_code c
            JOIN applied_coupon_discount a ON a.coupon_code_id = c.id
            WHERE a.id = :appliedId AND c.usage_limit IS NOT NULL
            """, nativeQuery = true)
    long couponIsLimited(@Param("appliedId") String appliedCouponDiscountId);

    /** The fulfilment location on the holds of an order; set once, at placement. */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            UPDATE stock_hold SET fulfilment_location_id = :locationId, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (:ids) AND fulfilment_location_id IS NULL
            """, nativeQuery = true)
    int setHoldLocation(@Param("ids") Collection<String> ids, @Param("locationId") String locationId);
}
