package vacademy.io.admin_core_service.features.hr_compliance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form16DataDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.Form24QResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.service.Form16Service;
import vacademy.io.admin_core_service.features.hr_compliance.service.Form24QService;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.nio.charset.StandardCharsets;

/**
 * TDS filings (Phase D): Form 16 Part B per employee, Form 24Q quarterly
 * return data. Institute is ALWAYS the validated query param — never read from
 * anywhere else. Form 16 is self-or-HR (an employee may fetch their own);
 * Form 24Q is HR-admin only (bulk unmasked PANs).
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance")
public class TdsFilingController {

    @Autowired
    private Form16Service form16Service;

    @Autowired
    private Form24QService form24QService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    // ------------------------------------------------------------- Form 16

    @GetMapping("/form16")
    public ResponseEntity<Form16DataDTO> getForm16(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("employeeId") String employeeId,
            @RequestParam("financialYear") String financialYear,
            @RequestAttribute("user") CustomUserDetails user) {
        validateFinancialYear(financialYear);
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        return ResponseEntity.ok(form16Service.buildForm16(employee, instituteId, financialYear));
    }

    @GetMapping("/form16/download")
    @Auditable(entityType = "HR_FORM16", action = "DOWNLOAD", entityIdExpr = "#employeeId",
            descriptionExpr = "'Form 16 Part B PDF for employee ' + #employeeId + ' FY ' + #financialYear")
    public ResponseEntity<byte[]> downloadForm16(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("employeeId") String employeeId,
            @RequestParam("financialYear") String financialYear,
            @RequestAttribute("user") CustomUserDetails user) {
        validateFinancialYear(financialYear);
        EmployeeProfile employee = hrAccessGuard.requireSelfOrHrStaff(user, instituteId, employeeId);
        Form16DataDTO data = form16Service.buildForm16(employee, instituteId, financialYear);
        byte[] pdf = form16Service.renderForm16Pdf(data);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDispositionFormData("attachment",
                "form16_partB_" + safe(data.getEmployeeCode(), employeeId) + "_" + financialYear + ".pdf");
        return new ResponseEntity<>(pdf, headers, HttpStatus.OK);
    }

    // ------------------------------------------------------------- Form 24Q

    @GetMapping("/24q")
    public ResponseEntity<Form24QResponseDTO> getForm24Q(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("financialYear") String financialYear,
            @RequestParam("quarter") String quarter,
            @RequestAttribute("user") CustomUserDetails user) {
        validateFinancialYear(financialYear);
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(form24QService.buildForm24Q(instituteId, financialYear, quarter));
    }

    @GetMapping("/24q/download")
    @Auditable(entityType = "HR_FORM24Q", action = "DOWNLOAD", entityIdExpr = "#instituteId",
            descriptionExpr = "'Form 24Q CSV for FY ' + #financialYear + ' ' + #quarter")
    public ResponseEntity<byte[]> downloadForm24Q(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("financialYear") String financialYear,
            @RequestParam("quarter") String quarter,
            @RequestAttribute("user") CustomUserDetails user) {
        validateFinancialYear(financialYear);
        hrAccessGuard.requireHrAdmin(user, instituteId);
        Form24QResponseDTO data = form24QService.buildForm24Q(instituteId, financialYear, quarter);
        byte[] csv = form24QService.toCsv(data).getBytes(StandardCharsets.UTF_8);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
        headers.setContentDispositionFormData("attachment",
                "form24q_" + financialYear + "_" + data.getQuarter() + ".csv");
        return new ResponseEntity<>(csv, headers, HttpStatus.OK);
    }

    // --------------------------------------------------------------- helpers

    private static void validateFinancialYear(String financialYear) {
        if (financialYear == null || !financialYear.matches("\\d{4}-\\d{2}")) {
            throw new VacademyException("financialYear must look like 2025-26");
        }
    }

    private static String safe(String preferred, String fallback) {
        String v = (preferred != null && !preferred.isBlank()) ? preferred : fallback;
        return v.replaceAll("[^A-Za-z0-9_-]", "_");
    }
}
