package vacademy.io.admin_core_service.features.hr_employee.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_employee.dto.DepartmentDTO;
import vacademy.io.admin_core_service.features.hr_employee.service.DepartmentService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/departments")
public class DepartmentController {

    @Autowired
    private DepartmentService departmentService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_DEPARTMENT",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created department ' + (#dto?.name ?: '')")
    public ResponseEntity<String> addDepartment(
            @RequestBody DepartmentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = departmentService.addDepartment(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<DepartmentDTO>> getDepartments(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<DepartmentDTO> departments = departmentService.getDepartments(instituteId);
        return ResponseEntity.ok(departments);
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_DEPARTMENT",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated department ' + #id")
    public ResponseEntity<String> updateDepartment(
            @PathVariable("id") String id,
            @RequestBody DepartmentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String updatedId = departmentService.updateDepartment(id, dto, instituteId);
        return ResponseEntity.ok(updatedId);
    }

    @DeleteMapping("/{id}")
    @Auditable(
            entityType = "HR_DEPARTMENT",
            action = "DEACTIVATE",
            entityIdExpr = "#id",
            descriptionExpr = "'deactivated department ' + #id")
    public ResponseEntity<Void> deactivateDepartment(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        departmentService.deactivateDepartment(id, instituteId);
        return ResponseEntity.ok().build();
    }
}
