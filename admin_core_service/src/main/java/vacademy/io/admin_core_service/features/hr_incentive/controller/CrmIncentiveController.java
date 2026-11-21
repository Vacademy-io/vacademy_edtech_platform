package vacademy.io.admin_core_service.features.hr_incentive.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.hr_incentive.dto.IncentiveMaterializeResultDTO;
import vacademy.io.admin_core_service.features.hr_incentive.dto.IncentivePreviewDTO;
import vacademy.io.admin_core_service.features.hr_incentive.service.CrmIncentiveService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;

/**
 * CRM incentives → payroll (Phase F3): preview per-counsellor sales incentives computed
 * from collected revenue (canonical attribution reproduced from the Reports Center's
 * RevenueReportService), then materialize them as CRM_INCENTIVE payroll adjustments
 * consumed by the REGULAR run of the payout period.
 *
 * <p>Earning window = calendar month in Asia/Kolkata, converted to UTC half-open bounds.
 * Preview is HR staff; materialization is HR admin and audited.
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/hr/incentives")
public class CrmIncentiveController {

    @Autowired
    private CrmIncentiveService crmIncentiveService;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @GetMapping("/preview")
    public ResponseEntity<IncentivePreviewDTO> preview(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestParam(value = "commissionPct", required = false) BigDecimal commissionPct,
            @RequestParam(value = "fixedPerConversion", required = false) BigDecimal fixedPerConversion,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrStaff(user, instituteId);
        return ResponseEntity.ok(crmIncentiveService.preview(
                instituteId, month, year, commissionPct, fixedPerConversion));
    }

    @PostMapping("/materialize")
    @Auditable(entityType = "HR_INCENTIVE", action = "MATERIALIZE",
            descriptionExpr = "'CRM incentives ' + #month + '/' + #year + ' -> payout '"
                    + " + #payoutMonth + '/' + #payoutYear + ': created '"
                    + " + #result?.body?.createdCount + ', total ' + #result?.body?.totalAmount")
    public ResponseEntity<IncentiveMaterializeResultDTO> materialize(
            @RequestParam("instituteId") String instituteId,
            @RequestParam("month") Integer month,
            @RequestParam("year") Integer year,
            @RequestParam(value = "commissionPct", required = false) BigDecimal commissionPct,
            @RequestParam(value = "fixedPerConversion", required = false) BigDecimal fixedPerConversion,
            @RequestParam("payoutMonth") Integer payoutMonth,
            @RequestParam("payoutYear") Integer payoutYear,
            @RequestAttribute("user") CustomUserDetails user) {
        hrAccessGuard.requireHrAdmin(user, instituteId);
        return ResponseEntity.ok(crmIncentiveService.materialize(
                instituteId, month, year, commissionPct, fixedPerConversion,
                payoutMonth, payoutYear, user));
    }
}
