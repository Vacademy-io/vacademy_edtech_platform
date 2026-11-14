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
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsExportResponseDTO;
import vacademy.io.admin_core_service.features.hr_compliance.dto.WpsFileDTO;
import vacademy.io.admin_core_service.features.hr_compliance.service.WpsExportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

/**
 * Gulf WPS salary-file exports (Phase E): UAE MOHRE SIF and Saudi
 * (Mudad-style) files, format resolved from the institute's Gulf tax
 * configuration (countryCode ARE/UAE → UAE_SIF, SAU/KSA → SAUDI_WPS) with an
 * optional {@code format} override. HR admin only — the file bulk-exposes
 * IBANs and statutory person ids, so downloads are audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance/wps")
public class WpsController {

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private WpsExportService wpsExportService;

    /** JSON preview: rows + skipped (with reasons) + warnings + totals. */
    @GetMapping
    public ResponseEntity<WpsExportResponseDTO> getWpsExport(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestParam(value = "format", required = false) String format,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        return ResponseEntity.ok(wpsExportService.buildExport(instituteId, month, year, format));
    }

    /** The salary file itself (UAE .sif as text/plain, Saudi .csv as text/csv). */
    @GetMapping("/download")
    @Auditable(entityType = "HR_WPS", action = "DOWNLOAD",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<String> downloadWpsFile(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") int month,
            @RequestParam("year") int year,
            @RequestParam(value = "format", required = false) String format,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        validateMonthYear(month, year);
        WpsExportResponseDTO response = wpsExportService.buildExport(instituteId, month, year, format);
        WpsFileDTO file = wpsExportService.buildFile(response);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(file.getMediaType()));
        headers.set(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"" + file.getFilename() + "\"");
        return ResponseEntity.ok().headers(headers).body(file.getContent());
    }

    private static void validateMonthYear(int month, int year) {
        if (month < 1 || month > 12) {
            throw new VacademyException("month must be between 1 and 12");
        }
        if (year < 2000 || year > 2100) {
            throw new VacademyException("year must be between 2000 and 2100");
        }
    }
}
