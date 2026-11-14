package vacademy.io.admin_core_service.features.hr_attendance.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.service.AttendanceService;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;

import java.time.LocalDate;
import java.util.List;

/**
 * Daily auto-absent sweep.
 *
 * Payroll treats a day with NO attendance record as unremarkable, so an
 * institute that stops marking attendance silently pays everyone in full —
 * the "no records = full pay" cliff. This job closes it systematically: for
 * every institute with an attendance config, for YESTERDAY in that institute's
 * timezone, every ACTIVE/PROBATION/NOTICE_PERIOD employee with no attendance
 * record and no approved leave on a working day (weekends per config, holidays
 * and dates outside the employee's join/exit window are skipped) gets an
 * explicit ABSENT record (source ADMIN, remarks "Auto-marked absent"). The
 * whole institute-day is skipped when that month is already payroll-locked.
 * Idempotent by construction: employees who already have a record for the day
 * — including yesterday's auto-marked rows — are excluded.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas; without
 * it four replicas would race the same inserts (the unique (employee, date)
 * constraint would keep the data correct, but every night would end in a pile
 * of constraint-violation noise).
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AutoAbsentJob {

    private final AttendanceConfigRepository attendanceConfigRepository;
    private final AttendanceService attendanceService;

    /**
     * Daily at 23:30 server time (UTC). For IST-centric institutes that is
     * ~05:00 local the next morning — yesterday is fully over and late manual
     * marking has had the whole day to happen.
     */
    @Scheduled(cron = "0 30 23 * * ?")
    @SchedulerLock(name = "HrAutoAbsentJob", lockAtMostFor = "PT1H", lockAtLeastFor = "PT1M")
    public void run() {
        List<AttendanceConfig> configs;
        try {
            configs = attendanceConfigRepository.findAll();
        } catch (Exception e) {
            log.error("[auto-absent] could not load configs — sweep aborted", e);
            return;
        }

        int marked = 0;
        for (AttendanceConfig config : configs) {
            try {
                LocalDate yesterday = LocalDate.now(HrTimeUtil.resolveZone(config)).minusDays(1);
                marked += attendanceService.autoMarkAbsentForInstitute(config, yesterday);
            } catch (Exception e) {
                // One institute's failure must never stop the others
                log.error("[auto-absent] failed for institute {}", config.getInstituteId(), e);
            }
        }
        if (marked > 0) {
            log.info("[auto-absent] inserted {} ABSENT record(s) across {} institute(s)",
                    marked, configs.size());
        }
    }
}
