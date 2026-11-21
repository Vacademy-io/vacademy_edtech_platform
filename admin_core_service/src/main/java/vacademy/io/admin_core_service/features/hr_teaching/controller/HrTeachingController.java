package vacademy.io.admin_core_service.features.hr_teaching.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingAttendanceSyncResultDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingPayResultDTO;
import vacademy.io.admin_core_service.features.hr_teaching.dto.TeachingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingActivityService;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingAttendanceSyncService;
import vacademy.io.admin_core_service.features.hr_teaching.service.TeachingPayService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Phase F2 "LMS teaching → pay": bridges live-session hosting activity into HR
 * attendance and variable pay. A teacher is identified as
 * {@code live_session.created_by_user_id} matched to
 * {@code hr_employee_profile.user_id} within the institute.
 *
 * <p>Access matrix: reads (summary, pay preview) need HR staff; the summary
 * with an explicit {@code employeeId} additionally allows that employee to
 * read their own numbers. Mutations (attendance sync, pay materialize) need
 * HR admin and are audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/teaching")
public class HrTeachingController {

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private TeachingActivityService teachingActivityService;

    @Autowired
    private TeachingAttendanceSyncService teachingAttendanceSyncService;

    @Autowired
    private TeachingPayService teachingPayService;

    @GetMapping("/summary")
    public ResponseEntity<TeachingSummaryResponseDTO> getSummary(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestParam(value = "employeeId", required = false) String employeeId,
            @RequestAttribute("user") CustomUserDetails user) {
        TeachingActivityService.validateMonthYear(month, year);
        String onlyTeacherUserId = null;
        if (employeeId != null && !employeeId.isBlank()) {
            // Self-or-staff: an employee may read their OWN teaching summary
            EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
            onlyTeacherUserId = employee.getUserId();
        } else {
            hrAccessGuard.requireHrStaff(user, instituteId);
        }
        return ResponseEntity.ok(
                teachingActivityService.buildSummary(instituteId, month, year, onlyTeacherUserId));
    }

    @PostMapping("/attendance-sync")
    @Auditable(entityType = "HR_TEACHING", action = "ATTENDANCE_SYNC",
            descriptionExpr = "'Teaching attendance sync ' + #month + '/' + #year")
    public ResponseEntity<TeachingAttendanceSyncResultDTO> syncAttendance(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestParam(value = "requireLog", required = false, defaultValue = "true") boolean requireLog,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(
                teachingAttendanceSyncService.sync(instituteId, month, year, requireLog));
    }

    @PostMapping("/pay/preview")
    public ResponseEntity<TeachingPayResultDTO> previewPay(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(teachingPayService.preview(instituteId, month, year));
    }

    @PostMapping("/pay/materialize")
    @Auditable(entityType = "HR_TEACHING", action = "PAY_MATERIALIZE",
            descriptionExpr = "'Teaching pay materialize ' + #month + '/' + #year")
    public ResponseEntity<TeachingPayResultDTO> materializePay(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(teachingPayService.materialize(instituteId, month, year, user));
    }
}
