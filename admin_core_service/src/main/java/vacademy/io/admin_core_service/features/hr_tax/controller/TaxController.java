package vacademy.io.admin_core_service.features.hr_tax.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_tax.dto.TaxComputationDTO;
import vacademy.io.admin_core_service.features.hr_tax.dto.TaxConfigurationDTO;
import vacademy.io.admin_core_service.features.hr_tax.dto.TaxDeclarationDTO;
import vacademy.io.admin_core_service.features.hr_tax.service.TaxComputationService;
import vacademy.io.admin_core_service.features.hr_tax.service.TaxConfigurationService;
import vacademy.io.admin_core_service.features.hr_tax.service.TaxDeclarationService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

@RestController
@RequestMapping("/admin-core-service/api/v1/hr/tax")
public class TaxController {

    @Autowired
    private TaxConfigurationService taxConfigurationService;

    @Autowired
    private TaxDeclarationService taxDeclarationService;

    @Autowired
    private TaxComputationService taxComputationService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    // ======================== Tax Configuration ========================

    @PostMapping("/config")
    @Auditable(
            entityType = "HR_TAX_CONFIG",
            action = "UPDATE",
            entityIdExpr = "#result?.body",
            descriptionExpr = "'saved tax configuration for institute ' + #instituteId")
    public ResponseEntity<String> saveConfig(
            @RequestBody TaxConfigurationDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String id = taxConfigurationService.saveConfig(dto, instituteId);
        return ResponseEntity.ok(id);
    }

    @GetMapping("/config")
    public ResponseEntity<TaxConfigurationDTO> getConfig(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        TaxConfigurationDTO config = taxConfigurationService.getConfig(instituteId);
        return ResponseEntity.ok(config);
    }

    // ======================== Tax Declarations ========================

    @PostMapping("/declarations")
    public ResponseEntity<String> submitDeclaration(
            @RequestBody TaxDeclarationDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, dto.getEmployeeId());
        String id = taxDeclarationService.submitDeclaration(dto, employee);
        return ResponseEntity.ok(id);
    }

    @GetMapping("/declarations")
    public ResponseEntity<TaxDeclarationDTO> getDeclaration(
            @RequestParam("employeeId") String employeeId,
            @RequestParam("fy") String financialYear,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        TaxDeclarationDTO declaration = taxDeclarationService.getDeclaration(employeeId, financialYear);
        return ResponseEntity.ok(declaration);
    }

    @PutMapping("/declarations/{id}")
    public ResponseEntity<String> updateDeclaration(
            @PathVariable("id") String id,
            @RequestBody TaxDeclarationDTO dto,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Self-or-HR-staff check happens inside the service: the owning employee
        // is only known after the declaration is loaded by id.
        String resultId = taxDeclarationService.updateDeclaration(id, dto, instituteId, user);
        return ResponseEntity.ok(resultId);
    }

    @PutMapping("/declarations/{id}/verify")
    @Auditable(
            entityType = "HR_TAX_DECLARATION",
            action = "VERIFY",
            entityIdExpr = "#id",
            descriptionExpr = "'verified tax declaration ' + #id")
    public ResponseEntity<String> verifyDeclaration(
            @PathVariable("id") String id,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String resultId = taxDeclarationService.verifyDeclaration(id, instituteId, user.getUserId());
        return ResponseEntity.ok(resultId);
    }

    // ======================== Tax Computation ========================

    @GetMapping("/computation")
    public ResponseEntity<List<TaxComputationDTO>> getComputation(
            @RequestParam("employeeId") String employeeId,
            @RequestParam("fy") String financialYear,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        List<TaxComputationDTO> computations = taxComputationService.getComputation(employeeId, financialYear);
        return ResponseEntity.ok(computations);
    }
}
