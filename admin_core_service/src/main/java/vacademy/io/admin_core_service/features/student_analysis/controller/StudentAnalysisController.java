package vacademy.io.admin_core_service.features.student_analysis.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.student_analysis.dto.*;
import vacademy.io.admin_core_service.features.student_analysis.entity.StudentAnalysisProcess;
import vacademy.io.admin_core_service.features.student_analysis.repository.StudentAnalysisProcessRepository;
import vacademy.io.admin_core_service.features.student_analysis.service.StudentAnalysisProcessorService;
import vacademy.io.admin_core_service.features.student_analysis.service.StudentReportPdfService;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ReportModule;
import vacademy.io.admin_core_service.features.student_analysis.dto.UserLinkedDataUpdateRequest;
import vacademy.io.admin_core_service.features.student_analysis.entity.UserLinkedData;
import vacademy.io.admin_core_service.features.student_analysis.repository.UserLinkedDataRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.ComprehensiveStudentReport;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Controller for student analysis report generation
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/v1/student-analysis")
@RequiredArgsConstructor
@Tag(name = "Student Analysis", description = "APIs for generating comprehensive student analysis reports")
public class StudentAnalysisController {

        private final StudentAnalysisProcessRepository processRepository;
        private final StudentAnalysisProcessorService processorService;
        private final ObjectMapper objectMapper;
        private final UserLinkedDataRepository userLinkedDataRepository;
        private final StudentReportPdfService reportPdfService;
        private final vacademy.io.admin_core_service.core.security.GuardianAccessGuard guardianAccessGuard;
        private final vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository studentRepository;

        @PostMapping("/initiate")
        @Auditable(
                        entityType = "STUDENT_REPORT",
                        action = "GENERATE",
                        conditionExpr = "#result?.body?.processId != null",
                        entityIdExpr = "#result?.body?.processId",
                        descriptionExpr = "'generated progress report for ' + (#result?.body?.learnerName ?: #request.userId)"
                                        + " + ' (' + #request.startDateIso + ' to ' + #request.endDateIso + ')'")
        @Operation(summary = "Initiate student analysis report generation", description = "Starts async processing of student analysis. Returns a process ID to check status later.")
        public ResponseEntity<StudentAnalysisInitiateResponse> initiateAnalysis(
                        @RequestBody StudentAnalysisRequest request,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[Student-Analysis-API] Initiating analysis for user: {}, institute: {}, dates: {} to {}",
                                request.getUserId(), request.getInstituteId(),
                                request.getStartDateIso(), request.getEndDateIso());

                try {
                        // Reject an inverted/invalid window BEFORE any work starts. Every collector feeds
                        // these dates straight into `meeting_date BETWEEN :start AND :end`; when start > end
                        // that predicate is unsatisfiable, so every module finds zero rows and the report
                        // silently publishes 0% attendance / 0% progress / "At Risk" for a learner whose
                        // real numbers are fine. Fail loudly instead of producing a confidently wrong report.
                        String dateError = validateWindow(request.getStartDateIso(), request.getEndDateIso());
                        if (dateError != null) {
                                log.warn("[Student-Analysis-API] Rejecting initiate for user {}: {}",
                                                request.getUserId(), dateError);
                                return ResponseEntity.badRequest()
                                                .body(StudentAnalysisInitiateResponse.builder()
                                                                .status("ERROR")
                                                                .message(dateError)
                                                                .build());
                        }

                        // Create process record
                        StudentAnalysisProcess process = new StudentAnalysisProcess(
                                        request.getUserId(),
                                        request.getInstituteId(),
                                        request.getStartDateIso(),
                                        request.getEndDateIso());

                        // v2 extension fields (all nullable — backwards compatible)
                        String version = request.getReportVersion() != null ? request.getReportVersion() : "v1";
                        process.setReportVersion(version);
                        if (request.getBatchId() != null) process.setBatchId(request.getBatchId());
                        if (request.getPackageSessionId() != null) process.setPackageSessionId(request.getPackageSessionId());

                        // v2: persist the resolved set of modules to include (null/empty → all).
                        // Only the selected modules will be queried during processing.
                        if ("v2".equalsIgnoreCase(version)) {
                                process.setIncludedModules(
                                                ReportModule.toCsv(ReportModule.resolve(request.getIncludeModules())));
                        }

                        // Report name: admin-given, or auto-generated from the date range when blank.
                        String reportName = (request.getName() != null && !request.getName().isBlank())
                                        ? request.getName().trim()
                                        : "Report: " + request.getStartDateIso() + " to " + request.getEndDateIso();
                        process.setName(reportName);

                        // Email opt-out: default ON unless explicitly false. (Push + in-app alert always fire on completion.)
                        process.setSendEmail(request.getSendEmail() == null ? Boolean.TRUE : request.getSendEmail());

                        process = processRepository.save(process);

                        // Start async processing; the admin's id rides along so every AI credit charge
                        // for this report is attributed to them.
                        processorService.processStudentAnalysis(process.getId(), userDetails.getUserId());

                        return ResponseEntity.ok(StudentAnalysisInitiateResponse.builder()
                                        .processId(process.getId())
                                        .status("PENDING")
                                        .message("Student analysis processing initiated successfully")
                                        // For the admin activity log description ("… for Anmol Agarwal").
                                        .learnerName(learnerNameOf(request.getUserId()))
                                        .build());

                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error initiating analysis", e);
                        return ResponseEntity.internalServerError()
                                        .body(StudentAnalysisInitiateResponse.builder()
                                                        .status("ERROR")
                                                        .message("Failed to initiate analysis: " + e.getMessage())
                                                        .build());
                }
        }

        /** Best-effort learner name for the audit description — never fails the initiate call. */
        private String learnerNameOf(String userId) {
                try {
                        return studentRepository.findByUserId(userId).stream()
                                        .map(student -> student.getFullName())
                                        .filter(n -> n != null && !n.isBlank())
                                        .findFirst().orElse(null);
                } catch (Exception e) {
                        log.warn("[Student-Analysis-API] Could not resolve learner name for {}: {}", userId, e.getMessage());
                        return null;
                }
        }

        /**
         * Validates the report window. Returns null when valid, else a human-readable reason.
         * Both dates are required and must parse as ISO yyyy-MM-dd, and start must not be after end.
         */
        private String validateWindow(java.time.LocalDate start, java.time.LocalDate end) {
                if (start == null || end == null) {
                        return "Both start_date_iso and end_date_iso are required (ISO yyyy-MM-dd).";
                }
                if (start.isAfter(end)) {
                        return "start_date_iso (" + start + ") is after end_date_iso (" + end
                                        + "). The report window is empty — no data can be collected for it.";
                }
                return null;
        }

        @GetMapping("/report/{processId}")
        @Operation(summary = "Get student analysis report", description = "Retrieves the status and report data for a process ID")
        public ResponseEntity<StudentAnalysisReportResponse> getReport(
                        @PathVariable String processId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[Student-Analysis-API] Fetching report for process ID: {}", processId);

                try {
                        StudentAnalysisProcess process = processRepository.findById(processId)
                                        .orElse(null);
                        if (process == null || !canAccess(process, userDetails)) {
                                return ResponseEntity.notFound().build();
                        }

                        return ResponseEntity.ok(toReportResponse(process));

                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error fetching report for process ID: {}", processId, e);
                        return ResponseEntity.internalServerError()
                                        .body(StudentAnalysisReportResponse.builder()
                                                        .processId(processId)
                                                        .status("ERROR")
                                                        .errorMessage("Failed to fetch report: " + e.getMessage())
                                                        .build());
                }
        }

        @GetMapping("/reports/user/{userId}")
        @Operation(summary = "Get all completed reports for a user", description = "Retrieves paginated list of all completed analysis reports for a specific user")
        public ResponseEntity<StudentAnalysisReportListResponse> getCompletedReportsForUser(
                        @PathVariable String userId,
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "10") int size,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[Student-Analysis-API] Fetching completed reports for user: {}, page: {}, size: {}", userId,
                                page, size);

                // Staff may list any learner's reports; a learner may only list their own.
                if (!userId.equals(userDetails.getUserId())
                                && !hasAnyRole(userDetails, "ADMIN", "TEACHER", "EVALUATOR", "COURSE_CREATOR", "ADMIN_NON_ROOT")) {
                        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
                }

                try {
                        Pageable pageable = PageRequest.of(page, size);
                        Page<StudentAnalysisProcess> processPage = processRepository
                                        .findByUserIdAndStatusOrderByCreatedAtDesc(userId, "COMPLETED", pageable);

                        List<StudentAnalysisReportListItem> reports = processPage.getContent().stream()
                                        .map(this::toListItem)
                                        .collect(Collectors.toList());

                        StudentAnalysisReportListResponse response = StudentAnalysisReportListResponse.builder()
                                        .reports(reports)
                                        .currentPage(processPage.getNumber())
                                        .totalPages(processPage.getTotalPages())
                                        .totalElements(processPage.getTotalElements())
                                        .pageSize(processPage.getSize())
                                        .build();

                        log.info("[Student-Analysis-API] Found {} completed reports for user: {}", reports.size(),
                                        userId);
                        return ResponseEntity.ok(response);

                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error fetching reports for user: {}", userId, e);
                        return ResponseEntity.internalServerError()
                                        .body(StudentAnalysisReportListResponse.builder()
                                                        .reports(List.of())
                                                        .currentPage(page)
                                                        .totalPages(0)
                                                        .totalElements(0L)
                                                        .pageSize(size)
                                                        .build());
                }
        }

        @GetMapping("/user-linked-data/{userId}")
        @Operation(summary = "Get all strengths and weaknesses for a user", description = "Retrieves all user linked data (strengths and weaknesses) for the specified user.")
        public ResponseEntity<List<UserLinkedData>> getUserLinkedData(@PathVariable String userId) {
                log.info("[Student-Analysis-API] Fetching user linked data for user: {}", userId);
                try {
                        List<UserLinkedData> data = userLinkedDataRepository.findByUserId(userId);
                        return ResponseEntity.ok(data);
                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error fetching user linked data for user: {}", userId, e);
                        return ResponseEntity.internalServerError().build();
                }
        }

        @PutMapping("/user-linked-data/{userId}")
        @Operation(summary = "Update user linked data", description = "Add, update, or delete user linked data entries for strengths and weaknesses.")
        public ResponseEntity<String> updateUserLinkedData(@PathVariable String userId,
                        @RequestBody List<UserLinkedDataUpdateRequest> updates) {
                log.info("[Student-Analysis-API] Updating user linked data for user: {}", userId);
                try {
                        for (UserLinkedDataUpdateRequest update : updates) {
                                if ("delete".equals(update.getAction())) {
                                        userLinkedDataRepository.deleteById(update.getId());
                                } else if ("add".equals(update.getAction())) {
                                        UserLinkedData data = new UserLinkedData(userId, update.getType(),
                                                        update.getData(), update.getPercentage());
                                        userLinkedDataRepository.save(data);
                                } else if ("update".equals(update.getAction())) {
                                        UserLinkedData existing = userLinkedDataRepository.findById(update.getId())
                                                        .orElse(null);
                                        if (existing != null) {
                                                if (update.getData() != null && !update.getData().isEmpty()) {
                                                        existing.setData(update.getData());
                                                }
                                                if (update.getPercentage() != null) {
                                                        existing.setPercentage(update.getPercentage());
                                                }
                                                userLinkedDataRepository.save(existing);
                                        }
                                }
                        }
                        return ResponseEntity.ok("Updated successfully");
                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error updating user linked data for user: {}", userId, e);
                        return ResponseEntity.internalServerError().body("Update failed");
                }
        }

        // ── Phase-4: PDF, Share, and Public-read endpoints ─────────────────────

        /**
         * GET /admin-core-service/v1/student-analysis/report/{processId}/pdf  (JWT required)
         *
         * <p>Renders the report (v2 comprehensive or v1 legacy) to a PDF and returns
         * {@code application/pdf} bytes.  Also persists the rendered file via media_service
         * and stores its id in {@code student_analysis_process.pdf_file_id} (skip re-render
         * if already present and resolvable).
         */
        @GetMapping(value = "/report/{processId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
        @Operation(summary = "Download student report as PDF",
                   description = "Renders the report to PDF. Persists and caches the file in media_service.")
        public ResponseEntity<byte[]> getReportAsPdf(
                        @PathVariable String processId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[Student-Analysis-API] PDF requested for processId={}", processId);
                try {
                        StudentAnalysisProcess process = processRepository.findById(processId)
                                        .orElse(null);
                        if (process == null || !canAccess(process, userDetails)) {
                                return ResponseEntity.notFound().build();
                        }
                        if (!"COMPLETED".equals(process.getStatus())) {
                                return ResponseEntity.status(HttpStatus.ACCEPTED)
                                        .header("X-Report-Status", process.getStatus())
                                        .build();
                        }

                        byte[] pdfBytes = reportPdfService.getOrRenderPdf(process);

                        HttpHeaders headers = new HttpHeaders();
                        headers.setContentType(MediaType.APPLICATION_PDF);
                        headers.setContentDispositionFormData("attachment",
                                "student_report_" + processId + ".pdf");
                        headers.setContentLength(pdfBytes.length);

                        return ResponseEntity.ok().headers(headers).body(pdfBytes);

                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error generating PDF for processId={}", processId, e);
                        return ResponseEntity.internalServerError().build();
                }
        }

        // ── Learner-facing endpoints (logged-in student reads their OWN reports via JWT) ──

        /**
         * GET /admin-core-service/v1/student-analysis/my/reports  (JWT)
         *
         * <p>Lists the COMPLETED reports of the logged-in learner. The userId is taken from the JWT,
         * so a learner can only ever see their own reports — no token or share link required.
         */
        @GetMapping("/my/reports")
        @Operation(summary = "List my reports",
                   description = "Completed reports for the logged-in learner (userId resolved from the JWT).")
        public ResponseEntity<StudentAnalysisReportListResponse> getMyReports(
                        @RequestParam(defaultValue = "0") int page,
                        @RequestParam(defaultValue = "10") int size,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                String userId = userDetails.getUserId();
                log.info("[Student-Analysis-API] Fetching MY reports for learner: {}", userId);
                try {
                        Pageable pageable = PageRequest.of(page, size);
                        Page<StudentAnalysisProcess> processPage = processRepository
                                        .findByUserIdAndStatusOrderByCreatedAtDesc(userId, "COMPLETED", pageable);

                        List<StudentAnalysisReportListItem> reports = processPage.getContent().stream()
                                        .map(this::toListItem)
                                        .collect(Collectors.toList());

                        return ResponseEntity.ok(StudentAnalysisReportListResponse.builder()
                                        .reports(reports)
                                        .currentPage(processPage.getNumber())
                                        .totalPages(processPage.getTotalPages())
                                        .totalElements(processPage.getTotalElements())
                                        .pageSize(processPage.getSize())
                                        .build());
                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error fetching my reports for user: {}", userId, e);
                        return ResponseEntity.internalServerError()
                                        .body(StudentAnalysisReportListResponse.builder()
                                                        .reports(List.of()).currentPage(page).totalPages(0)
                                                        .totalElements(0L).pageSize(size).build());
                }
        }

        /**
         * GET /admin-core-service/v1/student-analysis/my/report/{processId}  (JWT)
         *
         * <p>Returns a single report ONLY if it belongs to the logged-in learner (ownership check).
         * If the report isn't theirs (or doesn't exist) → 404, so other users' reports stay hidden.
         */
        @GetMapping("/my/report/{processId}")
        @Operation(summary = "Get my report",
                   description = "Single report for the logged-in learner; 404 if it does not belong to them.")
        public ResponseEntity<StudentAnalysisReportResponse> getMyReport(
                        @PathVariable String processId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                String userId = userDetails.getUserId();
                log.info("[Student-Analysis-API] Fetching MY report {} for learner {}", processId, userId);
                try {
                        StudentAnalysisProcess process = processRepository.findById(processId).orElse(null);
                        if (process == null || !userId.equals(process.getUserId())) {
                                return ResponseEntity.notFound().build();
                        }
                        return ResponseEntity.ok(toReportResponse(process));
                } catch (Exception e) {
                        log.error("[Student-Analysis-API] Error fetching my report {}: {}", processId, e.getMessage());
                        return ResponseEntity.internalServerError()
                                        .body(StudentAnalysisReportResponse.builder()
                                                        .processId(processId).status("ERROR")
                                                        .errorMessage("Failed to fetch report").build());
                }
        }

        // ── shared mapping helpers (used by admin + learner endpoints) ──────────

        /**
         * Access check for admin endpoints: allow the report's owner OR any user
         * whose userId matches the report's userId (self-access).
         * Access is granted to the owning learner OR to staff (ADMIN/TEACHER/EVALUATOR/COURSE_CREATOR).
         * CustomUserDetails does not expose instituteId, but its authorities are already scoped to the
         * caller's institute at token-issue time, so a staff role is the correct admin signal here.
         */
        private boolean canAccess(StudentAnalysisProcess p, CustomUserDetails u) {
                if (u == null) return false;
                if (u.getUserId() != null && u.getUserId().equals(p.getUserId())) {
                        return true; // owner (learner viewing their own)
                }
                if (hasAnyRole(u, "ADMIN", "TEACHER", "EVALUATOR", "COURSE_CREATOR", "ADMIN_NON_ROOT")) {
                        return true; // staff
                }
                // Guardian link leg: a parent may read a report whose subject is their
                // OWN linked child — resolved authoritatively (auth_service), fail-closed.
                // NOT a blanket PARENT role check (that would expose any child to any parent).
                return guardianAccessGuard.isLinkedChild(u, p.getUserId());
        }

        /** True if the user holds any of the given role/authority names (case-insensitive). */
        private boolean hasAnyRole(CustomUserDetails u, String... roles) {
                if (u.getAuthorities() == null) return false;
                return u.getAuthorities().stream()
                                .map(a -> a.getAuthority())
                                .anyMatch(authority -> {
                                        for (String role : roles) {
                                                if (role.equalsIgnoreCase(authority)) return true;
                                        }
                                        return false;
                                });
        }

        /** Maps a process row to a list item (v1 report embedded when deserializable; v2 → metadata only). */
        private StudentAnalysisReportListItem toListItem(StudentAnalysisProcess process) {
                StudentAnalysisReportListItem.StudentAnalysisReportListItemBuilder builder = StudentAnalysisReportListItem
                                .builder()
                                .processId(process.getId())
                                .name(process.getName())
                                .userId(process.getUserId())
                                .instituteId(process.getInstituteId())
                                .startDateIso(process.getStartDateIso())
                                .endDateIso(process.getEndDateIso())
                                .status(process.getStatus())
                                .reportVersion(process.getReportVersion())
                                .createdAt(process.getCreatedAt().toInstant()
                                                .atZone(ZoneId.systemDefault()).toLocalDateTime())
                                .updatedAt(process.getUpdatedAt().toInstant()
                                                .atZone(ZoneId.systemDefault()).toLocalDateTime());
                // Only attempt v1 deserialization for non-v2 reports to avoid spurious warnings
                if (process.getReportJson() != null && !"v2".equalsIgnoreCase(process.getReportVersion())) {
                        try {
                                builder.report(objectMapper.readValue(process.getReportJson(), StudentReportData.class));
                        } catch (Exception e) {
                                log.warn("[Student-Analysis-API] Could not embed v1 report for process {}: {}",
                                                process.getId(), e.getMessage());
                        }
                }
                return builder.build();
        }

        /** Builds the full report response (v1 → StudentReportData, v2 → ComprehensiveStudentReport). */
        private StudentAnalysisReportResponse toReportResponse(StudentAnalysisProcess process) throws Exception {
                StudentAnalysisReportResponse.StudentAnalysisReportResponseBuilder responseBuilder =
                                StudentAnalysisReportResponse.builder()
                                                .processId(process.getId())
                                                .name(process.getName())
                                                .status(process.getStatus())
                                                .errorMessage(process.getErrorMessage());
                if ("COMPLETED".equals(process.getStatus()) && process.getReportJson() != null) {
                        if ("v2".equalsIgnoreCase(process.getReportVersion())) {
                                responseBuilder.reportVersion("v2");
                                responseBuilder.comprehensiveReport(
                                                objectMapper.readValue(process.getReportJson(), ComprehensiveStudentReport.class));
                        } else {
                                responseBuilder.report(
                                                objectMapper.readValue(process.getReportJson(), StudentReportData.class));
                        }
                }
                return responseBuilder.build();
        }
}
