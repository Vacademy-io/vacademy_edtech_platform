package vacademy.io.admin_core_service.features.hr_attendance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceRecordDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceSummaryDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.BulkAttendanceMarkDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.CheckInDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.CheckOutDTO;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.entity.EmployeeShiftMapping;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceMode;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceSource;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceStatus;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRecordRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.EmployeeShiftMappingRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.HolidayRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveApplicationRepository;
import vacademy.io.admin_core_service.features.hr_payroll.service.HrMonthLockService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AttendanceService {

    @Autowired
    private AttendanceRecordRepository attendanceRecordRepository;

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private EmployeeShiftMappingRepository employeeShiftMappingRepository;

    @Autowired
    private HolidayRepository holidayRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private LeaveApplicationRepository leaveApplicationRepository;

    @Autowired
    private HrMonthLockService hrMonthLockService;

    /**
     * BUG 6 FIX: the employee is resolved and authorized by HrAccessGuard in the
     * controller (self or HR staff, verified member of the validated institute),
     * so this method never re-fetches by an unchecked id.
     */
    @Transactional
    public String checkIn(CheckInDTO dto, EmployeeProfile employee, String clientIp) {
        String instituteId = employee.getInstituteId();

        // Fetch attendance config for mode, geo-fence and IP restriction validation
        AttendanceConfig config = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);

        // Self check-in/out only exists in TIME_TRACKING mode
        requireTimeTrackingMode(config);

        // BUG 1 FIX: Enforce geo-fence validation
        if (config != null && Boolean.TRUE.equals(config.getGeoFenceEnabled())) {
            if (dto.getLatitude() == null || dto.getLongitude() == null) {
                throw new VacademyException("Location coordinates are required for check-in");
            }
            double distance = calculateDistance(config.getGeoFenceLat(), config.getGeoFenceLng(),
                                                dto.getLatitude(), dto.getLongitude());
            if (distance > config.getGeoFenceRadiusM()) {
                throw new VacademyException("You are outside the allowed geo-fence area");
            }
        }

        // BUG 2 FIX: Enforce IP restriction. The IP is derived server-side by the
        // controller (X-Forwarded-For / remote address) — the client-supplied
        // dto.ipAddress is never trusted. Allowed entries may be bare IPs or
        // IPv4 CIDR blocks ("a.b.c.d/nn").
        if (config != null && Boolean.TRUE.equals(config.getIpRestrictionEnabled()) && config.getAllowedIps() != null) {
            if (clientIp == null || !isIpAllowed(clientIp, config.getAllowedIps())) {
                throw new VacademyException("Check-in not allowed from this IP address");
            }
        }

        // Day-bucketing uses the institute's timezone (JVM stays UTC)
        ZoneId zone = HrTimeUtil.resolveZone(config);
        LocalDate today = LocalDate.now(zone);

        // Payroll month-lock: once the month's REGULAR run is past DRAFT, no
        // new attendance may be written for it (rare around month boundaries).
        hrMonthLockService.requireUnlocked(instituteId, today, "check in");

        Optional<AttendanceRecord> existingRecord = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(employee.getId(), today);

        if (existingRecord.isPresent() && existingRecord.get().getCheckInTime() != null) {
            throw new VacademyException("Employee has already checked in today");
        }

        AttendanceRecord record;
        if (existingRecord.isPresent()) {
            record = existingRecord.get();
        } else {
            record = new AttendanceRecord();
            record.setEmployee(employee);
            record.setInstituteId(instituteId);
            record.setAttendanceDate(today);
        }

        // Set shift if employee has an active shift mapping
        Optional<EmployeeShiftMapping> shiftMapping = employeeShiftMappingRepository
                .findActiveMapping(employee.getId(), today);
        shiftMapping.ifPresent(mapping -> record.setShift(mapping.getShift()));

        record.setCheckInTime(LocalDateTime.now(zone));
        record.setCheckInLat(dto.getLatitude());
        record.setCheckInLng(dto.getLongitude());
        record.setCheckInIp(clientIp);
        record.setStatus(AttendanceStatus.PRESENT.name());
        record.setRemarks(dto.getRemarks());

        // Determine source based on whether geo coordinates are provided
        if (dto.getLatitude() != null && dto.getLongitude() != null) {
            record.setSource(AttendanceSource.GEO.name());
        } else {
            record.setSource(AttendanceSource.MANUAL.name());
        }

        // BUG 5 FIX: Handle race condition — unique constraint violation on (employee_id, attendance_date)
        try {
            attendanceRecordRepository.save(record);
        } catch (DataIntegrityViolationException e) {
            throw new VacademyException("Check-in already recorded for today");
        }
        return "Check-in recorded successfully";
    }

    @Transactional
    public String checkOut(CheckOutDTO dto, EmployeeProfile employee, String clientIp) {
        String instituteId = employee.getInstituteId();

        AttendanceConfig config = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);

        // Self check-in/out only exists in TIME_TRACKING mode
        requireTimeTrackingMode(config);

        // Day-bucketing uses the institute's timezone (JVM stays UTC)
        ZoneId zone = HrTimeUtil.resolveZone(config);
        LocalDate today = LocalDate.now(zone);

        // BUG 3 FIX: For night shifts, the employee may check out on the next day.
        // Try today first, then fall back to yesterday's record.
        Optional<AttendanceRecord> existingOpt = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDate(employee.getId(), today);
        if (existingOpt.isEmpty()) {
            // Try yesterday for night shift
            existingOpt = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDate(employee.getId(), today.minusDays(1));
        }
        if (existingOpt.isEmpty()) {
            throw new VacademyException("No check-in record found for today");
        }
        AttendanceRecord record = existingOpt.get();

        if (record.getCheckInTime() == null) {
            throw new VacademyException("No check-in record found for today. Please check in first.");
        }

        if (record.getCheckOutTime() != null) {
            throw new VacademyException("Employee has already checked out today");
        }

        // Payroll month-lock on the record's own date (a night-shift checkout
        // may land in the next month while the record's month is locked).
        hrMonthLockService.requireUnlocked(instituteId, record.getAttendanceDate(), "check out");

        LocalDateTime checkOutTime = LocalDateTime.now(zone);
        record.setCheckOutTime(checkOutTime);
        record.setCheckOutLat(dto.getLatitude());
        record.setCheckOutLng(dto.getLongitude());
        record.setCheckOutIp(clientIp);
        if (dto.getRemarks() != null) {
            record.setRemarks(dto.getRemarks());
        }

        applyCheckoutCalculations(record, config);

        attendanceRecordRepository.save(record);
        return "Check-out recorded successfully. Total hours: " + record.getTotalHours();
    }

    /**
     * Shared checkout math for self checkout and the auto-checkout job: derives
     * total hours (minus the shift break), the half-day status and overtime
     * from an already-set check-in/check-out pair.
     */
    public void applyCheckoutCalculations(AttendanceRecord record, AttendanceConfig config) {
        // Calculate total hours worked
        long minutesWorked = ChronoUnit.MINUTES.between(record.getCheckInTime(), record.getCheckOutTime());

        // Subtract break duration if shift is assigned
        if (record.getShift() != null && record.getShift().getBreakDurationMin() != null) {
            minutesWorked -= record.getShift().getBreakDurationMin();
            record.setBreakDurationMin(record.getShift().getBreakDurationMin());
        }

        // BUG 4 FIX: Ensure minutesWorked is never negative after break subtraction
        minutesWorked = Math.max(0, minutesWorked);

        BigDecimal totalHours = BigDecimal.valueOf(minutesWorked)
                .divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP);
        record.setTotalHours(totalHours);

        // Check if half-day based on config
        if (config != null) {

            // Determine if half-day
            if (config.getHalfDayThresholdMin() != null && minutesWorked < config.getHalfDayThresholdMin()) {
                record.setStatus(AttendanceStatus.HALF_DAY.name());
            }

            // Calculate overtime if enabled
            if (Boolean.TRUE.equals(config.getOvertimeEnabled()) && config.getOvertimeThresholdMin() != null) {
                if (minutesWorked > config.getOvertimeThresholdMin()) {
                    long overtimeMinutes = minutesWorked - config.getOvertimeThresholdMin();
                    BigDecimal overtimeHours = BigDecimal.valueOf(overtimeMinutes)
                            .divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP);
                    record.setOvertimeHours(overtimeHours);
                }
            }
        }
    }

    /**
     * Admin bulk mark. Records are always written against the VALIDATED
     * instituteId (never the one in the request body), and every employee in
     * the batch is verified to belong to that institute before anything is saved.
     */
    @Transactional
    public String markBulkAttendance(BulkAttendanceMarkDTO dto, String instituteId) {
        if (dto.getEntries() == null || dto.getEntries().isEmpty()) {
            throw new VacademyException("No attendance entries provided");
        }

        // Payroll month-lock: the whole batch is written against dto.getDate()
        hrMonthLockService.requireUnlocked(instituteId, dto.getDate(), "mark attendance");

        // Batch-fetch and institute-check every employee in the list up front
        List<String> employeeIds = dto.getEntries().stream()
                .map(BulkAttendanceMarkDTO.AttendanceMarkEntry::getEmployeeId)
                .distinct()
                .collect(Collectors.toList());
        Map<String, EmployeeProfile> employeeMap = employeeProfileRepository.findAllById(employeeIds).stream()
                .filter(e -> instituteId.equals(e.getInstituteId()))
                .collect(Collectors.toMap(EmployeeProfile::getId, e -> e));

        int successCount = 0;

        for (BulkAttendanceMarkDTO.AttendanceMarkEntry entry : dto.getEntries()) {
            // BUG 7 FIX: Validate status against AttendanceStatus enum
            try {
                AttendanceStatus.valueOf(entry.getStatus());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid attendance status: " + entry.getStatus());
            }

            EmployeeProfile employee = employeeMap.get(entry.getEmployeeId());
            if (employee == null) {
                throw new VacademyException("Employee not found with id: " + entry.getEmployeeId());
            }

            Optional<AttendanceRecord> existingRecord = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDate(entry.getEmployeeId(), dto.getDate());

            AttendanceRecord record;
            if (existingRecord.isPresent()) {
                record = existingRecord.get();
            } else {
                record = new AttendanceRecord();
                record.setEmployee(employee);
                record.setInstituteId(instituteId);
                record.setAttendanceDate(dto.getDate());
            }

            record.setStatus(entry.getStatus());
            record.setRemarks(entry.getRemarks());
            record.setSource(AttendanceSource.ADMIN.name());

            attendanceRecordRepository.save(record);
            successCount++;
        }

        return "Bulk attendance marked successfully for " + successCount + " employee(s)";
    }

    /**
     * AutoCheckoutJob worker: closes today's forgotten open check-ins for one
     * institute at the configured auto-checkout time. Transactional so the
     * lazy shift association is readable from a scheduler thread and one
     * institute's records commit or fail together.
     *
     * @return number of records auto-closed
     */
    @Transactional
    public int autoCheckoutInstitute(AttendanceConfig config) {
        if (config == null || !Boolean.TRUE.equals(config.getAutoCheckoutEnabled())
                || config.getAutoCheckoutTime() == null) {
            return 0;
        }
        // Auto-checkout only makes sense where employees clock themselves
        if (AttendanceMode.DAY_LEVEL.name().equals(config.getMode())) {
            return 0;
        }

        ZoneId zone = HrTimeUtil.resolveZone(config);
        LocalDate today = LocalDate.now(zone);
        LocalTime now = LocalTime.now(zone);
        if (now.isBefore(config.getAutoCheckoutTime())) {
            return 0;
        }
        // Locked month (possible right around a month boundary): leave records alone
        if (hrMonthLockService.isDateLocked(config.getInstituteId(), today)) {
            return 0;
        }

        List<AttendanceRecord> openRecords = attendanceRecordRepository
                .findOpenCheckIns(config.getInstituteId(), today);

        int closed = 0;
        for (AttendanceRecord record : openRecords) {
            LocalDateTime checkOutAt = LocalDateTime.of(today, config.getAutoCheckoutTime());
            // Night shift / late check-in past the auto-checkout time: nothing
            // sensible to close the session at — leave it open.
            if (record.getCheckInTime() == null || !checkOutAt.isAfter(record.getCheckInTime())) {
                continue;
            }
            record.setCheckOutTime(checkOutAt);
            record.setRemarks("Auto checkout");
            applyCheckoutCalculations(record, config);
            attendanceRecordRepository.save(record);
            closed++;
        }
        return closed;
    }

    /**
     * AutoAbsentJob worker: for one institute and one (already elapsed) date,
     * inserts an ABSENT record for every ACTIVE/PROBATION/NOTICE_PERIOD
     * employee who has no attendance record and no approved leave that day.
     * Weekends (per config), holidays, dates outside the employee's tenure and
     * payroll-locked months are skipped. This removes the "no records = full
     * pay" cliff: a day nobody marked becomes an explicit ABSENT row payroll
     * can see.
     *
     * @return number of ABSENT records inserted
     */
    @Transactional
    public int autoMarkAbsentForInstitute(AttendanceConfig config, LocalDate date) {
        if (config == null || date == null) {
            return 0;
        }
        String instituteId = config.getInstituteId();

        // Non-working day for the whole institute?
        Set<DayOfWeek> weekendDays = HrTimeUtil.resolveWeekendDays(config);
        if (weekendDays.contains(date.getDayOfWeek())) {
            return 0;
        }
        if (holidayRepository.existsByInstituteIdAndDate(instituteId, date)) {
            return 0;
        }
        // Payroll already processed this month — never rewrite history
        if (hrMonthLockService.isDateLocked(instituteId, date)) {
            return 0;
        }

        List<EmployeeProfile> employees = employeeProfileRepository.findActiveEmployees(
                instituteId, Arrays.asList("ACTIVE", "PROBATION", "NOTICE_PERIOD"));
        if (employees.isEmpty()) {
            return 0;
        }

        Set<String> employeesWithRecord = new HashSet<>(
                attendanceRecordRepository.findEmployeeIdsWithRecordOnDate(instituteId, date));

        int marked = 0;
        for (EmployeeProfile employee : employees) {
            if (employeesWithRecord.contains(employee.getId())) {
                continue;
            }
            // Not yet joined / already exited on that date
            if (employee.getJoinDate() != null && date.isBefore(employee.getJoinDate())) {
                continue;
            }
            if (employee.getLastWorkingDate() != null && date.isAfter(employee.getLastWorkingDate())) {
                continue;
            }
            // Approved leave covering the day (normally already reflected as an
            // ON_LEAVE record by the approval flow — this catches stragglers)
            if (!leaveApplicationRepository.findApprovedLeavesInRange(employee.getId(), date, date).isEmpty()) {
                continue;
            }

            AttendanceRecord record = new AttendanceRecord();
            record.setEmployee(employee);
            record.setInstituteId(instituteId);
            record.setAttendanceDate(date);
            record.setStatus(AttendanceStatus.ABSENT.name());
            record.setSource(AttendanceSource.ADMIN.name());
            record.setRemarks("Auto-marked absent");
            try {
                attendanceRecordRepository.save(record);
                marked++;
            } catch (DataIntegrityViolationException e) {
                // Raced with a concurrent write for the same (employee, date) — fine
            }
        }
        return marked;
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordDTO> getAttendanceRecords(String instituteId, String employeeId,
                                                           Integer month, Integer year) {
        YearMonth yearMonth = YearMonth.of(year, month);
        LocalDate startDate = yearMonth.atDay(1);
        LocalDate endDate = yearMonth.atEndOfMonth();

        List<AttendanceRecord> records;
        if (employeeId != null && !employeeId.isEmpty()) {
            records = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDateBetweenOrderByAttendanceDateAsc(
                            employeeId, startDate, endDate);
        } else {
            records = attendanceRecordRepository
                    .findByInstituteAndDateRange(instituteId, startDate, endDate);
        }

        // Collect all unique userIds from employee profiles to batch-fetch user names
        List<String> userIds = records.stream()
                .map(r -> r.getEmployee().getUserId())
                .distinct()
                .collect(Collectors.toList());
        Map<String, String> userNameMap = buildUserNameMap(userIds);

        return records.stream().map(record -> toRecordDTO(record, userNameMap)).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<AttendanceSummaryDTO> getAttendanceSummary(String instituteId, Integer month, Integer year) {
        YearMonth yearMonth = YearMonth.of(year, month);
        LocalDate startDate = yearMonth.atDay(1);
        LocalDate endDate = yearMonth.atEndOfMonth();

        // Get attendance config for weekend days
        List<String> weekendDays = new ArrayList<>();
        Optional<AttendanceConfig> configOpt = attendanceConfigRepository.findByInstituteId(instituteId);
        if (configOpt.isPresent() && configOpt.get().getWeekendDays() != null) {
            weekendDays = configOpt.get().getWeekendDays();
        }

        // Calculate total working days (exclude weekends and holidays)
        long totalDaysInMonth = yearMonth.lengthOfMonth();
        long holidayCount = holidayRepository.countMandatoryHolidays(instituteId, startDate, endDate);
        long weekendCount = countWeekendDays(startDate, endDate, weekendDays);
        int totalWorkingDays = (int) (totalDaysInMonth - holidayCount - weekendCount);

        // Get all active employees
        List<EmployeeProfile> activeEmployees = employeeProfileRepository
                .findActiveEmployees(instituteId, Arrays.asList("ACTIVE", "PROBATION"));

        // Batch-fetch user names
        List<String> userIds = activeEmployees.stream()
                .map(EmployeeProfile::getUserId)
                .distinct()
                .collect(Collectors.toList());
        Map<String, String> userNameMap = buildUserNameMap(userIds);

        List<AttendanceSummaryDTO> summaries = new ArrayList<>();

        for (EmployeeProfile employee : activeEmployees) {
            AttendanceSummaryDTO summary = new AttendanceSummaryDTO();
            summary.setEmployeeId(employee.getId());
            summary.setEmployeeName(userNameMap.getOrDefault(employee.getUserId(), "Unknown"));
            summary.setEmployeeCode(employee.getEmployeeCode());
            summary.setTotalWorkingDays(totalWorkingDays);

            // Count statuses for this employee
            long present = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                    employee.getId(), startDate, endDate, AttendanceStatus.PRESENT.name());
            long absent = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                    employee.getId(), startDate, endDate, AttendanceStatus.ABSENT.name());
            long halfDay = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                    employee.getId(), startDate, endDate, AttendanceStatus.HALF_DAY.name());
            long onLeave = attendanceRecordRepository.countByEmployeeAndDateRangeAndStatus(
                    employee.getId(), startDate, endDate, AttendanceStatus.ON_LEAVE.name());

            summary.setPresent(present);
            summary.setAbsent(absent);
            summary.setHalfDay(halfDay);
            summary.setOnLeave(onLeave);
            summary.setHolidays(holidayCount);
            summary.setWeekends(weekendCount);

            // Sum overtime hours from records. Safe in DAY_LEVEL mode too:
            // admin-marked records have no check-in/out or overtime, and the
            // null-filter below simply yields zero.
            List<AttendanceRecord> empRecords = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDateBetweenOrderByAttendanceDateAsc(
                            employee.getId(), startDate, endDate);
            BigDecimal totalOvertime = empRecords.stream()
                    .filter(r -> r.getOvertimeHours() != null)
                    .map(AttendanceRecord::getOvertimeHours)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            summary.setOvertime(totalOvertime);

            summaries.add(summary);
        }

        return summaries;
    }

    /**
     * Self check-in/check-out is only meaningful in TIME_TRACKING mode. In
     * DAY_LEVEL mode attendance is marked by admins (markBulkAttendance works
     * in both modes). A missing config defaults to TIME_TRACKING (current behavior).
     */
    private void requireTimeTrackingMode(AttendanceConfig config) {
        if (config != null && AttendanceMode.DAY_LEVEL.name().equals(config.getMode())) {
            throw new VacademyException("This institute uses day-level attendance; use admin marking");
        }
    }

    /**
     * Returns true if the client IP matches any allowed entry. Entries may be
     * bare IPs (exact match, IPv4 or IPv6) or IPv4 CIDR blocks ("a.b.c.d/nn").
     * Malformed entries are skipped.
     */
    private boolean isIpAllowed(String clientIp, List<String> allowedEntries) {
        for (String entry : allowedEntries) {
            if (entry != null && matchesIpEntry(clientIp, entry.trim())) {
                return true;
            }
        }
        return false;
    }

    private boolean matchesIpEntry(String clientIp, String entry) {
        if (entry.isEmpty()) {
            return false;
        }
        int slash = entry.indexOf('/');
        if (slash < 0) {
            // Bare IP: exact match (covers IPv6 entries too)
            return entry.equals(clientIp);
        }
        try {
            long network = ipv4ToLong(entry.substring(0, slash));
            int prefix = Integer.parseInt(entry.substring(slash + 1));
            if (prefix < 0 || prefix > 32) {
                return false;
            }
            long ip = ipv4ToLong(clientIp);
            long mask = prefix == 0 ? 0L : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
            return (ip & mask) == (network & mask);
        } catch (Exception e) {
            // Malformed CIDR entry or non-IPv4 client IP — no match
            return false;
        }
    }

    private long ipv4ToLong(String ip) {
        String[] octets = ip.trim().split("\\.");
        if (octets.length != 4) {
            throw new IllegalArgumentException("Not an IPv4 address: " + ip);
        }
        long value = 0;
        for (String octet : octets) {
            int part = Integer.parseInt(octet);
            if (part < 0 || part > 255) {
                throw new IllegalArgumentException("Not an IPv4 address: " + ip);
            }
            value = (value << 8) | part;
        }
        return value;
    }

    /**
     * Calculates the distance in meters between two geographic coordinates
     * using the Haversine formula.
     */
    private double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        final int R = 6371000; // Earth radius in meters
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                   Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                   Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private long countWeekendDays(LocalDate startDate, LocalDate endDate, List<String> weekendDayNames) {
        if (weekendDayNames == null || weekendDayNames.isEmpty()) {
            return 0;
        }

        List<DayOfWeek> weekendDaysOfWeek = weekendDayNames.stream()
                .map(name -> {
                    try {
                        return DayOfWeek.valueOf(name.toUpperCase());
                    } catch (IllegalArgumentException e) {
                        return null;
                    }
                })
                .filter(d -> d != null)
                .collect(Collectors.toList());

        long count = 0;
        LocalDate current = startDate;
        while (!current.isAfter(endDate)) {
            if (weekendDaysOfWeek.contains(current.getDayOfWeek())) {
                count++;
            }
            current = current.plusDays(1);
        }
        return count;
    }

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

    private AttendanceRecordDTO toRecordDTO(AttendanceRecord record, Map<String, String> userNameMap) {
        AttendanceRecordDTO dto = new AttendanceRecordDTO();
        dto.setId(record.getId());
        dto.setEmployeeId(record.getEmployee().getId());
        dto.setEmployeeName(userNameMap.getOrDefault(record.getEmployee().getUserId(), "Unknown"));
        dto.setEmployeeCode(record.getEmployee().getEmployeeCode());
        dto.setInstituteId(record.getInstituteId());
        dto.setAttendanceDate(record.getAttendanceDate());

        if (record.getShift() != null) {
            dto.setShiftId(record.getShift().getId());
            dto.setShiftName(record.getShift().getName());
        }

        dto.setCheckInTime(record.getCheckInTime());
        dto.setCheckOutTime(record.getCheckOutTime());
        dto.setTotalHours(record.getTotalHours());
        dto.setOvertimeHours(record.getOvertimeHours());
        dto.setStatus(record.getStatus());
        dto.setSource(record.getSource());
        dto.setRemarks(record.getRemarks());
        dto.setIsRegularized(record.getIsRegularized());
        return dto;
    }
}
