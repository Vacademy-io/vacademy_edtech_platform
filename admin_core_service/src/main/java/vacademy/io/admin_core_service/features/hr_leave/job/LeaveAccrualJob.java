package vacademy.io.admin_core_service.features.hr_leave.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeavePolicyRepository;
import vacademy.io.admin_core_service.features.hr_leave.service.LeaveBalanceService;

import java.util.List;

/**
 * Daily leave accrual tick.
 *
 * Before this job existed, accrual only happened when an HR admin remembered to
 * hit the accrual endpoint — a forgotten month silently under-credited every
 * employee. This job runs {@link LeaveBalanceService#accrueLeavesInternal} for
 * every institute that has at least one ACTIVE leave policy. Running DAILY is
 * safe: the hr_leave_accrual_txn ledger's unique (employee, leave type,
 * period_key) constraint means each MONTHLY/QUARTERLY/YEARLY period is credited
 * exactly once, no matter how often the job asks.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas, and while
 * the ledger constraint makes concurrent runs merely wasteful rather than
 * incorrect, four replicas racing over every institute every night is pointless
 * load and log noise.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class LeaveAccrualJob {

    private final LeavePolicyRepository leavePolicyRepository;
    private final LeaveBalanceService leaveBalanceService;

    /** Daily at 02:00 server time (UTC); per-institute "today" is derived inside the accrual. */
    @Scheduled(cron = "0 0 2 * * ?")
    @SchedulerLock(name = "HrLeaveAccrualJob", lockAtMostFor = "PT1H", lockAtLeastFor = "PT1M")
    public void run() {
        List<String> instituteIds;
        try {
            instituteIds = leavePolicyRepository.findDistinctInstituteIdsWithActivePolicies();
        } catch (Exception e) {
            log.error("[leave-accrual] could not enumerate institutes — tick aborted", e);
            return;
        }
        if (instituteIds.isEmpty()) {
            return;
        }

        int failed = 0;
        for (String instituteId : instituteIds) {
            try {
                leaveBalanceService.accrueLeavesInternal(instituteId);
            } catch (Exception e) {
                // One institute's bad policy must never stop the others
                failed++;
                log.error("[leave-accrual] accrual failed for institute {}", instituteId, e);
            }
        }
        log.info("[leave-accrual] tick done: {} institute(s), {} failed", instituteIds.size(), failed);
    }
}
