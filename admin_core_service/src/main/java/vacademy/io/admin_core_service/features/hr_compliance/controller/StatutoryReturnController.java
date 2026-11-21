package vacademy.io.admin_core_service.features.hr_compliance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_compliance.dto.EsiReturnResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PfEcrResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.PtReturnResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.service.EsiReturnService;
import vacademy.io.admin_core_service.features.hr_compliance.service.PfEcrService;
import vacademy.io.admin_core_service.features.hr_compliance.service.PtReturnService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Statutory-scheme filings (Phase D): PF ECR, ESI monthly return, PT monthly
 * return. HR-admin only — these expose bulk statutory identifiers (UAN, ESI
 * IP numbers), so downloads are audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance")
public class StatutoryReturnController {

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private PfEcrService pfEcrService;

    @Autowired
    private EsiReturnService esiReturnService;

    @Autowired
    private PtReturnService ptReturnService;

    // ------------------------------------------------------------------ PF ECR

    @GetMapping("/pf-ecr")
    public ResponseEntity<PfEcrResponseDTO> getPfEcr(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        return ResponseEntity.ok(pfEcrService.buildReturn(instituteId, month, year));
    }

    @GetMapping("/pf-ecr/download")
    @Auditable(entityType = "HR_PF_ECR", action = "DOWNLOAD",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<String> downloadPfEcr(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        PfEcrResponseDTO response = pfEcrService.buildReturn(instituteId, month, year);
        String file = pfEcrService.buildEcrFile(response);
        return textDownload(file, MediaType.TEXT_PLAIN,
                "ecr_" + month + "_" + year + ".txt");
    }

    // -------------------------------------------------------------- ESI return

    @GetMapping("/esi-return")
    public ResponseEntity<EsiReturnResponseDTO> getEsiReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        return ResponseEntity.ok(esiReturnService.buildReturn(instituteId, month, year));
    }

    @GetMapping("/esi-return/download")
    @Auditable(entityType = "HR_ESI_RETURN", action = "DOWNLOAD",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<String> downloadEsiReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        EsiReturnResponseDTO response = esiReturnService.buildReturn(instituteId, month, year);
        String file = esiReturnService.buildCsv(response);
        return textDownload(file, new MediaType("text", "csv"),
                "esi_return_" + month + "_" + year + ".csv");
    }

    // --------------------------------------------------------------- PT return

    @GetMapping("/pt-return")
    public ResponseEntity<PtReturnResponseDTO> getPtReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        return ResponseEntity.ok(ptReturnService.buildReturn(instituteId, month, year));
    }

    @GetMapping("/pt-return/download")
    @Auditable(entityType = "HR_PT_RETURN", action = "DOWNLOAD",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<String> downloadPtReturn(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        PtReturnResponseDTO response = ptReturnService.buildReturn(instituteId, month, year);
        String file = ptReturnService.buildCsv(response);
        return textDownload(file, new MediaType("text", "csv"),
                "pt_return_" + month + "_" + year + ".csv");
    }

    // ------------------------------------------------------------------ shared

    private static void validateMonthYear(int month, int year) {
        if (month < 1 || month > 12) {
            throw new VacademyException("month must be between 1 and 12");
        }
        if (year < 2000 || year > 2100) {
            throw new VacademyException("year must be between 2000 and 2100");
        }
    }

    private static ResponseEntity<String> textDownload(String body, MediaType mediaType, String filename) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(mediaType);
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"");
        return ResponseEntity.ok().headers(headers).body(body);
    }
}
