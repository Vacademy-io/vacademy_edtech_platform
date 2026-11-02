package vacademy.io.assessment_service.features.learner_assessment.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.BatchAssessmentHistoryRequest;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.BatchAssessmentHistoryResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.CohortAssessmentRequest;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.CohortAssessmentResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.internal.StudentAssessmentHistoryResponse;
import vacademy.io.assessment_service.features.learner_assessment.service.StudentAnalysisInternalService;

import java.util.Date;

/**
 * Internal (service-to-service) endpoint for the Complete Student Report feature.
 *
 * <p><b>Security:</b> mapped under {@code /assessment-service/internal/**}, which is guarded by
 * {@code InternalAuthFilter} (common_service) — requests must carry {@code clientName} and
 * {@code Signature} HMAC headers, identical to the pattern used by
 * {@code /admin-core-service/llm-analytics/internal/**}.  No JWT required.
 *
 * <p><b>Isolation contract (§13.4):</b>
 * <ul>
 *   <li>Read-only. No writes.
 *   <li>Does not modify any existing endpoint, DTO, entity, or migration.
 *   <li>Called at most once per report generation job, asynchronously from admin_core_service.
 * </ul>
 */
@Slf4j
@RestController
@RequestMapping("/assessment-service/internal/student-analysis")
public class StudentAnalysisInternalController {

    @Autowired
    private StudentAnalysisInternalService studentAnalysisInternalService;

    /**
     * Returns a student's assessment history enriched with per-attempt comparison data.
     *
     * <p>Query parameters:
     * <ul>
     *   <li>{@code userId}      — required; learner's UUID
     *   <li>{@code instituteId} — required; institute UUID
     *   <li>{@code startDate}   — optional; ISO-8601 date (yyyy-MM-dd); inclusive lower bound
     *   <li>{@code endDate}     — optional; ISO-8601 date (yyyy-MM-dd); inclusive upper bound
     * </ul>
     *
     * <p>At most {@value StudentAnalysisInternalService#MAX_ASSESSMENTS_PER_REPORT} assessments
     * (most recent first) are returned; a WARN is logged when the result set is truncated.
     */
    @GetMapping("/assessment-history")
    public ResponseEntity<StudentAssessmentHistoryResponse> getAssessmentHistory(
            @RequestParam(name = "userId") String userId,
            @RequestParam(name = "instituteId") String instituteId,
            @RequestParam(name = "startDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) Date startDate,
            @RequestParam(name = "endDate", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) Date endDate) {

        log.info("internal/student-analysis/assessment-history: userId={} instituteId={} " +
                 "startDate={} endDate={}", userId, instituteId, startDate, endDate);

        StudentAssessmentHistoryResponse response =
                studentAnalysisInternalService.fetchAssessmentHistory(userId, instituteId, startDate, endDate);

        return ResponseEntity.ok(response);
    }

    /**
     * BATCHED sibling of {@link #getAssessmentHistory}: per-user assessment summaries for a
     * cohort of up to 500 users in ONE call (avoids an N+1 across services).  Consumed by the
     * Engagement Engine in admin_core_service.
     *
     * <p>Request body: {@code {"instituteId": "...", "userIds": ["..."], "sinceDays": 90}} —
     * instituteId and userIds required (max 500, larger → 400), sinceDays optional (default 90).
     *
     * <p>Response: {@code {"byUserId": {"<userId>": {attemptCount, lastAttemptAt, avgPercentage,
     * lastAssessmentName}}}} — an entry exists ONLY for userIds with at least one ENDED attempt
     * in the window; absence means "no data".
     */
    @PostMapping("/assessment-history/batch")
    public ResponseEntity<BatchAssessmentHistoryResponse> getAssessmentHistoryBatch(
            @RequestBody BatchAssessmentHistoryRequest request) {

        log.info("internal/student-analysis/assessment-history/batch: instituteId={} userIds={} sinceDays={}",
                 request != null ? request.getInstituteId() : null,
                 request != null && request.getUserIds() != null ? request.getUserIds().size() : 0,
                 request != null ? request.getSinceDays() : null);

        BatchAssessmentHistoryResponse response =
                studentAnalysisInternalService.fetchAssessmentHistoryBatch(request);

        return ResponseEntity.ok(response);
    }

    /**
     * Cohort attempts for the admin batch report: body with instituteId, userIds (max 500),
     * startDate and endDate (yyyy-MM-dd). Returns the latest ENDED attempt per learner and
     * assessment in the window.
     */
    @PostMapping("/assessment-history/cohort")
    public ResponseEntity<CohortAssessmentResponse> getCohortAttempts(@RequestBody CohortAssessmentRequest request) {
        return ResponseEntity.ok(studentAnalysisInternalService.fetchCohortAttempts(request));
    }
}
