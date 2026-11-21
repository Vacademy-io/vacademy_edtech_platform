package vacademy.io.admin_core_service.features.hr_compliance.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
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
import vacademy.io.admin_core_service.features.hr_compliance.dto.EosbProvisionReportDTO;
import vacademy.io.admin_core_service.features.hr_compliance.service.EosbProvisionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/**
 * Gulf payroll provisions (Phase E): end-of-service benefit (EOSB) provision
 * report for UAE (Federal Decree-Law 33/2021 art. 51) and Saudi Arabia (Labor
 * Law art. 84) institutes — the Gulf sibling of {@link ProvisionController}'s
 * gratuity report. HR-staff; the CSV export is audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/compliance")
public class GulfProvisionController {

    @Autowired
    private EosbProvisionService eosbProvisionService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @GetMapping("/eosb-provision")
    public ResponseEntity<EosbProvisionReportDTO> getEosbProvision(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "asOfDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOfDate,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(eosbProvisionService.buildReport(instituteId, asOfDate));
    }

    @GetMapping("/eosb-provision/download")
    @Auditable(entityType = "HR_EOSB_PROVISION", action = "DOWNLOAD",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'EOSB provision CSV exported as of ' + (#asOfDate != null ? #asOfDate : 'today')")
    public ResponseEntity<byte[]> downloadEosbProvision(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "asOfDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOfDate,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        LocalDate asOf = asOfDate != null ? asOfDate : LocalDate.now();
        String csv = eosbProvisionService.buildReportCsv(instituteId, asOf);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"eosb-provision-" + asOf + ".csv\"")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }
}
