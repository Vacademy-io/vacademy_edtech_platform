package vacademy.io.admin_core_service.features.erp_finance.controller;

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
import vacademy.io.admin_core_service.features.erp_finance.dto.PnlSnapshotDTO;
import vacademy.io.admin_core_service.features.erp_finance.service.FinanceReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.nio.charset.StandardCharsets;

/**
 * Department-cost-vs-revenue finance report (Phase F4b): a monthly P&L
 * snapshot pairing collected fee revenue (canonical cash-in ledger query)
 * against payroll employer cost by department, plus journal-presence and
 * currency sanity signals. Read-only — the journal itself is written by
 * source modules (see JournalController / JournalService).
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/erp/finance")
public class FinanceReportController {

    @Autowired
    private FinanceReportService financeReportService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @GetMapping("/pnl-snapshot")
    public ResponseEntity<PnlSnapshotDTO> getPnlSnapshot(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(financeReportService.buildSnapshot(instituteId, month, year));
    }

    @GetMapping("/pnl-snapshot/download")
    @Auditable(entityType = "ERP_FINANCE_PNL", action = "DOWNLOAD",
            entityIdExpr = "#instituteId + ':' + #year + '-' + #month")
    public ResponseEntity<byte[]> downloadPnlSnapshot(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        String csv = financeReportService.buildSnapshotCsv(instituteId, month, year);
        byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=pnl_snapshot_" + month + "_" + year + ".csv")
                .contentType(MediaType.parseMediaType("text/csv"))
                .body(bytes);
    }
}
