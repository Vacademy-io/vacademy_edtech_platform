package vacademy.io.admin_core_service.features.hr_teaching.service;

import lombok.Builder;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingDayDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingEmployeeSummaryDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingOccurrenceDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.hr_teaching.repository.HrTeachingEmployeeRepository;
import vacademy.io.admin_core_service.features.hr_teaching.repository.HrTeachingScheduleRepository;
import vacademy.io.admin_core_service.features.hr_teaching.repository.TeachingScheduleProjection;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Phase F2 "LMS teaching → pay" — the shared read model. A teaching occurrence
 * is a session_schedules row of the month whose parent live_session was created
 * by a user of the institute (created_by_user_id is the only host identity the
 * live-session model has). Actual participation is the teacher's own
 * ATTENDANCE_RECORDED row in live_session_logs for that schedule.
 *
 * <p>Taught-minutes rule per occurrence WITH an attendance log:
 * providerTotalDurationSeconds/60 when present (BBB, exact), else
 * providerTotalDurationMinutes (Zoom, whole minutes), else the scheduled span
 * lastEntryTime - startTime. Occurrences without a log contribute 0 taught
 * minutes — they only count toward "sessions scheduled".
 */
@Service
public class TeachingActivityService {

    @Autowired
    private HrTeachingScheduleRepository scheduleRepository;

    @Autowired
    private HrTeachingEmployeeRepository employeeRepository;

    @Autowired
    private UserRepository userRepository;

    /** In-memory occurrence, converted once from the native projection. */
    @Getter
    @Builder
    public static class Occurrence {
        private final String teacherUserId;
        private final String sessionId;
        private final String sessionTitle;
        private final String subject;
        private final String scheduleId;
        private final LocalDate date;
        private final LocalTime startTime;
        private final LocalTime lastEntryTime;
        private final boolean attendanceRecorded;
        private final long taughtSeconds;
        private final long scheduledMinutes;
    }

    /** A month of teaching activity: teacher userId → occurrences, plus profile matches. */
    @Getter
    @Builder
    public static class MonthActivity {
        private final Map<String, List<Occurrence>> byTeacherUserId;
        /** teacher userId → EmployeeProfile, only for teachers that HAVE a profile. */
        private final Map<String, EmployeeProfile> profileByUserId;
        /** teacher userId → display name (buildUserNameMap pattern). */
        private final Map<String, String> nameByUserId;
    }

    public static void validateMonthYear(Integer month, Integer year) {
        if (month == null || month < 1 || month > 12
                || year == null || year < 2000 || year > 2100) {
            throw new VacademyException("Valid month (1-12) and year are required");
        }
    }

    @Transactional(readOnly = true)
    public MonthActivity loadMonthActivity(String instituteId, int month, int year) {
        YearMonth yearMonth = YearMonth.of(year, month);
        List<TeachingScheduleProjection> rows = scheduleRepository.findTeachingSchedules(
                instituteId, yearMonth.atDay(1), yearMonth.atEndOfMonth());

        Map<String, List<Occurrence>> byTeacher = new LinkedHashMap<>();
        for (TeachingScheduleProjection row : rows) {
            Occurrence occurrence = toOccurrence(row);
            if (occurrence == null) {
                continue;
            }
            byTeacher.computeIfAbsent(occurrence.getTeacherUserId(), k -> new ArrayList<>())
                    .add(occurrence);
        }

        List<String> teacherUserIds = new ArrayList<>(byTeacher.keySet());
        Map<String, EmployeeProfile> profileByUserId = teacherUserIds.isEmpty()
                ? Map.of()
                : employeeRepository.findByInstituteIdAndUserIdIn(instituteId, teacherUserIds).stream()
                        .collect(Collectors.toMap(EmployeeProfile::getUserId, Function.identity(), (a, b) -> a));

        return MonthActivity.builder()
                .byTeacherUserId(byTeacher)
                .profileByUserId(profileByUserId)
                .nameByUserId(buildUserNameMap(teacherUserIds))
                .build();
    }

    @Transactional(readOnly = true)
    public TeachingSummaryResponseDTO buildSummary(String instituteId, int month, int year,
                                                   String onlyTeacherUserId) {
        MonthActivity activity = loadMonthActivity(instituteId, month, year);

        List<TeachingEmployeeSummaryDTO> teachers = new ArrayList<>();
        for (Map.Entry<String, List<Occurrence>> entry : activity.getByTeacherUserId().entrySet()) {
            String userId = entry.getKey();
            if (onlyTeacherUserId != null && !onlyTeacherUserId.equals(userId)) {
                continue;
            }
            teachers.add(toEmployeeSummary(userId, entry.getValue(),
                    activity.getProfileByUserId().get(userId),
                    activity.getNameByUserId().getOrDefault(userId, "Unknown")));
        }
        teachers.sort(Comparator.comparing(t -> t.getEmployeeName() == null ? "" : t.getEmployeeName(),
                String.CASE_INSENSITIVE_ORDER));

        return TeachingSummaryResponseDTO.builder()
                .instituteId(instituteId)
                .month(month)
                .year(year)
                .teachers(teachers)
                .build();
    }

    public static int countSessionsWithAttendance(List<Occurrence> occurrences) {
        return (int) occurrences.stream().filter(Occurrence::isAttendanceRecorded).count();
    }

    public static long totalTaughtSeconds(List<Occurrence> occurrences) {
        return occurrences.stream().mapToLong(Occurrence::getTaughtSeconds).sum();
    }

    public static long secondsToRoundedMinutes(long seconds) {
        return Math.round(seconds / 60.0);
    }

    private TeachingEmployeeSummaryDTO toEmployeeSummary(String userId, List<Occurrence> occurrences,
                                                         EmployeeProfile profile, String name) {
        Map<LocalDate, List<Occurrence>> byDate = occurrences.stream()
                .collect(Collectors.groupingBy(Occurrence::getDate, TreeMap::new, Collectors.toList()));

        List<TeachingDayDTO> days = new ArrayList<>();
        for (Map.Entry<LocalDate, List<Occurrence>> dayEntry : byDate.entrySet()) {
            List<Occurrence> dayOccurrences = dayEntry.getValue();
            days.add(TeachingDayDTO.builder()
                    .date(dayEntry.getKey())
                    .sessionsScheduled(dayOccurrences.size())
                    .sessionsWithAttendance(countSessionsWithAttendance(dayOccurrences))
                    .taughtMinutes(secondsToRoundedMinutes(totalTaughtSeconds(dayOccurrences)))
                    .occurrences(dayOccurrences.stream().map(this::toOccurrenceDTO)
                            .collect(Collectors.toList()))
                    .build());
        }

        return TeachingEmployeeSummaryDTO.builder()
                .employeeId(profile != null ? profile.getId() : null)
                .userId(userId)
                .employeeName(name)
                .employeeCode(profile != null ? profile.getEmployeeCode() : null)
                .noEmployeeProfile(profile == null)
                .sessionsScheduled(occurrences.size())
                .sessionsWithAttendance(countSessionsWithAttendance(occurrences))
                .totalTaughtMinutes(secondsToRoundedMinutes(totalTaughtSeconds(occurrences)))
                .days(days)
                .build();
    }

    private TeachingOccurrenceDTO toOccurrenceDTO(Occurrence o) {
        return TeachingOccurrenceDTO.builder()
                .scheduleId(o.getScheduleId())
                .sessionId(o.getSessionId())
                .sessionTitle(o.getSessionTitle())
                .subject(o.getSubject())
                .startTime(o.getStartTime())
                .lastEntryTime(o.getLastEntryTime())
                .attendanceRecorded(o.isAttendanceRecorded())
                .taughtMinutes(secondsToRoundedMinutes(o.getTaughtSeconds()))
                .scheduledMinutes(o.getScheduledMinutes())
                .build();
    }

    private Occurrence toOccurrence(TeachingScheduleProjection row) {
        if (row.getMeetingDate() == null || row.getTeacherUserId() == null) {
            return null;
        }
        LocalDate date = row.getMeetingDate().toLocalDate();
        LocalTime startTime = row.getStartTime() != null ? row.getStartTime().toLocalTime() : null;
        LocalTime lastEntryTime = row.getLastEntryTime() != null ? row.getLastEntryTime().toLocalTime() : null;

        long scheduledMinutes = 0;
        if (startTime != null && lastEntryTime != null && lastEntryTime.isAfter(startTime)) {
            scheduledMinutes = Duration.between(startTime, lastEntryTime).toMinutes();
        }

        boolean attendanceRecorded = row.getAttendanceStatus() != null;
        long taughtSeconds = 0;
        if (attendanceRecorded) {
            if (row.getDurationSeconds() != null && row.getDurationSeconds() > 0) {
                taughtSeconds = row.getDurationSeconds();
            } else if (row.getDurationMinutes() != null && row.getDurationMinutes() > 0) {
                taughtSeconds = row.getDurationMinutes() * 60L;
            } else {
                taughtSeconds = scheduledMinutes * 60L;
            }
        }

        return Occurrence.builder()
                .teacherUserId(row.getTeacherUserId())
                .sessionId(row.getSessionId())
                .sessionTitle(row.getSessionTitle())
                .subject(row.getSubject())
                .scheduleId(row.getScheduleId())
                .date(date)
                .startTime(startTime)
                .lastEntryTime(lastEntryTime)
                .attendanceRecorded(attendanceRecorded)
                .taughtSeconds(taughtSeconds)
                .scheduledMinutes(scheduledMinutes)
                .build();
    }

    /** Same pattern as hr_attendance AttendanceService.buildUserNameMap. */
    private Map<String, String> buildUserNameMap(List<String> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        List<User> users = userRepository.findByIdIn(userIds);
        return users.stream()
                .collect(Collectors.toMap(
                        User::getId,
                        u -> u.getFullName() != null ? u.getFullName() : u.getUsername(),
                        (a, b) -> a
                ));
    }
}
