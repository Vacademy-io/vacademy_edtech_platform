package vacademy.io.admin_core_service.features.hr_attendance.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceConfigDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceRecordDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceSummaryDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.BulkAttendanceMarkDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.CheckInDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.CheckOutDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.RegularizationActionDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.RegularizationDTO;
import vacademy.io.admin_core_service.features.hr_attendance.service.AttendanceConfigService;
import vacademy.io.admin_core_service.features.hr_attendance.service.AttendanceService;
import vacademy.io.admin_core_service.features.hr_attendance.service.RegularizationService;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/attendance")
public class AttendanceController {

    @Autowired
    private AttendanceConfigService attendanceConfigService;

    @Autowired
    private AttendanceService attendanceService;

    @Autowired
    private RegularizationService regularizationService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping("/config")
    @Auditable(
            entityType = "HR_ATTENDANCE_CONFIG",
            action = "UPDATE",
            entityIdExpr = "#instituteId")
    public ResponseEntity<AttendanceConfigDTO> saveConfig(
            @RequestBody AttendanceConfigDTO configDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(attendanceConfigService.saveConfig(configDTO, instituteId));
    }

    @GetMapping("/config")
    public ResponseEntity<AttendanceConfigDTO> getConfig(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(attendanceConfigService.getConfig(instituteId));
    }

    @PostMapping("/check-in")
    public ResponseEntity<String> checkIn(
            @RequestBody CheckInDTO checkInDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user,
            HttpServletRequest request) {
        EmployeeProfile employee = resolveTargetEmployee(user, instituteId, checkInDTO.getEmployeeId());
        return ResponseEntity.ok(attendanceService.checkIn(checkInDTO, employee, resolveClientIp(request)));
    }

    @PostMapping("/check-out")
    public ResponseEntity<String> checkOut(
            @RequestBody CheckOutDTO checkOutDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user,
            HttpServletRequest request) {
        EmployeeProfile employee = resolveTargetEmployee(user, instituteId, checkOutDTO.getEmployeeId());
        return ResponseEntity.ok(attendanceService.checkOut(checkOutDTO, employee, resolveClientIp(request)));
    }

    @PostMapping("/mark")
    @Auditable(
            entityType = "HR_ATTENDANCE",
            action = "BULK_MARK",
            entityIdExpr = "#instituteId")
    public ResponseEntity<String> markBulkAttendance(
            @RequestBody BulkAttendanceMarkDTO bulkDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(attendanceService.markBulkAttendance(bulkDTO, instituteId));
    }

    @GetMapping
    public ResponseEntity<List<AttendanceRecordDTO>> getAttendanceRecords(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "employeeId", required = false) String employeeId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        if (employeeId != null && !employeeId.isEmpty()) {
            // Single-employee view: an employee may see their OWN records, HR staff anyone's.
            hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        } else {
            hrAccessGuard.requireHrStaff(user, instituteId);
        }
        return ResponseEntity.ok(attendanceService.getAttendanceRecords(instituteId, employeeId, month, year));
    }

    @GetMapping("/summary")
    public ResponseEntity<List<AttendanceSummaryDTO>> getAttendanceSummary(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(attendanceService.getAttendanceSummary(instituteId, month, year));
    }

    @GetMapping("/regularization")
    public ResponseEntity<List<RegularizationDTO>> getRegularizations(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(regularizationService.getRegularizations(instituteId, status));
    }

    @PostMapping("/regularization")
    public ResponseEntity<String> requestRegularization(
            @RequestBody RegularizationDTO regularizationDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        EmployeeProfile employee = resolveTargetEmployee(user, instituteId, regularizationDTO.getEmployeeId());
        return ResponseEntity.ok(regularizationService.requestRegularization(regularizationDTO, employee, instituteId));
    }

    @PutMapping("/regularization/{id}/action")
    @Auditable(
            entityType = "HR_ATTENDANCE_REGULARIZATION",
            action = "ACTION",
            entityIdExpr = "#id")
    public ResponseEntity<String> approveRejectRegularization(
            @PathVariable("id") String id,
            @RequestBody RegularizationActionDTO actionDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(regularizationService.approveRejectRegularization(id, actionDTO, user.getUserId(), instituteId));
    }

    /**
     * Self-service target resolution: no employeeId in the body means "me";
     * an explicit employeeId is only honored for the caller themselves or HR staff.
     */
    private EmployeeProfile resolveTargetEmployee(CustomUserDetails user, String instituteId, String employeeId) {
        if (employeeId == null || employeeId.isEmpty()) {
            return hrAccessGuard.resolveSelfEmployee(user, instituteId);
        }
        return hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
    }

    /**
     * Derives the caller's IP server-side: first hop of X-Forwarded-For when
     * present (set by the ingress), otherwise the socket remote address. The
     * client-supplied ip_address in the request body is never trusted.
     */
    private String resolveClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (StringUtils.hasText(forwarded)) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
