package vacademy.io.admin_core_service.features.usage_metering.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageAllowanceService;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;

/**
 * Charges last month's storage and bandwidth to the credit wallet of every institute on a
 * CREDITS plan. Runs daily at 23:45 UTC (after the 22:30 metering run); from the 3rd of the
 * month it charges the previous month, once per institute (FAILED months are retried daily).
 * Switch off with {@code USAGE_CHARGING_ENABLED=false}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class UsageChargeJob {

    private final UsageAllowanceService allowanceService;

    @Value("${usage.charging.enabled:true}")
    private boolean enabled;

    @Scheduled(cron = "0 45 23 * * *", zone = "UTC")
    @SchedulerLock(name = "UsageChargeJob", lockAtMostFor = "PT1H", lockAtLeastFor = "PT5M")
    public void run() {
        if (!enabled) {
            log.info("[usage-charge] skipped (disabled)");
            return;
        }
        YearMonth month = UsageAllowanceService.monthToCharge(LocalDate.now(ZoneOffset.UTC));
        if (month == null) {
            return;
        }
        try {
            allowanceService.chargeMonth(month);
        } catch (Exception e) {
            log.error("[usage-charge] charging {} failed", month, e);
        }
    }
}
