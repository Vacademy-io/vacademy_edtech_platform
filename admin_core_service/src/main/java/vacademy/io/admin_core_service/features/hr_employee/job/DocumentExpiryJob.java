package vacademy.io.admin_core_service.features.hr_employee.job;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeDocument;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeDocumentRepository;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Daily employee-document expiry reminder.
 *
 * Emails the institute's HR (HR_ADMIN role holders, falling back to ADMINs and
 * then the employee's reporting manager) when an employee document (visa,
 * contract, certification, …) expires in exactly 30 or exactly 7 days —
 * two nudges per document, no daily spam. Like ProbationEndJob, the once-only
 * guarantee is structural: the exact-days-remaining test (in the institute's
 * timezone) can only match a given document on those two days. Candidates are
 * fetched in a broad UTC window with the employee fetch-joined, since the job
 * runs on a scheduler thread with no open session.
 *
 * <p>{@code @SchedulerLock} is mandatory — admin_core runs 4 replicas, and this
 * job has no other dedup: without the lock HR would get four copies of every
 * reminder.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class DocumentExpiryJob {

    private static final Set<String> EXITED_STATUSES = Set.of("RELIEVED", "TERMINATED", "ABSCONDING");

    /** Days-remaining marks at which a reminder is sent. */
    private static final Set<Long> REMINDER_DAYS = Set.of(30L, 7L);

    private final EmployeeDocumentRepository employeeDocumentRepository;
    private final AttendanceConfigRepository attendanceConfigRepository;
    private final HrNotificationService hrNotificationService;

    /** Daily at 03:15 server time (UTC), after the probation reminder. */
    @Scheduled(cron = "0 15 3 * * ?")
    @SchedulerLock(name = "HrDocumentExpiryJob", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void run() {
        LocalDate utcToday = LocalDate.now(ZoneId.of("UTC"));
        List<EmployeeDocument> candidates;
        try {
            // Broad window covering both the 7- and 30-day marks ±1 day of
            // timezone skew; the exact match below uses each institute's zone.
            candidates = employeeDocumentRepository.findExpiringBetweenWithEmployee(
                    utcToday.plusDays(6), utcToday.plusDays(31));
        } catch (Exception e) {
            log.error("[doc-expiry] could not load candidates — tick aborted", e);
            return;
        }

        Map<String, LocalDate> todayByInstitute = new HashMap<>();
        int sent = 0;
        for (EmployeeDocument document : candidates) {
            try {
                EmployeeProfile employee = document.getEmployee();
                if (employee == null || (employee.getEmploymentStatus() != null
                        && EXITED_STATUSES.contains(employee.getEmploymentStatus()))) {
                    continue;
                }
                LocalDate today = todayByInstitute.computeIfAbsent(employee.getInstituteId(),
                        id -> LocalDate.now(HrTimeUtil.resolveZone(
                                attendanceConfigRepository.findByInstituteId(id).orElse((AttendanceConfig) null))));
                long daysLeft = ChronoUnit.DAYS.between(today, document.getExpiryDate());
                // Fire only at the exact 30/7-day marks — this IS the resend guard
                if (!REMINDER_DAYS.contains(daysLeft)) {
                    continue;
                }

                String name = hrNotificationService.resolveUserName(employee.getUserId());
                String subject = "Employee document expiring in " + daysLeft + " days: " + name;
                String body = hrNotificationService.buildEmailBody(subject,
                        "Employee", name,
                        "Employee code", employee.getEmployeeCode(),
                        "Document", document.getDocumentName(),
                        "Type", document.getDocumentType(),
                        "Expires on", document.getExpiryDate().toString(),
                        "Action", "Collect a renewed document before it lapses.");
                hrNotificationService.emailInstituteHr(employee.getInstituteId(), employee.getId(), subject, body);
                sent++;
            } catch (Exception e) {
                log.warn("[doc-expiry] failed for document {}: {}", document.getId(), e.getMessage());
            }
        }
        if (sent > 0) {
            log.info("[doc-expiry] sent {} reminder(s)", sent);
        }
    }
}
