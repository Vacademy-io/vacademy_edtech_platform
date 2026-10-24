package vacademy.io.admin_core_service.features.hr_attendance.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.service.AttendanceService;

import java.util.List;

/**
 * Auto-checkout tick (every 30 minutes).
 *
 * hr_attendance_config always supported auto_checkout_enabled/auto_checkout_time
 * but nothing ever acted on it: an employee who forgot to check out kept an
 * open TIME_TRACKING session forever (no total hours, no overtime, payroll
 * seeing a dangling day). Each tick, for every institute that opted in, closes
 * today's (institute timezone) open check-ins at the configured time once that
 * time has passed, reusing the exact checkout math the manual flow uses, with
 * remarks "Auto checkout". Runs every 30 minutes rather than daily because
 * each institute's cutoff falls at a different local time; ticks before the
 * cutoff or with nothing open are a cheap no-op, so asking often is free.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas; without
 * it every open session would be raced by four writers per tick.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AutoCheckoutJob {

    private final AttendanceConfigRepository attendanceConfigRepository;
    private final AttendanceService attendanceService;

    /** Every 30 minutes, on the hour and half hour. */
    @Scheduled(cron = "0 */30 * * * ?")
    @SchedulerLock(name = "HrAutoCheckoutJob", lockAtMostFor = "PT25M", lockAtLeastFor = "PT30S")
    public void run() {
        List<AttendanceConfig> configs;
        try {
            configs = attendanceConfigRepository.findByAutoCheckoutEnabledTrue();
        } catch (Exception e) {
            log.error("[auto-checkout] could not load configs — tick aborted", e);
            return;
        }

        int closed = 0;
        for (AttendanceConfig config : configs) {
            try {
                closed += attendanceService.autoCheckoutInstitute(config);
            } catch (Exception e) {
                // One institute's failure must never stop the others
                log.error("[auto-checkout] failed for institute {}", config.getInstituteId(), e);
            }
        }
        if (closed > 0) {
            log.info("[auto-checkout] closed {} open session(s) across {} institute(s)",
                    closed, configs.size());
        }
    }
}
