package vacademy.io.admin_core_service.features.hr_teaching.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceSource;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceStatus;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_payroll.service.HrMonthLockService;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingAttendanceSyncResultDTO;
import vacademy.io.admin_core_service.features.hr_teaching.repository.HrTeachingAttendanceRepository;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingActivityService.MonthActivity;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingActivityService.Occurrence;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * Teaching → HR attendance sync (Phase F2): every date a teaching employee
 * actually taught (has an ATTENDANCE_RECORDED log; {@code requireLog=false}
 * relaxes this to "had a scheduled session") becomes / upgrades an
 * hr_attendance_record PRESENT row.
 *
 * <p>Rules: the table is UNIQUE(employee_id, attendance_date) so existing rows
 * are updated, never re-inserted; an existing PRESENT or ON_LEAVE row is never
 * downgraded or overwritten (ON_LEAVE means HR explicitly recorded leave —
 * teaching data must not silently contradict it); a payroll-locked month
 * refuses outright.
 */
@Service
public class TeachingAttendanceSyncService {

    @Autowired
    private TeachingActivityService teachingActivityService;

    @Autowired
    private HrTeachingAttendanceRepository attendanceRepository;

    @Autowired
    private HrMonthLockService hrMonthLockService;

    @Transactional
    public TeachingAttendanceSyncResultDTO sync(String instituteId, int month, int year, boolean requireLog) {
        TeachingActivityService.validateMonthYear(month, year);
        hrMonthLockService.requireUnlocked(instituteId, YearMonth.of(year, month).atDay(1),
                "sync teaching attendance");

        MonthActivity activity = teachingActivityService.loadMonthActivity(instituteId, month, year);

        int created = 0;
        int updated = 0;
        int skipped = 0;
        int datesConsidered = 0;
        List<String> teachersWithoutProfile = new ArrayList<>();

        for (Map.Entry<String, List<Occurrence>> entry : activity.getByTeacherUserId().entrySet()) {
            String userId = entry.getKey();
            EmployeeProfile employee = activity.getProfileByUserId().get(userId);
            if (employee == null) {
                teachersWithoutProfile.add(userId);
                continue;
            }

            Map<LocalDate, List<Occurrence>> byDate = entry.getValue().stream()
                    .filter(o -> !requireLog || o.isAttendanceRecorded())
                    .collect(Collectors.groupingBy(Occurrence::getDate, TreeMap::new, Collectors.toList()));

            for (Map.Entry<LocalDate, List<Occurrence>> dayEntry : byDate.entrySet()) {
                datesConsidered++;
                int sessionCount = dayEntry.getValue().size();
                String remark = "Taught: " + sessionCount + " session(s)";

                Optional<AttendanceRecord> existingOpt =
                        attendanceRepository.findByEmployeeIdAndAttendanceDate(employee.getId(), dayEntry.getKey());

                if (existingOpt.isEmpty()) {
                    AttendanceRecord record = new AttendanceRecord();
                    record.setEmployee(employee);
                    record.setInstituteId(instituteId);
                    record.setAttendanceDate(dayEntry.getKey());
                    record.setStatus(AttendanceStatus.PRESENT.name());
                    record.setSource(AttendanceSource.ADMIN.name());
                    record.setRemarks(remark);
                    try {
                        attendanceRepository.save(record);
                        created++;
                    } catch (DataIntegrityViolationException e) {
                        // Raced with a concurrent write for the same (employee, date)
                        skipped++;
                    }
                    continue;
                }

                AttendanceRecord existing = existingOpt.get();
                if (AttendanceStatus.PRESENT.name().equals(existing.getStatus())
                        || AttendanceStatus.ON_LEAVE.name().equals(existing.getStatus())) {
                    skipped++;
                    continue;
                }
                existing.setStatus(AttendanceStatus.PRESENT.name());
                existing.setSource(AttendanceSource.ADMIN.name());
                existing.setRemarks(existing.getRemarks() == null || existing.getRemarks().isBlank()
                        ? remark
                        : existing.getRemarks() + " | " + remark);
                attendanceRepository.save(existing);
                updated++;
            }
        }

        return TeachingAttendanceSyncResultDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .requireLog(requireLog)
                .created(created)
                .updated(updated)
                .skipped(skipped)
                .datesConsidered(datesConsidered)
                .teachersWithoutProfile(teachersWithoutProfile)
                .build();
    }
}
