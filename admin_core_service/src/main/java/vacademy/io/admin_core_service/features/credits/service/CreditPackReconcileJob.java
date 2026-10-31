package vacademy.io.admin_core_service.features.credits.service;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformRazorpayWebHookService;

import java.util.List;

/**
 * Hourly safety net for credit-pack Payment Links (F1 / F7): a link that was paid but whose
 * webhook was lost (or kept failing until Razorpay gave up) gets its credits through the normal
 * locked fulfilment path; a link Razorpay reports expired or cancelled closes the row as EXPIRED.
 * See {@link PlatformRazorpayWebHookService#reconcileFromLink}.
 *
 * <p>Dark until {@code billing.packs.reconcile.enabled} is true (no Razorpay call before that).
 * Only links created with an {@code expire_by} (every pack link since F7) and at most two days
 * past it are checked, so the pre-F7 rows that never expire are not polled forever.
 */
@Slf4j
@Component
public class CreditPackReconcileJob {

    static final int MIN_AGE_MINUTES = 30;
    static final int BATCH = 100;

    /**
     * Unsettled NORMAL credit-pack payments raised through a link. One line per fragment, each
     * ending in a space (no text block: its trailing spaces would be stripped and glue the SQL).
     */
    static final String SELECT_OPEN_PACK_LINKS = "SELECT p.id FROM platform_payment p "
            + "WHERE left(p.vendor_order_id, 6) = 'plink_' "
            + "AND p.disposition = 'NORMAL' "
            + "AND (p.payment_status = 'PAYMENT_PENDING' OR p.payment_status = 'FAILED') "
            + "AND p.link_expires_at IS NOT NULL "
            + "AND p.link_expires_at > now() - interval '2 days' "
            + "AND p.created_at < now() - make_interval(mins => ?) "
            + "AND NOT EXISTS (SELECT 1 FROM platform_payment_item i "
            + "WHERE i.platform_payment_id = p.id AND i.item_kind <> 'CREDIT_PACK') "
            + "ORDER BY p.created_at ASC LIMIT ?";

    private final JdbcTemplate jdbcTemplate;
    private final PlatformBillingFlags flags;
    private final PlatformRazorpayWebHookService webhookService;

    public CreditPackReconcileJob(JdbcTemplate jdbcTemplate, PlatformBillingFlags flags,
            PlatformRazorpayWebHookService webhookService) {
        this.jdbcTemplate = jdbcTemplate;
        this.flags = flags;
        this.webhookService = webhookService;
    }

    @Scheduled(cron = "0 47 * * * *", zone = "UTC")
    @SchedulerLock(name = "CreditPackReconcileJob", lockAtMostFor = "PT20M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            int[] r = runOnce();
            if (r != null && r[0] > 0) {
                log.info("[credit-pack-reconcile] checked={} settledOrClosed={} errors={}", r[0], r[1], r[2]);
            }
        } catch (Exception e) {
            log.error("[credit-pack-reconcile] pass failed", e);
        }
    }

    /**
     * One pass. Package-private for tests.
     *
     * @return {checked, paid-or-closed, errors}, or null when the switch is off
     */
    int[] runOnce() {
        if (!flags.packReconcileEnabled()) {
            return null;
        }
        List<String> ids = jdbcTemplate.queryForList(SELECT_OPEN_PACK_LINKS, String.class, MIN_AGE_MINUTES, BATCH);
        int checked = 0;
        int changed = 0;
        int errors = 0;
        for (String id : ids) {
            try {
                String status = webhookService.reconcileFromLink(id);
                if (status != null) {
                    checked++;
                    if (!"created".equalsIgnoreCase(status)) {
                        changed++;
                    }
                }
            } catch (Exception e) {
                errors++;
                log.warn("[credit-pack-reconcile] platform_payment {}: {}", id, e.getMessage());
            }
        }
        return new int[] { checked, changed, errors };
    }
}
