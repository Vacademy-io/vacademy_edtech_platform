package vacademy.io.admin_core_service.features.hr_leave.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.entity.Holiday;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceSource;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceStatus;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRecordRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.HolidayRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;
import vacademy.io.admin_core_service.features.hr_payroll.service.HrMonthLockService;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveActionDTO;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveApplicationDTO;
import vacademy.io.admin_core_service.features.hr_leave.dto.LeaveApplyDTO;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveApplication;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveBalance;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveType;
import vacademy.io.admin_core_service.features.hr_leave.enums.HalfDayType;
import vacademy.io.admin_core_service.features.hr_leave.enums.LeaveStatus;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveApplicationRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveBalanceRepository;
import vacademy.io.admin_core_service.features.hr_leave.repository.LeaveTypeRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@lombok.extern.slf4j.Slf4j
@Service
public class LeaveApplicationService {

    @Autowired
    private LeaveApplicationRepository leaveApplicationRepository;

    @Autowired
    private LeaveTypeRepository leaveTypeRepository;

    @Autowired
    private LeaveBalanceRepository leaveBalanceRepository;

    @Autowired
    private HolidayRepository holidayRepository;

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    @Autowired
    private AttendanceRecordRepository attendanceRecordRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrMonthLockService hrMonthLockService;

    @Autowired
    private HrNotificationService hrNotificationService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Transactional
    public String applyLeave(LeaveApplyDTO dto, String instituteId, CustomUserDetails user) {
        if (!StringUtils.hasText(dto.getEmployeeId())) {
            throw new VacademyException("Employee ID is required");
        }
        if (!StringUtils.hasText(dto.getLeaveTypeId())) {
            throw new VacademyException("Leave type ID is required");
        }
        if (dto.getFromDate() == null || dto.getToDate() == null) {
            throw new VacademyException("From date and to date are required");
        }
        if (dto.getFromDate().isAfter(dto.getToDate())) {
            throw new VacademyException("From date cannot be after to date");
        }

        // BUG 7 FIX: Reject cross-year leave applications
        if (dto.getFromDate().getYear() != dto.getToDate().getYear()) {
            throw new VacademyException("Cross-year leave applications are not supported. Please apply separately for each year.");
        }

        // BUG 3 FIX: Half-day leave must be for a single day only
        if (Boolean.TRUE.equals(dto.getIsHalfDay()) && !dto.getFromDate().isEqual(dto.getToDate())) {
            throw new VacademyException("Half-day leave can only be applied for a single day");
        }

        // Non-HR callers may only apply for themselves; the employee is
        // verified to belong to the validated institute.
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, dto.getEmployeeId());

        LeaveType leaveType = leaveTypeRepository.findById(dto.getLeaveTypeId())
                .orElseThrow(() -> new VacademyException("Leave type not found"));
        hrAccessGuard.requireInstituteMatch(leaveType.getInstituteId(), instituteId, "Leave type");

        // Inactive leave types cannot be applied for
        if (leaveType.getStatus() != null && !"ACTIVE".equals(leaveType.getStatus())) {
            throw new VacademyException("This leave type is not active");
        }

        // BUG 1 FIX: Check for overlapping leaves (PENDING or APPROVED)
        List<LeaveApplication> overlapping = leaveApplicationRepository.findOverlappingLeaves(
                employee.getId(), dto.getFromDate(), dto.getToDate());
        if (!overlapping.isEmpty()) {
            throw new VacademyException("Leave application overlaps with an existing leave");
        }

        // Calculate working days (exclude the institute's configured weekend
        // days and mandatory holidays)
        List<LocalDate> workingDates = getWorkingDates(dto.getFromDate(), dto.getToDate(), instituteId);
        BigDecimal calculatedDays = new BigDecimal(workingDates.size());

        if (Boolean.TRUE.equals(dto.getIsHalfDay())) {
            // The half-day date must itself be a working day — previously the
            // 0.5 override ran before the working-days check, letting a
            // half-day on a weekend/holiday slip through.
            if (!workingDates.contains(dto.getFromDate())) {
                throw new VacademyException("Half-day leave cannot be applied on a weekend or holiday");
            }
            calculatedDays = new BigDecimal("0.5");
        } else if (calculatedDays.compareTo(BigDecimal.ZERO) <= 0) {
            throw new VacademyException("No working days in the selected date range");
        }

        // BUG 2 FIX: Validate maxConsecutiveDays
        if (leaveType.getMaxConsecutiveDays() != null && leaveType.getMaxConsecutiveDays() > 0) {
            if (calculatedDays.compareTo(new BigDecimal(leaveType.getMaxConsecutiveDays())) > 0) {
                throw new VacademyException("Requested days (" + calculatedDays
                        + ") exceed the maximum consecutive days allowed (" + leaveType.getMaxConsecutiveDays() + ") for this leave type");
            }
        }

        // Validate leave balance. UNPAID leave types (isPaid=false) are LOP:
        // they require no balance and payroll handles them separately.
        if (isPaidLeaveType(leaveType)) {
            int year = dto.getFromDate().getYear();
            LeaveBalance balance = leaveBalanceRepository
                    .findByEmployee_IdAndLeaveType_IdAndYear(employee.getId(), leaveType.getId(), year)
                    .orElse(null);

            if (balance != null) {
                BigDecimal availableBalance = balance.getClosingBalance();
                if (availableBalance.compareTo(calculatedDays) < 0) {
                    throw new VacademyException("Insufficient leave balance. Available: "
                            + availableBalance + ", Requested: " + calculatedDays);
                }
            } else {
                throw new VacademyException("No leave balance found for the selected leave type and year");
            }
        }

        // Validate halfDayType enum
        if (Boolean.TRUE.equals(dto.getIsHalfDay()) && dto.getHalfDayType() != null) {
            try {
                HalfDayType.valueOf(dto.getHalfDayType());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid half day type: " + dto.getHalfDayType());
            }
        }

        // Determine reporting manager
        String appliedTo = null;
        if (employee.getReportingManager() != null) {
            appliedTo = employee.getReportingManager().getUserId();
        }

        // Create leave application
        LeaveApplication application = new LeaveApplication();
        application.setEmployee(employee);
        application.setInstituteId(instituteId);
        application.setLeaveType(leaveType);
        application.setFromDate(dto.getFromDate());
        application.setToDate(dto.getToDate());
        application.setTotalDays(calculatedDays);
        application.setIsHalfDay(dto.getIsHalfDay() != null ? dto.getIsHalfDay() : false);
        application.setHalfDayType(dto.getHalfDayType());
        application.setReason(dto.getReason());
        application.setDocumentFileId(dto.getDocumentFileId());
        application.setStatus(LeaveStatus.PENDING.name());
        application.setAppliedTo(appliedTo);

        application = leaveApplicationRepository.save(application);

        // Best-effort heads-up to the reporting manager the request is addressed to
        if (appliedTo != null) {
            String applicantName = hrNotificationService.resolveUserName(employee.getUserId());
            hrNotificationService.emailUser(appliedTo, instituteId,
                    "Leave application awaiting your review",
                    hrNotificationService.buildEmailBody("Leave application awaiting your review",
                            "Employee", applicantName,
                            "Leave type", leaveType.getName(),
                            "From", dto.getFromDate().toString(),
                            "To", dto.getToDate().toString(),
                            "Days", calculatedDays.toPlainString(),
                            "Reason", dto.getReason()));
        }

        // Phase F5: HR_LEAVE_REQUESTED workflow trigger (emit-and-forget — a
        // workflow failure must never break the leave application itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("applicationId", application.getId());
            contextData.put("employeeId", employee.getId());
            contextData.put("employeeUserId", employee.getUserId());
            contextData.put("leaveTypeId", leaveType.getId());
            contextData.put("leaveTypeName", leaveType.getName());
            contextData.put("fromDate", dto.getFromDate().toString());
            contextData.put("toDate", dto.getToDate().toString());
            contextData.put("totalDays", calculatedDays.toPlainString());
            contextData.put("appliedTo", appliedTo);
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_LEAVE_REQUESTED.name(),
                    application.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_LEAVE_REQUESTED workflow", e);
        }

        return application.getId();
    }

    @Transactional
    public String approveRejectLeave(String id, LeaveActionDTO actionDTO, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);

        LeaveApplication application = leaveApplicationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Leave application not found"));
        hrAccessGuard.requireInstituteMatch(application.getInstituteId(), instituteId, "Leave application");

        // No self-approval: even HR staff must not decide their own leave.
        String applicantUserId = application.getEmployee().getUserId();
        if (applicantUserId != null && applicantUserId.equals(user.getUserId())) {
            throw new ForbiddenException("You cannot approve or reject your own leave application");
        }

        if (!LeaveStatus.PENDING.name().equals(application.getStatus())) {
            throw new VacademyException("Only pending leave applications can be approved or rejected");
        }

        if (!StringUtils.hasText(actionDTO.getAction())) {
            throw new VacademyException("Action is required");
        }

        String action = actionDTO.getAction().toUpperCase();
        if (!LeaveStatus.APPROVED.name().equals(action) && !LeaveStatus.REJECTED.name().equals(action)) {
            throw new VacademyException("Action must be APPROVED or REJECTED");
        }

        if (LeaveStatus.APPROVED.name().equals(action)) {
            // Payroll month-lock: approving writes balances + attendance for the
            // leave's dates — refuse when any month it touches is already processed.
            requireLeaveMonthsUnlocked(application, "approve leave");

            // Deduct from leave balance — only for PAID leave types. UNPAID
            // leave is LOP with no balance to deduct (payroll handles it).
            if (isPaidLeaveType(application.getLeaveType())) {
                int year = application.getFromDate().getYear();
                LeaveBalance balance = leaveBalanceRepository
                        .findByEmployee_IdAndLeaveType_IdAndYear(
                                application.getEmployee().getId(),
                                application.getLeaveType().getId(),
                                year)
                        .orElseThrow(() -> new VacademyException("Leave balance not found"));

                // Re-validate at approval time: the balance may have changed since the
                // application was submitted (other approvals, adjustments, encashment).
                BigDecimal availableBalance = balance.getClosingBalance();
                if (availableBalance.compareTo(application.getTotalDays()) < 0) {
                    throw new VacademyException("Insufficient leave balance to approve. Available: "
                            + availableBalance + ", Requested: " + application.getTotalDays());
                }

                BigDecimal currentUsed = balance.getUsed() != null ? balance.getUsed() : BigDecimal.ZERO;
                balance.setUsed(currentUsed.add(application.getTotalDays()));
                leaveBalanceRepository.save(balance);
            }

            application.setStatus(LeaveStatus.APPROVED.name());
            application.setApprovedBy(user.getUserId());
            application.setApprovedAt(LocalDateTime.now());

            // Reflect the approved leave on the attendance calendar
            markAttendanceForApprovedLeave(application);
        } else {
            // Rejected
            if (!StringUtils.hasText(actionDTO.getRejectionReason())) {
                throw new VacademyException("Rejection reason is required");
            }
            application.setStatus(LeaveStatus.REJECTED.name());
            application.setRejectionReason(actionDTO.getRejectionReason());
        }

        leaveApplicationRepository.save(application);

        notifyLeaveDecision(application);

        // Phase F5: HR_LEAVE_DECIDED workflow trigger (emit-and-forget — a
        // workflow failure must never break the decision itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("applicationId", application.getId());
            contextData.put("employeeId", application.getEmployee().getId());
            contextData.put("employeeUserId", application.getEmployee().getUserId());
            contextData.put("leaveTypeId", application.getLeaveType().getId());
            contextData.put("fromDate", application.getFromDate().toString());
            contextData.put("toDate", application.getToDate().toString());
            contextData.put("totalDays", application.getTotalDays() != null
                    ? application.getTotalDays().toPlainString() : null);
            contextData.put("status", application.getStatus());
            contextData.put("approvedBy", application.getApprovedBy());
            contextData.put("rejectionReason", application.getRejectionReason());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_LEAVE_DECIDED.name(),
                    application.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_LEAVE_DECIDED workflow", e);
        }

        return application.getId();
    }

    /**
     * Payroll month-lock across the leave's whole range: any month the
     * from→to span touches must still be open (cross-year applications are
     * rejected at apply time, so the span is at most 12 months).
     */
    private void requireLeaveMonthsUnlocked(LeaveApplication application, String actionLabel) {
        YearMonth from = YearMonth.from(application.getFromDate());
        YearMonth to = YearMonth.from(application.getToDate());
        for (YearMonth ym = from; !ym.isAfter(to); ym = ym.plusMonths(1)) {
            hrMonthLockService.requireUnlocked(application.getInstituteId(), ym.atDay(1), actionLabel);
        }
    }

    /** Best-effort employee email on a leave decision (never breaks the operation). */
    private void notifyLeaveDecision(LeaveApplication application) {
        try {
            boolean approved = LeaveStatus.APPROVED.name().equals(application.getStatus());
            String subject = approved ? "Your leave application was approved"
                    : "Your leave application was rejected";
            String body = hrNotificationService.buildEmailBody(subject,
                    "Leave type", application.getLeaveType().getName(),
                    "From", application.getFromDate().toString(),
                    "To", application.getToDate().toString(),
                    "Days", application.getTotalDays() != null
                            ? application.getTotalDays().toPlainString() : null,
                    "Status", application.getStatus(),
                    "Reason", approved ? null : application.getRejectionReason());
            hrNotificationService.emailEmployee(application.getEmployee(), subject, body);
        } catch (Exception e) {
            // emailEmployee already swallows send failures; this guards lazy-load surprises
        }
    }

    @Transactional
    public String cancelLeave(String id, String instituteId, CustomUserDetails user) {
        LeaveApplication application = leaveApplicationRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Leave application not found"));

        // Membership + institute scope + only the applicant themselves or HR
        // staff may cancel.
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, application.getEmployee().getId());
        hrAccessGuard.requireInstituteMatch(application.getInstituteId(), instituteId, "Leave application");

        String currentStatus = application.getStatus();
        if (!LeaveStatus.PENDING.name().equals(currentStatus)
                && !LeaveStatus.APPROVED.name().equals(currentStatus)) {
            throw new VacademyException("Only pending or approved leave applications can be cancelled");
        }

        // If it was approved, restore the leave balance (paid types only — no
        // balance was deducted for UNPAID/LOP leave) and revert the attendance
        // records the approval wrote.
        if (LeaveStatus.APPROVED.name().equals(currentStatus)) {
            // Payroll month-lock: cancelling an approved leave rewrites balances
            // and attendance for its dates — refuse once payroll is processed.
            requireLeaveMonthsUnlocked(application, "cancel approved leave");

            if (isPaidLeaveType(application.getLeaveType())) {
                int year = application.getFromDate().getYear();
                LeaveBalance balance = leaveBalanceRepository
                        .findByEmployee_IdAndLeaveType_IdAndYear(
                                application.getEmployee().getId(),
                                application.getLeaveType().getId(),
                                year)
                        .orElse(null);

                if (balance != null) {
                    BigDecimal currentUsed = balance.getUsed() != null ? balance.getUsed() : BigDecimal.ZERO;
                    BigDecimal restoredUsed = currentUsed.subtract(application.getTotalDays());
                    balance.setUsed(restoredUsed.compareTo(BigDecimal.ZERO) < 0 ? BigDecimal.ZERO : restoredUsed);
                    leaveBalanceRepository.save(balance);
                }
            }

            revertAttendanceForCancelledLeave(application);
        }

        application.setStatus(LeaveStatus.CANCELLED.name());
        leaveApplicationRepository.save(application);
        return application.getId();
    }

    @Transactional(readOnly = true)
    public Page<LeaveApplicationDTO> getLeaveApplications(String instituteId, String status,
                                                           String employeeId, int pageNo, int pageSize,
                                                           CustomUserDetails user) {
        if (StringUtils.hasText(employeeId)) {
            // Employee-scoped listing: the employee themselves or HR staff.
            hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        } else {
            // Institute-wide listing is HR staff only.
            hrAccessGuard.requireHrStaff(user, instituteId);
        }
        Pageable pageable = PageRequest.of(pageNo, pageSize);
        Page<LeaveApplication> page = leaveApplicationRepository.findByFilters(
                instituteId, status, employeeId, pageable);
        return page.map(this::toDTO);
    }

    @Transactional(readOnly = true)
    public List<LeaveApplicationDTO> getPendingForManager(String instituteId, String approverId, CustomUserDetails user) {
        hrAccessGuard.validateMember(user, instituteId);
        // Non-HR callers only ever see the queue addressed to themselves;
        // HR staff may inspect another approver's queue.
        String managerUserId = user.getUserId();
        if (StringUtils.hasText(approverId) && hrAccessGuard.isHrStaff(user)) {
            managerUserId = approverId;
        }
        List<LeaveApplication> applications = leaveApplicationRepository
                .findPendingForManagerInInstitute(managerUserId, instituteId);
        return applications.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * Returns the working dates between two dates (inclusive), excluding the
     * institute's configured weekend days (default Saturday/Sunday) and
     * mandatory holidays.
     */
    private List<LocalDate> getWorkingDates(LocalDate fromDate, LocalDate toDate, String instituteId) {
        AttendanceConfig config = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);
        Set<DayOfWeek> weekendDays = HrTimeUtil.resolveWeekendDays(config);

        // Fetch holidays in the date range
        List<Holiday> holidays = holidayRepository.findByInstituteIdAndDateRange(instituteId, fromDate, toDate);
        Set<LocalDate> holidayDates = holidays.stream()
                .filter(h -> !Boolean.TRUE.equals(h.getIsOptional()))
                .map(Holiday::getDate)
                .collect(Collectors.toSet());

        List<LocalDate> workingDates = new ArrayList<>();
        LocalDate current = fromDate;
        while (!current.isAfter(toDate)) {
            if (!weekendDays.contains(current.getDayOfWeek()) && !holidayDates.contains(current)) {
                workingDates.add(current);
            }
            current = current.plusDays(1);
        }
        return workingDates;
    }

    /**
     * UNPAID leave types (isPaid=false) are loss-of-pay: no balance is
     * required, deducted or restored for them. A null isPaid is treated as
     * paid (the previous behavior).
     */
    private boolean isPaidLeaveType(LeaveType leaveType) {
        return !Boolean.FALSE.equals(leaveType.getIsPaid());
    }

    /**
     * Leave → attendance link: on approval, upsert an hr_attendance_record row
     * for each working day of the leave. Existing rows for a day are UPDATED
     * (the unique (employee, date) constraint forbids a second insert).
     *
     * Full-day leave marks the day ON_LEAVE (source ADMIN), overwriting any
     * prior status — approving a leave is the authoritative statement that the
     * employee is on leave that day. Half-day leave marks the day HALF_DAY
     * only when the day has no PRESENT record: a day already clocked PRESENT
     * is left untouched (simplest correct behavior — presence wins over a
     * half-day marking).
     */
    private void markAttendanceForApprovedLeave(LeaveApplication application) {
        List<LocalDate> workingDates = getWorkingDates(
                application.getFromDate(), application.getToDate(), application.getInstituteId());
        boolean halfDay = Boolean.TRUE.equals(application.getIsHalfDay());

        for (LocalDate date : workingDates) {
            Optional<AttendanceRecord> existingOpt = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDate(application.getEmployee().getId(), date);

            if (halfDay && existingOpt.isPresent()
                    && AttendanceStatus.PRESENT.name().equals(existingOpt.get().getStatus())) {
                continue;
            }

            AttendanceRecord record;
            if (existingOpt.isPresent()) {
                record = existingOpt.get();
            } else {
                record = new AttendanceRecord();
                record.setEmployee(application.getEmployee());
                record.setInstituteId(application.getInstituteId());
                record.setAttendanceDate(date);
            }
            record.setStatus(halfDay ? AttendanceStatus.HALF_DAY.name() : AttendanceStatus.ON_LEAVE.name());
            record.setSource(AttendanceSource.ADMIN.name());
            attendanceRecordRepository.save(record);
        }
    }

    /**
     * On cancel of an APPROVED leave, revert the attendance rows the approval
     * wrote. Only rows still carrying the leave marking are touched:
     * - full-day: rows still ON_LEAVE — deleted when created by the approval
     *   (no check-in), restored to PRESENT when the employee had clocked in
     *   before the leave overwrote the day;
     * - half-day: the admin-sourced HALF_DAY row with no check-in is deleted;
     *   a HALF_DAY row with clock data is a genuine short day and is kept.
     */
    private void revertAttendanceForCancelledLeave(LeaveApplication application) {
        List<LocalDate> workingDates = getWorkingDates(
                application.getFromDate(), application.getToDate(), application.getInstituteId());
        boolean halfDay = Boolean.TRUE.equals(application.getIsHalfDay());

        for (LocalDate date : workingDates) {
            Optional<AttendanceRecord> existingOpt = attendanceRecordRepository
                    .findByEmployeeIdAndAttendanceDate(application.getEmployee().getId(), date);
            if (existingOpt.isEmpty()) {
                continue;
            }
            AttendanceRecord record = existingOpt.get();

            if (halfDay) {
                if (AttendanceStatus.HALF_DAY.name().equals(record.getStatus())
                        && AttendanceSource.ADMIN.name().equals(record.getSource())
                        && record.getCheckInTime() == null) {
                    attendanceRecordRepository.delete(record);
                }
            } else if (AttendanceStatus.ON_LEAVE.name().equals(record.getStatus())) {
                if (record.getCheckInTime() != null) {
                    record.setStatus(AttendanceStatus.PRESENT.name());
                    attendanceRecordRepository.save(record);
                } else {
                    attendanceRecordRepository.delete(record);
                }
            }
        }
    }

    private LeaveApplicationDTO toDTO(LeaveApplication entity) {
        return LeaveApplicationDTO.builder()
                .id(entity.getId())
                .employeeId(entity.getEmployee().getId())
                .employeeCode(entity.getEmployee().getEmployeeCode())
                .instituteId(entity.getInstituteId())
                .leaveTypeId(entity.getLeaveType().getId())
                .leaveTypeName(entity.getLeaveType().getName())
                .fromDate(entity.getFromDate())
                .toDate(entity.getToDate())
                .totalDays(entity.getTotalDays())
                .isHalfDay(entity.getIsHalfDay())
                .halfDayType(entity.getHalfDayType())
                .reason(entity.getReason())
                .documentFileId(entity.getDocumentFileId())
                .status(entity.getStatus())
                .appliedTo(entity.getAppliedTo())
                .approvedBy(entity.getApprovedBy())
                .approvedAt(entity.getApprovedAt())
                .rejectionReason(entity.getRejectionReason())
                .createdAt(entity.getCreatedAt())
                .build();
    }
}
