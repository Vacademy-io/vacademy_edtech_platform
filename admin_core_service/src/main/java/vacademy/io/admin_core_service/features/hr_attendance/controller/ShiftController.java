package vacademy.io.admin_core_service.features.hr_attendance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_attendance.dto.ShiftAssignDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.ShiftDTO;
import vacademy.io.admin_core_service.features.hr_attendance.service.ShiftService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/shifts")
public class ShiftController {

    @Autowired
    private ShiftService shiftService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_SHIFT",
            action = "CREATE",
            entityIdExpr = "#result?.body")
    public ResponseEntity<String> createShift(
            @RequestBody ShiftDTO shiftDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(shiftService.createShift(shiftDTO, instituteId));
    }

    @GetMapping
    public ResponseEntity<List<ShiftDTO>> getShifts(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(shiftService.getShifts(instituteId));
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_SHIFT",
            action = "UPDATE",
            entityIdExpr = "#id")
    public ResponseEntity<String> updateShift(
            @PathVariable("id") String id,
            @RequestBody ShiftDTO shiftDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(shiftService.updateShift(id, shiftDTO, instituteId));
    }

    @PostMapping("/assign")
    @Auditable(
            entityType = "HR_SHIFT",
            action = "ASSIGN",
            entityIdExpr = "#assignDTO?.shiftId")
    public ResponseEntity<String> assignShiftToEmployees(
            @RequestBody ShiftAssignDTO assignDTO,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(shiftService.assignShiftToEmployees(assignDTO, instituteId));
    }
}
