package vacademy.io.admin_core_service.features.learner_reports.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchReportSettingConfig;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchSummaryReportDTO;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchSummaryReportRequest;
import vacademy.io.admin_core_service.features.learner_reports.service.BatchSummaryReportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * Learning Reports → Batch → Overview.
 *
 *   POST /summary   the basic report for a batch, or all batches when no batch is given
 *   POST /daily-time learning time per day for the same scope (newest 92 days of the window)
 *   POST /preview   the generated report as HTML, rendered with the institute's template
 *   POST /pdf       the same document as a PDF
 *   POST /send      email it to the batch's teachers, or each parent their own child's copy
 *   GET  /setting   the template sections with defaults applied
 *
 * The institute comes from the clientId header and is checked against the principal; a given
 * batch must belong to it. Viewing needs any staff role, sending needs an admin, since it
 * emails parents.
 */
@RestController
@RequestMapping("/admin-core-service/learner-management/batch-summary-report")
@RequiredArgsConstructor
public class BatchSummaryReportController {

    private final BatchSummaryReportService batchSummaryReportService;
    private final InstituteAccessValidator instituteAccessValidator;

    @PostMapping("/summary")
    public ResponseEntity<BatchSummaryReportDTO> summary(HttpServletRequest http,
                                                         @RequestBody BatchSummaryReportRequest request,
                                                         @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = staffInstitute(http, user);
        return ResponseEntity.ok(batchSummaryReportService.summarize(instituteId, request, user));
    }

    @PostMapping("/daily-time")
    public ResponseEntity<java.util.List<BatchSummaryReportDTO.DailyTimeRow>> dailyTime(HttpServletRequest http,
                                                                            @RequestBody BatchSummaryReportRequest request,
                                                                            @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = staffInstitute(http, user);
        return ResponseEntity.ok(batchSummaryReportService.dailyTime(instituteId, request));
    }

    @PostMapping("/preview")
    public ResponseEntity<Map<String, String>> preview(HttpServletRequest http,
                                                       @RequestBody BatchSummaryReportRequest request,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = staffInstitute(http, user);
        return ResponseEntity.ok(Map.of("html", batchSummaryReportService.renderHtml(instituteId, request, user)));
    }

    @PostMapping(value = "/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> pdf(HttpServletRequest http,
                                      @RequestBody BatchSummaryReportRequest request,
                                      @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = staffInstitute(http, user);
        byte[] pdf = batchSummaryReportService.renderPdf(instituteId, request, user);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"batch-report.pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    @PostMapping("/send")
    public ResponseEntity<BatchSummaryReportDTO.SendResult> send(HttpServletRequest http,
                                                                 @RequestBody BatchSummaryReportRequest request,
                                                                 @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = requireInstitute(http);
        instituteAccessValidator.requireAdminAccess(user, instituteId);
        return ResponseEntity.ok(batchSummaryReportService.send(instituteId, request, user));
    }

    @GetMapping("/setting")
    public ResponseEntity<Map<String, Object>> setting(HttpServletRequest http,
                                                       @RequestAttribute("user") CustomUserDetails user) {
        String instituteId = staffInstitute(http, user);
        BatchReportSettingConfig setting = batchSummaryReportService.loadSetting(instituteId);
        return ResponseEntity.ok(Map.of(
                "sections", setting.resolvedSections(),
                "all_sections", BatchReportSettingConfig.ALL_SECTIONS));
    }

    private String staffInstitute(HttpServletRequest http, CustomUserDetails user) {
        String instituteId = requireInstitute(http);
        instituteAccessValidator.requireStaffAccess(user, instituteId);
        return instituteId;
    }

    private static String requireInstitute(HttpServletRequest http) {
        String instituteId = http.getHeader("clientId");
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Missing clientId header");
        }
        return instituteId;
    }
}
