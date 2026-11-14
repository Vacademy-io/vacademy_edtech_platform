package vacademy.io.admin_core_service.features.hr_compliance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_compliance.dto.BonusComputationReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.BonusMaterializationResultDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.GratuityProvisionReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.service.GratuityProvisionService;
import vacademy.io.admin_core_service.features.hr_compliance.service.StatutoryBonusService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/**
 * India payroll provisions (Phase D): gratuity provision report (Payment of
 * Gratuity Act, 1972) and statutory bonus computation/materialization
 * (Payment of Bonus Act, 1965). Reports are HR-staff; materialization is
 * HR-admin and audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance")
public class ProvisionController {

    @Autowired
    private GratuityProvisionService gratuityProvisionService;

    @Autowired
    private StatutoryBonusService statutoryBonusService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @GetMapping("/gratuity-provision")
    public ResponseEntity<GratuityProvisionReportDTO> getGratuityProvision(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "asOfDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOfDate,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(gratuityProvisionService.buildReport(instituteId, asOfDate));
    }

    @GetMapping("/gratuity-provision/download")
    public ResponseEntity<byte[]> downloadGratuityProvision(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "asOfDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOfDate,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        LocalDate asOf = asOfDate != null ? asOfDate : LocalDate.now();
        String csv = gratuityProvisionService.buildReportCsv(instituteId, asOf);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"gratuity-provision-" + asOf + ".csv\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/bonus-computation")
    public ResponseEntity<BonusComputationReportDTO> getBonusComputation(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("financialYear") String financialYear,
            @RequestParam(value = "bonusPct", required = false, defaultValue = "8.33") BigDecimal bonusPct,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(statutoryBonusService.computeBonus(instituteId, financialYear, bonusPct));
    }

    @PostMapping("/bonus-computation/materialize")
    @Auditable(entityType = "HR_BONUS", action = "MATERIALIZE",
            entityIdExpr = "#financialYear",
            descriptionExpr = "'Statutory bonus FY ' + #financialYear + ' materialized for payout ' + #month + '/' + #year")
    public ResponseEntity<BonusMaterializationResultDTO> materializeBonus(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("financialYear") String financialYear,
            @RequestParam(value = "bonusPct", required = false, defaultValue = "8.33") BigDecimal bonusPct,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(statutoryBonusService.materialize(
                instituteId, financialYear, bonusPct, month, year, user));
    }
}
