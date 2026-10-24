package vacademy.io.admin_core_service.features.hr_salary.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryComponentDTO;
import vacademy.io.admin_core_service.features.hr_salary.service.SalaryComponentService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/salary/components")
public class SalaryComponentController {

    @Autowired
    private SalaryComponentService salaryComponentService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_SALARY_COMPONENT",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created salary component ' + #dto?.name")
    public ResponseEntity<String> createComponent(
            @RequestBody SalaryComponentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = salaryComponentService.createComponent(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<SalaryComponentDTO>> getComponents(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<SalaryComponentDTO> components = salaryComponentService.getComponents(instituteId);
        return ResponseEntity.ok(components);
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_SALARY_COMPONENT",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated salary component ' + (#dto?.name ?: #id)")
    public ResponseEntity<String> updateComponent(
            @PathVariable("id") String id,
            @RequestBody SalaryComponentDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String updatedId = salaryComponentService.updateComponent(id, dto, instituteId);
        return ResponseEntity.ok(updatedId);
    }
}
