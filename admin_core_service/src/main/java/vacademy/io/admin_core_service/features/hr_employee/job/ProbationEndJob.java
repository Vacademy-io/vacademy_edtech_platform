package vacademy.io.admin_core_service.features.hr_employee.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Daily probation-end reminder.
 *
 * Emails the institute's HR (HR_ADMIN role holders, falling back to ADMINs and
 * then the employee's reporting manager) exactly once per employee, 7 days
 * before probation_end_date. The once-only guarantee needs no state: the mail
 * fires only on the single day where probation_end_date − 7 == today in the
 * institute's timezone, so tomorrow's run can never re-match the same employee.
 * Candidates are fetched in a broad UTC window and the exact-day test is done
 * per institute zone.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas, and this
 * job has no other dedup: without the lock HR would get four copies of every
 * reminder.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class ProbationEndJob {

    /** Statuses whose probation reminders are pointless (already out the door). */
    private static final Set<String> EXITED_STATUSES = Set.of("RELIEVED", "TERMINATED", "ABSCONDING");

    private final EmployeeProfileRepository employeeProfileRepository;
    private final AttendanceConfigRepository attendanceConfigRepository;
    private final HrNotificationService hrNotificationService;

    /** Daily at 03:00 server time (UTC). */
    @Scheduled(cron = "0 0 3 * * ?")
    @SchedulerLock(name = "HrProbationEndJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        LocalDate utcToday = LocalDate.now(ZoneId.of("UTC"));
        List<EmployeeProfile> candidates;
        try {
            // Broad window around utcToday+7; the exact match below uses each
            // institute's own timezone (which can put "today" ±1 day from UTC).
            candidates = employeeProfileRepository.findByProbationEndDateBetween(
                    utcToday.plusDays(6), utcToday.plusDays(8));
        } catch (Exception e) {
            log.error("[probation-end] could not load candidates — tick aborted", e);
            return;
        }

        Map<String, LocalDate> todayByInstitute = new HashMap<>();
        int sent = 0;
        for (EmployeeProfile employee : candidates) {
            try {
                if (employee.getEmploymentStatus() != null
                        && EXITED_STATUSES.contains(employee.getEmploymentStatus())) {
                    continue;
                }
                LocalDate today = todayByInstitute.computeIfAbsent(employee.getInstituteId(),
                        id -> LocalDate.now(HrTimeUtil.resolveZone(
                                attendanceConfigRepository.findByInstituteId(id).orElse((AttendanceConfig) null))));
                // Fire only on the single day exactly 7 days out — this IS the resend guard
                if (!employee.getProbationEndDate().minusDays(7).equals(today)) {
                    continue;
                }

                String name = hrNotificationService.resolveUserName(employee.getUserId());
                String subject = "Probation ending soon: " + name;
                String body = hrNotificationService.buildEmailBody(subject,
                        "Employee", name,
                        "Employee code", employee.getEmployeeCode(),
                        "Probation ends", employee.getProbationEndDate().toString(),
                        "Joined", employee.getJoinDate() != null ? employee.getJoinDate().toString() : null,
                        "Action", "Confirm the employee or extend probation before this date.");
                hrNotificationService.emailInstituteHr(employee.getInstituteId(), employee.getId(), subject, body);
                sent++;
            } catch (Exception e) {
                log.warn("[probation-end] failed for employee {}: {}", employee.getId(), e.getMessage());
            }
        }
        if (sent > 0) {
            log.info("[probation-end] sent {} reminder(s)", sent);
        }
    }
}
