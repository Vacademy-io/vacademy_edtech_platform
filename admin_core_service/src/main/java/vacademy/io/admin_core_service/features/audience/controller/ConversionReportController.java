package vacademy.io.admin_core_service.features.audience.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.audience.dto.reports.ConversionReportDTO;
import vacademy.io.admin_core_service.features.audience.service.ConversionReportService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Conversions report for the Reports Center (Conversions tab). Sibling of
 * {@link RevenueReportController} — same base path, same param conventions (fromDate/toDate as
 * yyyy-MM-dd in the institute timezone, both optional defaulting to the last 30 days) and the same
 * RBAC scoping via ReportScopeResolver. A conversion is an enrolment into a course that counts as
 * one, dated by the enrolment.
 */
@RestController
@RequestMapping("/admin-core-service/v1/reports")
@RequiredArgsConstructor
public class ConversionReportController {

    private final ConversionReportService conversionReportService;

    /** Leads enrolled into a converting course in the window: totals, per counsellor, lead rows. */
    @GetMapping("/conversions")
    public ResponseEntity<ConversionReportDTO> getConversions(
            @RequestParam String instituteId,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate,
            @RequestParam(required = false) String teamId,
            @RequestParam(required = false) String counsellorUserId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(conversionReportService.getConversions(
                instituteId, fromDate, toDate, teamId, counsellorUserId, user.getUserId()));
    }
}
