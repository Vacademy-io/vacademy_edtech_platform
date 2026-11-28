package vacademy.io.admin_core_service.features.ai_plans_billing.job;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionCollectionService.Report;

/**
 * Hourly AI-plan billing pass: payment links, autopay notices and debits, reminders, and the
 * reconcile of lost webhooks / expired links / missing invoices (see
 * {@link AiSubscriptionCollectionService}).
 *
 * <p>Dark until {@code billing.subscriptions.payments.enabled} is true (no HTTP call at all
 * before that). Minute 37 keeps it after the plan roll (minute 7), which creates the renewal
 * charges this job collects. {@code @SchedulerLock}: one replica per run.
 */
@Slf4j
@Component
public class AiSubscriptionBillingJob {

    private final AiSubscriptionCollectionService collection;

    public AiSubscriptionBillingJob(AiSubscriptionCollectionService collection) {
        this.collection = collection;
    }

    @Scheduled(cron = "0 37 * * * *", zone = "UTC")
    @SchedulerLock(name = "AiSubscriptionBillingJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            Report r = collection.runOnce();
            if (r == null) {
                log.debug("[ai-plans-billing] payments are off; skipping");
            } else if (r.errors.isEmpty()) {
                log.info("[ai-plans-billing] billing pass done: {}", r);
            } else {
                log.warn("[ai-plans-billing] billing pass done with errors: {} first={}", r, r.errors.get(0));
            }
        } catch (Exception e) {
            log.error("[ai-plans-billing] billing pass failed", e);
        }
    }
}
