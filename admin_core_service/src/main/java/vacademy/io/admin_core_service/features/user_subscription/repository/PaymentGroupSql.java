package vacademy.io.admin_core_service.features.user_subscription.repository;

/**
 * SQL for payments stored as several payment_log rows (payment_log.payment_group_id, V642).
 *
 * <p>One payment the learner made is sometimes stored per course: an admission package payment
 * split between its courses, or a multi-course checkout. Those rows share a payment_group_id, so
 * <b>counting</b> payments counts {@link #GROUP_KEY_PL} once, while <b>summing</b> money still sums
 * the rows (each holds its own course's share, so the sum is the payment).
 *
 * <p>A product-page checkout also writes a parent row with no user plan that holds the gateway
 * total; its children (one per course) hold the same money again. The parent's id is the group id.
 * Every money figure must skip that parent while its course rows hold the money, or the checkout
 * counts twice: {@link #NOT_ORDER_PARENT_PL}. Voided rows count as holding it, because voiding a
 * course row is what takes that money back out and the parent must not bring it back. A parent whose
 * course rows never settled (none written, or all still pending or failed) is still counted, as
 * before: then it is the only record of the money.
 *
 * <p>Constants, not methods, so repository {@code @Query} annotations can use them. They read the
 * payment_log alias {@code pl}, start and end with a space, and carry only balanced quotes (Spring
 * Data scans {@code @Query} text for quotes and fails the boot on an unbalanced one).
 */
public final class PaymentGroupSql {

    private PaymentGroupSql() {
    }

    /** One value per payment: the group for a grouped row, the row itself otherwise. */
    public static final String GROUP_KEY_PL = " COALESCE(pl.payment_group_id, pl.id) ";

    /** True for a checkout's planless parent row whose per-course rows hold its money. */
    public static final String IS_ORDER_PARENT_PL = " (pl.user_plan_id IS NULL"
            + " AND pl.payment_group_id IS NOT NULL"
            + " AND pl.payment_group_id = pl.id"
            + " AND EXISTS (SELECT 1 FROM payment_log grp_child"
            + " WHERE grp_child.payment_group_id = pl.id"
            + " AND grp_child.id <> pl.id"
            + " AND grp_child.user_plan_id IS NOT NULL"
            + " AND grp_child.payment_status IN ('PAID', 'VOIDED'))) ";

    /** Money figures: leave out a checkout's parent row while its per-course rows hold the money. */
    public static final String NOT_ORDER_PARENT_PL = " NOT" + IS_ORDER_PARENT_PL;
}
