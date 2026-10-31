package vacademy.io.admin_core_service.features.hr_leave.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_leave.service.CompOffService;

/**
 * Daily comp-off expiry sweep.
 *
 * APPROVED comp-offs carry an optional expiry_date, but nothing ever enforced
 * it — expired credits stayed spendable forever through the COMP_OFF leave
 * balance. This job marks APPROVED comp-offs past their expiry date (per the
 * owning institute's timezone) as EXPIRED and, when the credited days are still
 * unspent, deducts min(days, available) from the balance's adjustment so the
 * closing balance can never go negative. The status transition itself makes
 * re-runs idempotent: an EXPIRED row is never a candidate again.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas; without
 * it the same comp-off could be double-deducted by two replicas racing between
 * the candidate fetch and the status flip.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CompOffExpiryJob {

    private final CompOffService compOffService;

    /** Daily at 02:30 server time (UTC), after the accrual tick. */
    @Scheduled(cron = "0 30 2 * * ?")
    @SchedulerLock(name = "HrCompOffExpiryJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        try {
            int expired = compOffService.expireOverdueCompOffs();
            if (expired > 0) {
                log.info("[comp-off-expiry] expired {} comp-off(s)", expired);
            }
        } catch (Exception e) {
            log.error("[comp-off-expiry] sweep failed", e);
        }
    }
}
