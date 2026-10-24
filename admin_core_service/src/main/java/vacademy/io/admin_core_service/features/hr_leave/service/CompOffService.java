package vacademy.io.admin_core_service.features.hr_leave.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceRecord;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceStatus;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceRecordRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.HolidayRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.service.HrNotificationService;
import vacademy.io.admin_core_service.features.hr_leave.dto.CompOffActionDTO;
import vacademy.io.admin_core_service.features.hr_leave.dto.CompOffDTO;
import vacademy.io.admin_core_service.features.hr_leave.entity.CompensatoryOff;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveBalance;
import vacademy.io.admin_core_service.features.hr_leave.entity.LeaveType;
import vacademy.io.admin_core_service.features.hr_leave.enums.LeaveStatus;
import vacademy.io.admin_core_service.features.hr_leave.repository.CompensatoryOffRepository;
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
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@lombok.extern.slf4j.Slf4j
@Service
public class CompOffService {

    /**
     * Terminal status for an APPROVED comp-off whose expiry date has passed
     * without being spent. Stored in the same String status column as the
     * LeaveStatus values (kept as a literal so entities/enums stay untouched).
     */
    public static final String STATUS_EXPIRED = "EXPIRED";

    @Autowired
    private CompensatoryOffRepository compensatoryOffRepository;

    @Autowired
    private LeaveTypeRepository leaveTypeRepository;

    @Autowired
    private LeaveBalanceRepository leaveBalanceRepository;

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    @Autowired
    private AttendanceRecordRepository attendanceRecordRepository;

    @Autowired
    private HolidayRepository holidayRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrNotificationService hrNotificationService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Transactional
    public String requestCompOff(CompOffDTO dto, String instituteId, CustomUserDetails user) {
        if (!StringUtils.hasText(dto.getEmployeeId())) {
            throw new VacademyException("Employee ID is required");
        }
        if (dto.getWorkedOnDate() == null) {
            throw new VacademyException("Worked on date is required");
        }
        // Sanity clamp: the client-supplied earnedDays is never trusted beyond
        // a plausible single-request range.
        if (dto.getEarnedDays() == null || dto.getEarnedDays().compareTo(BigDecimal.ZERO) <= 0
                || dto.getEarnedDays().compareTo(new BigDecimal("2")) > 0) {
            throw new VacademyException("Earned days must be greater than zero and at most 2");
        }

        // Non-HR callers may only request comp-off for themselves; the employee
        // is verified to belong to the validated institute.
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, dto.getEmployeeId());

        // Comp-off is only earned for work on a non-working day: the worked
        // date must be a configured weekend day or a holiday.
        AttendanceConfig config = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);
        Set<DayOfWeek> weekendDays = HrTimeUtil.resolveWeekendDays(config);
        boolean isWeekend = weekendDays.contains(dto.getWorkedOnDate().getDayOfWeek());
        boolean isHoliday = holidayRepository.existsByInstituteIdAndDate(instituteId, dto.getWorkedOnDate());
        if (!isWeekend && !isHoliday) {
            throw new VacademyException("Compensatory off can only be requested for work done on a weekend or holiday");
        }

        // If the employee has attendance records for that month at all, require
        // a PRESENT/HALF_DAY record on the worked date as proof of presence.
        // (Institutes not tracking attendance have no records — skip the check.)
        YearMonth workedMonth = YearMonth.from(dto.getWorkedOnDate());
        List<AttendanceRecord> monthRecords = attendanceRecordRepository
                .findByEmployeeIdAndAttendanceDateBetweenOrderByAttendanceDateAsc(
                        employee.getId(), workedMonth.atDay(1), workedMonth.atEndOfMonth());
        if (!monthRecords.isEmpty()) {
            boolean workedThatDay = monthRecords.stream()
                    .anyMatch(r -> r.getAttendanceDate().isEqual(dto.getWorkedOnDate())
                            && (AttendanceStatus.PRESENT.name().equals(r.getStatus())
                                || AttendanceStatus.HALF_DAY.name().equals(r.getStatus())));
            if (!workedThatDay) {
                throw new VacademyException("No attendance record found showing you worked on " + dto.getWorkedOnDate());
            }
        }

        CompensatoryOff compOff = new CompensatoryOff();
        compOff.setEmployee(employee);
        compOff.setWorkedOnDate(dto.getWorkedOnDate());
        compOff.setEarnedDays(dto.getEarnedDays());
        compOff.setExpiryDate(dto.getExpiryDate());
        compOff.setUsed(false);
        compOff.setStatus(LeaveStatus.PENDING.name());

        compOff = compensatoryOffRepository.save(compOff);
        return compOff.getId();
    }

    @Transactional
    public String approveRejectCompOff(String id, CompOffActionDTO actionDTO, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);

        CompensatoryOff compOff = compensatoryOffRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Compensatory off request not found"));
        hrAccessGuard.requireInstituteMatch(compOff.getEmployee().getInstituteId(), instituteId, "Compensatory off request");

        // No self-approval: even HR staff must not decide their own comp-off.
        String requesterUserId = compOff.getEmployee().getUserId();
        if (requesterUserId != null && requesterUserId.equals(user.getUserId())) {
            throw new ForbiddenException("You cannot approve or reject your own compensatory off request");
        }

        if (!LeaveStatus.PENDING.name().equals(compOff.getStatus())) {
            throw new VacademyException("Only pending compensatory off requests can be approved or rejected");
        }

        if (actionDTO.getApproved() == null) {
            throw new VacademyException("Approval decision is required");
        }

        if (Boolean.TRUE.equals(actionDTO.getApproved())) {
            compOff.setStatus(LeaveStatus.APPROVED.name());
            compOff.setApprovedBy(user.getUserId());

            // BUG 6 FIX: Credit approved comp-off to leave balance
            creditCompOffToLeaveBalance(compOff);
        } else {
            compOff.setStatus(LeaveStatus.REJECTED.name());
        }

        compensatoryOffRepository.save(compOff);

        notifyCompOffDecision(compOff, Boolean.TRUE.equals(actionDTO.getApproved()));

        // Phase F5: HR_COMP_OFF_DECIDED workflow trigger (emit-and-forget — a
        // workflow failure must never break the decision itself)
        try {
            Map<String, Object> contextData = new HashMap<>();
            contextData.put("compOffId", compOff.getId());
            contextData.put("employeeId", compOff.getEmployee().getId());
            contextData.put("employeeUserId", compOff.getEmployee().getUserId());
            contextData.put("workedOnDate", compOff.getWorkedOnDate() != null
                    ? compOff.getWorkedOnDate().toString() : null);
            contextData.put("earnedDays", compOff.getEarnedDays() != null
                    ? compOff.getEarnedDays().toPlainString() : null);
            contextData.put("expiryDate", compOff.getExpiryDate() != null
                    ? compOff.getExpiryDate().toString() : null);
            contextData.put("status", compOff.getStatus());
            contextData.put("approvedBy", compOff.getApprovedBy());
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.HR_COMP_OFF_DECIDED.name(),
                    compOff.getId(),
                    instituteId,
                    contextData);
        } catch (Exception e) {
            log.warn("Failed to trigger HR_COMP_OFF_DECIDED workflow", e);
        }

        return compOff.getId();
    }

    /**
     * CompOffExpiryJob worker: marks APPROVED comp-offs whose expiry date has
     * passed (per the owning institute's timezone) as EXPIRED, and — when the
     * credited days were never spent — removes them from the COMP_OFF balance's
     * adjustment so they stop being spendable. Conservative: the deduction is
     * capped at the balance still available, so an expiry can never drive the
     * closing balance negative.
     *
     * @return number of comp-offs expired
     */
    @Transactional
    public int expireOverdueCompOffs() {
        // Broad candidate fetch using the platform default zone plus a day of
        // slack; the exact "is it past expiry" test below uses each owning
        // institute's own timezone.
        LocalDate broadCutoff = LocalDate.now(ZoneId.of(HrTimeUtil.DEFAULT_TIMEZONE)).plusDays(1);
        List<CompensatoryOff> candidates = compensatoryOffRepository
                .findByStatusAndExpiryDateLessThan(LeaveStatus.APPROVED.name(), broadCutoff);

        Map<String, AttendanceConfig> configCache = new HashMap<>();
        int expired = 0;

        for (CompensatoryOff compOff : candidates) {
            try {
                EmployeeProfile employee = compOff.getEmployee();
                String instituteId = employee.getInstituteId();
                AttendanceConfig config = configCache.computeIfAbsent(instituteId,
                        id -> attendanceConfigRepository.findByInstituteId(id).orElse(null));
                LocalDate today = LocalDate.now(HrTimeUtil.resolveZone(config));
                if (compOff.getExpiryDate() == null || !compOff.getExpiryDate().isBefore(today)) {
                    continue; // not yet past expiry in the institute's zone
                }

                compOff.setStatus(STATUS_EXPIRED);

                // Claw back only credits that are still unspent
                if (!Boolean.TRUE.equals(compOff.getUsed()) && compOff.getEarnedDays() != null
                        && compOff.getEarnedDays().compareTo(BigDecimal.ZERO) > 0) {
                    deductExpiredDaysFromBalance(employee, instituteId, compOff.getEarnedDays(),
                            compOff.getExpiryDate(), today);
                }

                compensatoryOffRepository.save(compOff);
                expired++;
            } catch (Exception e) {
                log.warn("[comp-off-expiry] failed to expire comp-off {}: {}", compOff.getId(), e.getMessage());
            }
        }
        return expired;
    }

    /**
     * Deducts min(days, available) from the COMP_OFF balance's adjustment.
     * The balance is looked up for the current year first, then the expiry
     * year (a comp-off credited late in December can expire in January).
     */
    private void deductExpiredDaysFromBalance(EmployeeProfile employee, String instituteId,
                                              BigDecimal days, LocalDate expiryDate, LocalDate today) {
        Optional<LeaveType> compOffType = leaveTypeRepository.findByInstituteIdAndCode(instituteId, "COMP_OFF");
        if (compOffType.isEmpty()) {
            return; // nothing was ever credited
        }
        LeaveBalance balance = leaveBalanceRepository
                .findByEmployee_IdAndLeaveType_IdAndYear(employee.getId(), compOffType.get().getId(), today.getYear())
                .or(() -> leaveBalanceRepository.findByEmployee_IdAndLeaveType_IdAndYear(
                        employee.getId(), compOffType.get().getId(), expiryDate.getYear()))
                .orElse(null);
        if (balance == null) {
            return;
        }

        BigDecimal available = balance.getClosingBalance();
        if (available.compareTo(BigDecimal.ZERO) <= 0) {
            return; // already spent (or over-spent) — never push it negative
        }
        BigDecimal deduct = days.min(available);
        BigDecimal currentAdjustment = balance.getAdjustment() != null ? balance.getAdjustment() : BigDecimal.ZERO;
        balance.setAdjustment(currentAdjustment.subtract(deduct));
        leaveBalanceRepository.save(balance);
    }

    /** Best-effort employee email on a comp-off decision (never breaks the operation). */
    private void notifyCompOffDecision(CompensatoryOff compOff, boolean approved) {
        try {
            String subject = approved
                    ? "Your compensatory off was approved"
                    : "Your compensatory off was rejected";
            String body = hrNotificationService.buildEmailBody(subject,
                    "Worked on", compOff.getWorkedOnDate() != null ? compOff.getWorkedOnDate().toString() : null,
                    "Earned days", compOff.getEarnedDays() != null ? compOff.getEarnedDays().toPlainString() : null,
                    "Expires on", compOff.getExpiryDate() != null ? compOff.getExpiryDate().toString() : null,
                    "Status", compOff.getStatus());
            hrNotificationService.emailEmployee(compOff.getEmployee(), subject, body);
        } catch (Exception e) {
            // emailEmployee already swallows send failures; this guards lazy-load surprises
        }
    }

    @Transactional(readOnly = true)
    public List<CompOffDTO> getCompOffs(String employeeId, String instituteId, CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        // Fetch all comp offs for the employee (all statuses), ordered by worked on date desc
        List<CompensatoryOff> compOffs = compensatoryOffRepository
                .findByEmployee_IdAndStatusOrderByWorkedOnDateDesc(employeeId, LeaveStatus.APPROVED.name());

        // Also get pending ones
        List<CompensatoryOff> pendingCompOffs = compensatoryOffRepository
                .findByEmployee_IdAndStatusOrderByWorkedOnDateDesc(employeeId, LeaveStatus.PENDING.name());

        // Merge both lists into a new mutable list
        List<CompensatoryOff> allCompOffs = new ArrayList<>(compOffs);
        allCompOffs.addAll(pendingCompOffs);

        return allCompOffs.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * BUG 6 FIX: When a comp-off is approved, credit the earned days to the employee's
     * COMP_OFF leave balance for the current year. Find or create the COMP_OFF leave type
     * for the institute, then find or create a LeaveBalance and add earned days to adjustment.
     */
    private void creditCompOffToLeaveBalance(CompensatoryOff compOff) {
        EmployeeProfile employee = compOff.getEmployee();
        String instituteId = employee.getInstituteId();
        // Year derivation uses the institute's timezone (JVM stays UTC)
        AttendanceConfig config = attendanceConfigRepository.findByInstituteId(instituteId).orElse(null);
        int currentYear = LocalDate.now(HrTimeUtil.resolveZone(config)).getYear();

        // Find or create COMP_OFF leave type for the institute
        LeaveType compOffLeaveType = leaveTypeRepository.findByInstituteIdAndCode(instituteId, "COMP_OFF")
                .orElseGet(() -> {
                    LeaveType newType = new LeaveType();
                    newType.setInstituteId(instituteId);
                    newType.setName("Compensatory Off");
                    newType.setCode("COMP_OFF");
                    newType.setIsPaid(true);
                    newType.setIsCarryForward(false);
                    newType.setIsEncashable(false);
                    newType.setRequiresDocument(false);
                    newType.setStatus("ACTIVE");
                    return leaveTypeRepository.save(newType);
                });

        // Find or create leave balance for the employee + COMP_OFF leave type + current year
        Optional<LeaveBalance> existingBalance = leaveBalanceRepository
                .findByEmployee_IdAndLeaveType_IdAndYear(employee.getId(), compOffLeaveType.getId(), currentYear);

        LeaveBalance balance;
        if (existingBalance.isPresent()) {
            balance = existingBalance.get();
        } else {
            balance = new LeaveBalance();
            balance.setEmployee(employee);
            balance.setLeaveType(compOffLeaveType);
            balance.setYear(currentYear);
            balance.setOpeningBalance(BigDecimal.ZERO);
            balance.setAccrued(BigDecimal.ZERO);
            balance.setUsed(BigDecimal.ZERO);
            balance.setAdjustment(BigDecimal.ZERO);
            balance.setCarriedForward(BigDecimal.ZERO);
            balance.setEncashed(BigDecimal.ZERO);
        }

        // Add earned days to the adjustment field
        BigDecimal currentAdjustment = balance.getAdjustment() != null ? balance.getAdjustment() : BigDecimal.ZERO;
        balance.setAdjustment(currentAdjustment.add(compOff.getEarnedDays()));
        leaveBalanceRepository.save(balance);
    }

    private CompOffDTO toDTO(CompensatoryOff entity) {
        return CompOffDTO.builder()
                .id(entity.getId())
                .employeeId(entity.getEmployee().getId())
                .workedOnDate(entity.getWorkedOnDate())
                .earnedDays(entity.getEarnedDays())
                .expiryDate(entity.getExpiryDate())
                .status(entity.getStatus())
                .build();
    }
}
