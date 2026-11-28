package vacademy.io.admin_core_service.features.ai_plans_billing.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Read-only lookups over {@code platform_payment} / {@code platform_payment_item} for AI
 * subscription items (item_kind AI_SUBSCRIPTION). Ids only; callers load the entities.
 * Plain string SQL, no text blocks, no {@code ::} casts.
 */
@Repository
public class AiSubscriptionPaymentQueries {

    private final JdbcTemplate jdbc;

    public AiSubscriptionPaymentQueries(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Payments raised for one charge, newest first. */
    public List<String> paymentIdsForCharge(String chargeId) {
        return jdbc.queryForList("SELECT p.id FROM platform_payment p JOIN platform_payment_item i "
                + "ON i.platform_payment_id = p.id WHERE i.item_kind = 'AI_SUBSCRIPTION' "
                + "AND i.subscription_charge_id = ? ORDER BY p.created_at DESC", String.class, chargeId);
    }

    /**
     * Unsettled subscription payments older than {@code minAgeMinutes} (links and debits whose
     * webhook may have been lost): INITIATED, or FAILED with a link that may still be payable.
     */
    public List<String> staleOpenPaymentIds(int minAgeMinutes, int limit) {
        return jdbc.queryForList("SELECT p.id FROM platform_payment p WHERE p.payment_status IN ('PAYMENT_PENDING', 'FAILED') "
                + "AND p.status IN ('INITIATED', 'FAILED') AND p.vendor_order_id IS NOT NULL "
                + "AND p.created_at < now() - make_interval(mins => ?) "
                + "AND p.created_at > now() - interval '200 days' "
                + "AND (p.payment_status = 'PAYMENT_PENDING' OR p.link_expires_at > now()) "
                + "AND EXISTS (SELECT 1 FROM platform_payment_item i WHERE i.platform_payment_id = p.id "
                + "AND i.item_kind = 'AI_SUBSCRIPTION') ORDER BY p.created_at ASC LIMIT ?",
                String.class, minAgeMinutes, limit);
    }

    /**
     * Paid NORMAL subscription payments without an invoice {@code minAgeMinutes} after they became
     * PAID ({@code paid_at}; rows paid before V590 fall back to created_at). Refunded ones too: the
     * service was supplied, so a tax invoice (and then its credit notes) is still owed.
     */
    public List<String> paidWithoutInvoice(int minAgeMinutes, int limit) {
        return jdbc.queryForList("SELECT p.id FROM platform_payment p "
                + "WHERE p.payment_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') "
                + "AND p.disposition = 'NORMAL' AND COALESCE(p.paid_at, p.created_at) < now() - make_interval(mins => ?) "
                + "AND COALESCE(p.paid_at, p.created_at) > now() - interval '60 days' "
                + "AND NOT EXISTS (SELECT 1 FROM platform_invoice v WHERE v.platform_payment_id = p.id) "
                + "AND EXISTS (SELECT 1 FROM platform_payment_item i WHERE i.platform_payment_id = p.id "
                + "AND i.item_kind = 'AI_SUBSCRIPTION' AND i.subscription_charge_id IS NOT NULL) "
                + "ORDER BY COALESCE(p.paid_at, p.created_at) ASC LIMIT ?", String.class, minAgeMinutes, limit);
    }

    /** Subscription payments of one institute (ops view), newest first. */
    public List<String> paymentIdsForInstitute(String instituteId, int limit) {
        return jdbc.queryForList("SELECT p.id FROM platform_payment p WHERE p.institute_id = ? AND EXISTS "
                + "(SELECT 1 FROM platform_payment_item i WHERE i.platform_payment_id = p.id "
                + "AND i.item_kind = 'AI_SUBSCRIPTION') ORDER BY p.created_at DESC LIMIT ?",
                String.class, instituteId, limit);
    }

    /** Subscription payments whose refund could not be reported to ai_service yet (handler flag). */
    public List<String> refundSyncPending(int limit) {
        return jdbc.queryForList("SELECT p.id FROM platform_payment p "
                + "WHERE (p.payment_specific_data ->> 'refundSyncPending') IS NOT NULL "
                + "AND p.payment_status IN ('PARTIALLY_REFUNDED', 'REFUNDED') "
                + "ORDER BY COALESCE(p.paid_at, p.created_at) ASC LIMIT ?",
                String.class, limit);
    }
}
