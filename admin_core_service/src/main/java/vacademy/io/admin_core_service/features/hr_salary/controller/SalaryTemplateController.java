package vacademy.io.admin_core_service.features.hr_salary.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_salary.dto.SalaryTemplateDTO;
import vacademy.io.admin_core_service.features.hr_salary.service.SalaryTemplateService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/salary/templates")
public class SalaryTemplateController {

    @Autowired
    private SalaryTemplateService salaryTemplateService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @PostMapping
    @Auditable(
            entityType = "HR_SALARY_TEMPLATE",
            action = "CREATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'created salary template ' + #dto?.name")
    public ResponseEntity<String> createTemplate(
            @RequestBody SalaryTemplateDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = salaryTemplateService.createTemplate(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping
    public ResponseEntity<List<SalaryTemplateDTO>> getTemplates(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        List<SalaryTemplateDTO> templates = salaryTemplateService.getTemplates(instituteId);
        return ResponseEntity.ok(templates);
    }

    @GetMapping("/{id}")
    public ResponseEntity<SalaryTemplateDTO> getTemplateById(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        SalaryTemplateDTO template = salaryTemplateService.getTemplateById(id, instituteId);
        return ResponseEntity.ok(template);
    }

    @PutMapping("/{id}")
    @Auditable(
            entityType = "HR_SALARY_TEMPLATE",
            action = "UPDATE",
            entityIdExpr = "#id",
            descriptionExpr = "'updated salary template ' + (#dto?.name ?: #id)")
    public ResponseEntity<String> updateTemplate(
            @PathVariable("id") String id,
            @RequestBody SalaryTemplateDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String updatedId = salaryTemplateService.updateTemplate(id, dto, instituteId);
        return ResponseEntity.ok(updatedId);
    }
}
