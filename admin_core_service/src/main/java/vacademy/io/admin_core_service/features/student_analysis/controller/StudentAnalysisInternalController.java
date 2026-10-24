package vacademy.io.admin_core_service.features.student_analysis.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.ComprehensiveStudentReport;
import vacademy.io.admin_core_service.features.student_analysis.service.StudentRawDetailService;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ComprehensiveReportAggregator;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ReportModule;

import java.time.LocalDate;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Internal (service-to-service) synchronous access to the Layer-1 comprehensive
 * student report — used by the Vacademy Assistant's get_student_360 tool.
 *
 * <p>Runs {@link ComprehensiveReportAggregator#collect} directly (deterministic
 * facts only, NO Layer-2 LLM narrative) with the caller's module selection, so an
 * excluded module's collector never executes. Guarded by {@code InternalAuthFilter}
 * (HMAC clientName/Signature) via the {@code /admin-core-service/internal/**}
 * matcher — never exposed to browsers.
 *
 * <p>The aggregator itself takes instituteId on trust, so this endpoint first
 * verifies the target user actually has an enrollment (ssigm row) in the given
 * institute and 404s otherwise — an assistant pinned to institute A can never
 * read a learner of institute B. The same lookup supplies the packageSessionId
 * fallback when no batchId is passed (mirrors the async processor's behaviour).
 */
@RestController
@RequestMapping("/admin-core-service/internal/student-analysis")
@RequiredArgsConstructor
@Slf4j
public class StudentAnalysisInternalController {

    private static final int MAX_RANGE_DAYS = 366;

    private final ComprehensiveReportAggregator comprehensiveReportAggregator;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final StudentRawDetailService rawDetailService;

    @GetMapping("/student-360")
    public ResponseEntity<ComprehensiveStudentReport> getStudent360(
            @RequestParam("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "batchId", required = false) String batchId,
            @RequestParam(value = "modules", required = false) String modulesCsv,
            @RequestParam(value = "startDate", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(value = "endDate", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {

        Optional<String> latestPackageSession = latestEnrolment(userId, instituteId);
        if (latestPackageSession.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        String effectiveBatchId = batchId != null ? batchId : latestPackageSession.get();
        LocalDate[] window = window(startDate, endDate);
        LocalDate effectiveStart = window[0];
        LocalDate effectiveEnd = window[1];

        Set<String> modules = ReportModule.resolveCsv(modulesCsv);
        log.info("student-360: user={} institute={} batch={} modules={} range={}..{}",
                userId, instituteId, effectiveBatchId, modules, effectiveStart, effectiveEnd);

        ComprehensiveStudentReport report = comprehensiveReportAggregator.collect(
                userId, instituteId, effectiveBatchId, effectiveStart, effectiveEnd, modules);
        return ResponseEntity.ok(report);
    }

    /**
     * The data the report collects and then discards (per-session attendance, per-module progress vs
     * the batch, slide-by-slide study, assignment submissions, doubt text, per-attempt analysis) for
     * the MCP {@code learner_report} tool, whose own AI app writes the report. No model runs here.
     * Same membership gate, batch fallback and window rules as {@link #getStudent360}.
     */
    @GetMapping("/raw-detail")
    public ResponseEntity<Map<String, Object>> getRawDetail(
            @RequestParam("userId") String userId,
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "batchId", required = false) String batchId,
            @RequestParam(value = "parts", required = false) String partsCsv,
            @RequestParam(value = "attemptLimit", required = false) Integer attemptLimit,
            @RequestParam(value = "startDate", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(value = "endDate", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {

        Optional<String> latestPackageSession = latestEnrolment(userId, instituteId);
        if (latestPackageSession.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        // A caller-named batch must be one of this learner's batches in this institute: module
        // progress reports the batch's averages, which must never come from another institute.
        if (batchId != null && mappingRepository
                .findByUserIdAndPackageSessionIdAndInstituteId(userId, batchId, instituteId).isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        String effectiveBatchId = batchId != null ? batchId : latestPackageSession.get();
        LocalDate[] window = window(startDate, endDate);
        Set<String> parts = StudentRawDetailService.resolveParts(
                partsCsv == null ? null : Arrays.asList(partsCsv.split(",")));
        log.info("raw-detail: user={} institute={} batch={} parts={} range={}..{}",
                userId, instituteId, effectiveBatchId, parts, window[0], window[1]);

        return ResponseEntity.ok(rawDetailService.collect(
                userId, instituteId, effectiveBatchId, window[0], window[1], parts, attemptLimit));
    }

    /** Membership gate + batch fallback in one lookup: empty when the user is not in this institute. */
    private Optional<String> latestEnrolment(String userId, String instituteId) {
        Optional<String> latest = mappingRepository.findLatestPackageSessionIdByUserIdAndInstituteId(userId, instituteId);
        if (latest.isEmpty()) {
            log.warn("student-analysis internal: user {} has no enrollment in institute {} — refusing", userId, instituteId);
        }
        return latest;
    }

    /** Default window: last 30 days; swaps an inverted range and clamps pathological ones. */
    private LocalDate[] window(LocalDate startDate, LocalDate endDate) {
        LocalDate effectiveEnd = endDate != null ? endDate : LocalDate.now();
        LocalDate effectiveStart = startDate != null ? startDate : effectiveEnd.minusDays(30);
        if (effectiveStart.isAfter(effectiveEnd)) {
            LocalDate tmp = effectiveStart;
            effectiveStart = effectiveEnd;
            effectiveEnd = tmp;
        }
        if (effectiveStart.isBefore(effectiveEnd.minusDays(MAX_RANGE_DAYS))) {
            effectiveStart = effectiveEnd.minusDays(MAX_RANGE_DAYS);
        }
        return new LocalDate[]{effectiveStart, effectiveEnd};
    }
}
