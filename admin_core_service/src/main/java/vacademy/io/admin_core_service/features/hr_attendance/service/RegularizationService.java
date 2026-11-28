package vacademy.io.admin_core_service.features.hr_attendance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.dto.RegularizationActionDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.RegularizationDTO;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRegularization;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceStatus;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRecordRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRegularizationRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;
import vacademy.io.admin_core_service.features.hr_payroll.service.HrMonthLockService;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class RegularizationService {

    @Autowired
    private AttendanceRegularizationRepository regularizationRepository;

    @Autowired
    private AttendanceRecordRepository attendanceRecordRepository;

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrMonthLockService hrMonthLockService;

    @Autowired
    private HrNotificationService hrNotificationService;

    /**
     * The institute's regularization requests, newest first, optionally narrowed
     * to one approval status (PENDING for the approval queue).
     */
    @Transactional(readOnly = true)
    public List<RegularizationDTO> getRegularizations(String instituteId, String approvalStatus) {
        List<AttendanceRegularization> found = (approvalStatus == null || approvalStatus.isBlank())
                ? regularizationRepository.findByEmployee_InstituteIdOrderByCreatedAtDesc(instituteId)
                : regularizationRepository.findByEmployee_InstituteIdAndApprovalStatusOrderByCreatedAtDesc(
                        instituteId, approvalStatus.trim().toUpperCase());
        return found.stream()
                .map(this::toDTO)
                .toList();
    }

    private RegularizationDTO toDTO(AttendanceRegularization entity) {
        RegularizationDTO dto = new RegularizationDTO();
        dto.setId(entity.getId());
        AttendanceRecord record = entity.getAttendanceRecord();
        if (record != null) {
            dto.setAttendanceId(record.getId());
            dto.setAttendanceDate(record.getAttendanceDate());
        }
        EmployeeProfile employee = entity.getEmployee();
        if (employee != null) {
            dto.setEmployeeId(employee.getId());
            dto.setEmployeeCode(employee.getEmployeeCode());
        }
        dto.setOriginalStatus(entity.getOriginalStatus());
        dto.setRequestedStatus(entity.getRequestedStatus());
        dto.setOriginalCheckIn(entity.getOriginalCheckIn());
        dto.setOriginalCheckOut(entity.getOriginalCheckOut());
        dto.setRequestedCheckIn(entity.getRequestedCheckIn());
        dto.setRequestedCheckOut(entity.getRequestedCheckOut());
        dto.setReason(entity.getReason());
        dto.setApprovalStatus(entity.getApprovalStatus());
        dto.setApprovedBy(entity.getApprovedBy());
        dto.setApprovedAt(entity.getApprovedAt());
        dto.setRemarks(entity.getRemarks());
        return dto;
    }

    /**
     * The employee is resolved and authorized by HrAccessGuard in the controller
     * (self or HR staff, member of the validated institute). The attendance
     * record must belong to that SAME employee and institute — a request may
     * never regularize someone else's record.
     */
    @Transactional
    public String requestRegularization(RegularizationDTO dto, EmployeeProfile employee, String instituteId) {
        validateRequestedTimes(dto.getRequestedCheckIn(), dto.getRequestedCheckOut());

        AttendanceRecord attendanceRecord = attendanceRecordRepository.findById(dto.getAttendanceId())
                .orElseThrow(() -> new VacademyException("Attendance record not found with id: " + dto.getAttendanceId()));
        hrAccessGuard.requireInstituteMatch(attendanceRecord.getInstituteId(), instituteId, "Attendance record");
        if (attendanceRecord.getEmployee() == null
                || !employee.getId().equals(attendanceRecord.getEmployee().getId())) {
            throw new VacademyException("Attendance record does not belong to the specified employee");
        }

        AttendanceRegularization regularization = new AttendanceRegularization();
        regularization.setAttendanceRecord(attendanceRecord);
        regularization.setEmployee(employee);
        regularization.setOriginalStatus(dto.getOriginalStatus() != null
                ? dto.getOriginalStatus() : attendanceRecord.getStatus());
        regularization.setRequestedStatus(dto.getRequestedStatus());
        regularization.setOriginalCheckIn(dto.getOriginalCheckIn() != null
                ? dto.getOriginalCheckIn() : attendanceRecord.getCheckInTime());
        regularization.setOriginalCheckOut(dto.getOriginalCheckOut() != null
                ? dto.getOriginalCheckOut() : attendanceRecord.getCheckOutTime());
        regularization.setRequestedCheckIn(dto.getRequestedCheckIn());
        regularization.setRequestedCheckOut(dto.getRequestedCheckOut());
        regularization.setReason(dto.getReason());
        regularization.setApprovalStatus("PENDING");
        regularization.setRemarks(dto.getRemarks());

        regularizationRepository.save(regularization);
        return "Regularization request submitted successfully";
    }

    @Transactional
    public String approveRejectRegularization(String id, RegularizationActionDTO actionDTO,
                                              String approverUserId, String instituteId) {
        AttendanceRegularization regularization = regularizationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Regularization request not found with id: " + id));
        hrAccessGuard.requireInstituteMatch(
                regularization.getAttendanceRecord() != null
                        ? regularization.getAttendanceRecord().getInstituteId() : null,
                instituteId, "Regularization request");

        if (!"PENDING".equals(regularization.getApprovalStatus())) {
            throw new VacademyException("Regularization request has already been processed");
        }

        if (Boolean.TRUE.equals(actionDTO.getApproved())) {
            // Payroll month-lock: approving a regularization rewrites the
            // attendance record — refuse when its month is already processed.
            AttendanceRecord lockedCheckRecord = regularization.getAttendanceRecord();
            if (lockedCheckRecord != null) {
                hrMonthLockService.requireUnlocked(lockedCheckRecord.getInstituteId(),
                        lockedCheckRecord.getAttendanceDate(), "approve regularization");
            }

            regularization.setApprovalStatus("APPROVED");
            regularization.setApprovedBy(approverUserId);
            regularization.setApprovedAt(LocalDateTime.now());
            regularization.setRemarks(actionDTO.getRemarks());

            // Update the original attendance record with the requested changes.
            // When times were changed the final status is RE-DERIVED from the
            // recalculated hours below instead of blindly trusting requestedStatus;
            // a pure status-change request (no times) still applies requestedStatus.
            AttendanceRecord record = regularization.getAttendanceRecord();
            boolean timesChanged = regularization.getRequestedCheckIn() != null
                    || regularization.getRequestedCheckOut() != null;
            if (!timesChanged && regularization.getRequestedStatus() != null) {
                record.setStatus(regularization.getRequestedStatus());
            }
            if (regularization.getRequestedCheckIn() != null) {
                record.setCheckInTime(regularization.getRequestedCheckIn());
            }
            if (regularization.getRequestedCheckOut() != null) {
                record.setCheckOutTime(regularization.getRequestedCheckOut());
            }
            record.setIsRegularized(true);

            // The applied times must still form a valid interval (e.g. a requested
            // check-out combined with the existing check-in)
            if (record.getCheckInTime() != null && record.getCheckOutTime() != null
                    && !record.getCheckOutTime().isAfter(record.getCheckInTime())) {
                throw new VacademyException("Regularized check-out time must be after check-in time");
            }

            AttendanceConfig config = attendanceConfigRepository.findByInstituteId(record.getInstituteId()).orElse(null);

            // Recalculate total hours if both check-in and check-out are present
            if (record.getCheckInTime() != null && record.getCheckOutTime() != null) {
                long minutesWorked = java.time.temporal.ChronoUnit.MINUTES.between(
                        record.getCheckInTime(), record.getCheckOutTime());
                if (record.getBreakDurationMin() != null) {
                    minutesWorked -= record.getBreakDurationMin();
                }
                minutesWorked = Math.max(0, minutesWorked);
                record.setTotalHours(java.math.BigDecimal.valueOf(minutesWorked)
                        .divide(java.math.BigDecimal.valueOf(60), 2, java.math.RoundingMode.HALF_UP));

                // Re-derive status from the recalculated hours using the institute's
                // half-day threshold (HALF_DAY below it, PRESENT otherwise).
                if (timesChanged) {
                    if (config != null && config.getHalfDayThresholdMin() != null
                            && minutesWorked < config.getHalfDayThresholdMin()) {
                        record.setStatus(AttendanceStatus.HALF_DAY.name());
                    } else {
                        record.setStatus(AttendanceStatus.PRESENT.name());
                    }
                }
            }

            // Recalculate overtime
            if (config != null && Boolean.TRUE.equals(config.getOvertimeEnabled()) && config.getOvertimeThresholdMin() != null) {
                if (record.getTotalHours() != null) {
                    long totalMinutes = (long) (record.getTotalHours().doubleValue() * 60);
                    if (totalMinutes > config.getOvertimeThresholdMin()) {
                        long overtimeMinutes = totalMinutes - config.getOvertimeThresholdMin();
                        record.setOvertimeHours(new BigDecimal(overtimeMinutes).divide(new BigDecimal("60"), 2, RoundingMode.HALF_UP));
                    } else {
                        record.setOvertimeHours(BigDecimal.ZERO);
                    }
                }
            }

            attendanceRecordRepository.save(record);
        } else {
            regularization.setApprovalStatus("REJECTED");
            regularization.setApprovedBy(approverUserId);
            regularization.setApprovedAt(LocalDateTime.now());
            regularization.setRemarks(actionDTO.getRemarks());
        }

        regularizationRepository.save(regularization);

        notifyRegularizationDecision(regularization, Boolean.TRUE.equals(actionDTO.getApproved()), instituteId);

        return Boolean.TRUE.equals(actionDTO.getApproved())
                ? "Regularization request approved successfully"
                : "Regularization request rejected";
    }

    /** Best-effort employee email on a regularization decision (never breaks the operation). */
    private void notifyRegularizationDecision(AttendanceRegularization regularization,
                                              boolean approved, String instituteId) {
        try {
            String date = regularization.getAttendanceRecord() != null
                    && regularization.getAttendanceRecord().getAttendanceDate() != null
                    ? regularization.getAttendanceRecord().getAttendanceDate().toString() : null;
            String subject = approved
                    ? "Attendance regularization approved"
                    : "Attendance regularization rejected";
            String body = hrNotificationService.buildEmailBody(subject,
                    "Date", date,
                    "Status", approved ? "APPROVED" : "REJECTED",
                    "Remarks", regularization.getRemarks());
            EmployeeProfile employee = regularization.getEmployee();
            // The employee's profile may live outside the record's institute id;
            // sends are attributed to the validated institute.
            hrNotificationService.emailUser(employee != null ? employee.getUserId() : null,
                    instituteId, subject, body);
        } catch (Exception e) {
            // emailUser already swallows send failures; this guards lazy-load surprises
        }
    }

    private void validateRequestedTimes(LocalDateTime requestedCheckIn, LocalDateTime requestedCheckOut) {
        if (requestedCheckIn != null && requestedCheckOut != null
                && !requestedCheckOut.isAfter(requestedCheckIn)) {
            throw new VacademyException("Requested check-out time must be after requested check-in time");
        }
    }
}
