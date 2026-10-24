package vacademy.io.admin_core_service.features.regional_pricing.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.regional_pricing.service.FxRateService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceService;

/**
 * Once a day: pull exchange rates, then reprice AUTO regional prices that drifted past the
 * threshold. MANUAL prices are never touched. ShedLock keeps it to one pod.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FxRateRefreshJob {

    private final FxRateService fxRateService;
    private final RegionalPriceService regionalPriceService;
    private final PaymentOptionRepository paymentOptionRepository;

    @Scheduled(cron = "${regional.pricing.fx.cron:0 15 1 * * ?}")
    @SchedulerLock(name = "FxRateRefreshJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            if (paymentOptionRepository.countByRegionalPricingEnabledTrue() == 0) {
                return; // nobody uses regional pricing — no outbound call
            }
            int rates = fxRateService.refreshRates();
            int repriced = regionalPriceService.refreshAllAutoRows();
            log.info("[FxRateRefreshJob] {} rates stored, {} AUTO regional prices repriced", rates, repriced);
        } catch (Exception e) {
            // Yesterday's rates and prices stay in place; checkout never depends on this job.
            log.error("[FxRateRefreshJob] failed: {}", e.getMessage(), e);
        }
    }
}
