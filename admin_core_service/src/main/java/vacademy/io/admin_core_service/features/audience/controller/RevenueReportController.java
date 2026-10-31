package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.dto.reports.AdmissionReportDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.CohortAnalysisReportDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.RevenueForecastDTO;
import vacademy.io.admin_core_service.features.audience.dto.reports.RevenueReportDTO;
import vacademy.io.admin_core_service.features.audience.service.AdmissionReportService;
import vacademy.io.admin_core_service.features.audience.service.RevenueReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Money reports for the Reports Center (Revenue, Cohort, Forecast tabs). Sibling of
 * {@link PipelineReportController} — same base path, same param conventions (fromDate/toDate as
 * yyyy-MM-dd in the institute timezone, both optional defaulting to the last 30 days) and the same
 * RBAC scoping via ReportScopeResolver. Revenue counts only PAID payments from converted leads.
 */
@RestController
@RequestMapping("/admin-core-service/v1/reports")
@RequiredArgsConstructor
public class RevenueReportController {

    private final RevenueReportService revenueReportService;
    private final AdmissionReportService admissionReportService;

    /** Admissions in the range with fees / paid / due, by month, source, course, counsellor and field. */
    @GetMapping("/admissions")
    public ResponseEntity<AdmissionReportDTO> getAdmissions(
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String teamId,
            @RequestParam(required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(admissionReportService.getAdmissions(
                instituteId, fromDate, toDate, teamId, counsellorUserId, user.getUserId()));
    }

    /** Course tags and custom fields offered by the Admissions report settings. */
    @GetMapping("/admissions/options")
    public ResponseEntity<AdmissionReportDTO.Options> getAdmissionOptions(
            @RequestParam String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(admissionReportService.getOptions(instituteId));
    }

    /** Collected revenue from converted leads, split by source / counsellor / day. */
    @GetMapping("/revenue")
    public ResponseEntity<RevenueReportDTO> getRevenue(
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String teamId,
            @RequestParam(required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(revenueReportService.getRevenue(
                instituteId, fromDate, toDate, teamId, counsellorUserId, user.getUserId()));
    }

    /** Lead acquisition cohorts (by month) and how each matured into conversions + revenue. */
    @GetMapping("/cohort-analysis")
    public ResponseEntity<CohortAnalysisReportDTO> getCohortAnalysis(
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String teamId,
            @RequestParam(required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(revenueReportService.getCohortAnalysis(
                instituteId, fromDate, toDate, teamId, counsellorUserId, user.getUserId()));
    }

    /**
     * Projected revenue for the next 30/60/90 days (run-rate + pipeline-weighted). fromDate/toDate
     * are accepted for signature consistency but intentionally ignored — the forecast always uses a
     * fixed trailing history window.
     */
    @GetMapping("/revenue-forecast")
    public ResponseEntity<RevenueForecastDTO> getRevenueForecast(
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String teamId,
            @RequestParam(required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(revenueReportService.getForecast(
                instituteId, teamId, counsellorUserId, user.getUserId()));
    }
}
