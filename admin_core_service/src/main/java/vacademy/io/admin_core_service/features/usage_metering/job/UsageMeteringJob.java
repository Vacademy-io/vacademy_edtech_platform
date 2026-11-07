package vacademy.io.admin_core_service.features.usage_metering.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.usage_metering.service.UsageMeteringService;

import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * Daily storage and bandwidth metering, 22:30 UTC (04:00 IST).
 *
 * <p>Storage comes from the newest S3 Inventory report. Bandwidth is metered for the two
 * previous UTC days: CloudFront can deliver a log file up to a day late, so yesterday is
 * provisional and is recomputed (replaced) the next night.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class UsageMeteringJob {

    private final UsageMeteringService meteringService;

    @Value("${usage.metering.enabled:true}")
    private boolean enabled;

    @Scheduled(cron = "0 30 22 * * *", zone = "UTC")
    @SchedulerLock(name = "UsageMeteringJob", lockAtMostFor = "PT2H", lockAtLeastFor = "PT5M")
    public void run() {
        if (!enabled || !meteringService.configured()) {
            log.info("[usage-metering] skipped (enabled={}, key configured={})", enabled, meteringService.configured());
            return;
        }
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        try {
            meteringService.meterStorage();
        } catch (Exception e) {
            log.error("[usage-metering] storage failed", e);
        }
        for (LocalDate day = today.minusDays(2); day.isBefore(today); day = day.plusDays(1)) {
            try {
                meteringService.meterBandwidth(day);
            } catch (Exception e) {
                log.error("[usage-metering] bandwidth for {} failed", day, e);
            }
        }
    }
}
