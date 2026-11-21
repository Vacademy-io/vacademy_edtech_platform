package vacademy.io.admin_core_service.features.hr_salary.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_salary.dto.AssignSalaryDTO;
import vacademy.io.admin_core_service.features.hr_salary.dto.EmployeeSalaryStructureDTO;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryRevisionDTO;
import vacademy.io.admin_core_service.features.hr_salary.service.SalaryStructureService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/salary/structures")
public class SalaryStructureController {

    @Autowired
    private SalaryStructureService salaryStructureService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_SALARY_STRUCTURE",
            action = "ASSIGN",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'assigned salary structure to employee ' + #dto?.employeeId")
    public ResponseEntity<String> assignSalary(
            @RequestBody AssignSalaryDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String structureId = salaryStructureService.assignSalary(dto, instituteId, user.getUserId());
        return ResponseEntity.ok(structureId);
    }

    @GetMapping("/{id}")
    public ResponseEntity<EmployeeSalaryStructureDTO> getStructure(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Self-or-HR-staff check happens inside the service: the owning employee
        // is only known after the structure is loaded by id.
        EmployeeSalaryStructureDTO structure = salaryStructureService.getStructure(id, instituteId, user);
        return ResponseEntity.ok(structure);
    }

    @GetMapping
    public ResponseEntity<List<EmployeeSalaryStructureDTO>> getEmployeeSalaryHistory(
            @RequestParam("employeeId") String employeeId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        List<EmployeeSalaryStructureDTO> history = salaryStructureService.getEmployeeSalaryHistory(employeeId);
        return ResponseEntity.ok(history);
    }

    @GetMapping("/revisions")
    public ResponseEntity<List<SalaryRevisionDTO>> getRevisionHistory(
            @RequestParam("employeeId") String employeeId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        List<SalaryRevisionDTO> revisions = salaryStructureService.getRevisionHistory(employeeId);
        return ResponseEntity.ok(revisions);
    }
}
