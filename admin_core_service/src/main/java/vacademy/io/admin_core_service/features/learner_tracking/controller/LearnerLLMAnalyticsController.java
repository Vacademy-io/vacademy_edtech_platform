package vacademy.io.admin_core_service.features.learner_tracking.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ProcessedActivityLogItem;
import vacademy.io.admin_core_service.features.learner_tracking.dto.ProcessedActivityLogsResponse;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;
import vacademy.io.admin_core_service.features.learner_tracking.repository.LearnerInsightSummaryProjection;
import vacademy.io.admin_core_service.features.slide.entity.Slide;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.learner_tracking.service.ActivityLogProcessorService;
import vacademy.io.admin_core_service.features.learner_tracking.service.LLMActivityAnalyticsService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Client APIs: For frontend/testing use
 * Internal APIs: For microservice communication
 */
@Slf4j
@RestController
@RequestMapping("/admin-core-service/llm-analytics")
@RequiredArgsConstructor
@Tag(name = "LLM Analytics", description = "APIs for managing LLM-based student analytics")
public class LearnerLLMAnalyticsController {

        private final ActivityLogProcessorService activityLogProcessorService;
        private final ActivityLogRepository activityLogRepository;
        private final LLMActivityAnalyticsService llmActivityAnalyticsService;
        private final SlideRepository slideRepository;

        // ==================== CLIENT/FRONTEND APIs ====================

        @GetMapping("/processed-logs")
        @Operation(summary = "Get processed activity logs for a user by slideId or sourceId", description = "Fetches all processed activity logs for a user. Either slideId or sourceId must be provided.")
        public ResponseEntity<?> getProcessedLogs(
                        @RequestParam("userId") String userId,
                        @RequestParam(value = "slideId", required = false) String slideId,
                        @RequestParam(value = "sourceId", required = false) String sourceId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[LLM-Analytics-API] Fetching processed logs for user: {}, slideId: {}, sourceId: {}",
                                userId, slideId, sourceId);

                try {
                        // Validate that at least one identifier is provided
                        if ((slideId == null || slideId.isEmpty()) && (sourceId == null || sourceId.isEmpty())) {
                                return ResponseEntity.badRequest().body(Map.of(
                                                "status", "error",
                                                "message", "Either slideId or sourceId must be provided"));
                        }

                        List<ActivityLog> activityLogs;

                        // Fetch by slide_id or source_id
                        if (slideId != null && !slideId.isEmpty()) {
                                activityLogs = activityLogRepository.findByUserIdAndSlideIdAndStatusProcessed(userId,
                                                slideId);
                        } else {
                                activityLogs = activityLogRepository.findByUserIdAndSourceIdAndStatusProcessed(userId,
                                                sourceId);
                        }

                        // Convert to response DTOs
                        List<ProcessedActivityLogItem> items = activityLogs.stream()
                                        .map(log -> ProcessedActivityLogItem.builder()
                                                        .id(log.getId())
                                                        .userId(log.getUserId())
                                                        .slideId(log.getSlideId())
                                                        .sourceId(log.getSourceId())
                                                        .sourceType(log.getSourceType())
                                                        .status(log.getStatus())
                                                        .processedJson(log.getProcessedJson())
                                                        .createdAt(log.getCreatedAt() != null
                                                                        ? log.getCreatedAt().toLocalDateTime()
                                                                        : null)
                                                        .updatedAt(log.getUpdatedAt() != null
                                                                        ? log.getUpdatedAt().toLocalDateTime()
                                                                        : null)
                                                        .build())
                                        .collect(Collectors.toList());

                        ProcessedActivityLogsResponse response = ProcessedActivityLogsResponse.builder()
                                        .activityLogs(items)
                                        .count(items.size())
                                        .build();

                        log.info("[LLM-Analytics-API] Found {} processed logs for user: {}", items.size(), userId);
                        return ResponseEntity.ok(response);

                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error fetching processed logs for user: {}", userId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to fetch processed logs: " + e.getMessage()));
                }
        }

        @GetMapping("/my/insights")
        @Operation(summary = "List the signed-in learner's own AI insight reports", description = "Paged, newest first, for the Activity Insights list in My Reports. Returns summaries only — titles and dates, never the analysis body. Identity comes from the token, so a learner can only ever list their own.")
        public ResponseEntity<?> getMyInsights(
                        @RequestParam(value = "page", defaultValue = "0") int page,
                        @RequestParam(value = "size", defaultValue = "20") int size,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                String userId = userDetails.getUserId();
                try {
                        Page<LearnerInsightSummaryProjection> result = activityLogRepository
                                        .findInsightSummariesForLearner(userId,
                                                        PageRequest.of(Math.max(0, page), Math.min(Math.max(1, size), 50)));

                        List<Map<String, Object>> items = result.getContent().stream()
                                        .map(row -> {
                                                Map<String, Object> item = new LinkedHashMap<>();
                                                item.put("id", row.getId());
                                                item.put("source_type", row.getSourceType());
                                                item.put("slide_id", row.getSlideId());
                                                item.put("source_id", row.getSourceId());
                                                item.put("title", row.getTitle());
                                                item.put("created_at", row.getCreatedAt() != null
                                                                ? row.getCreatedAt().toLocalDateTime().toString()
                                                                : null);
                                                return item;
                                        })
                                        .collect(Collectors.toList());

                        Map<String, Object> response = new LinkedHashMap<>();
                        response.put("insights", items);
                        response.put("page", result.getNumber());
                        response.put("total_pages", result.getTotalPages());
                        response.put("total_elements", result.getTotalElements());
                        return ResponseEntity.ok(response);

                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error listing insights for user: {}", userId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to list insights"));
                }
        }

        @GetMapping("/my/insights/{activityLogId}")
        @Operation(summary = "Read one of the signed-in learner's own AI insight reports", description = "Returns the analysis body for a single report. Ownership is checked against the token, so a learner cannot read another learner's report by guessing an id.")
        public ResponseEntity<?> getMyInsight(
                        @PathVariable String activityLogId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                String userId = userDetails.getUserId();
                try {
                        ActivityLog activityLog = activityLogRepository.findById(activityLogId).orElse(null);

                        // Same 404 for "does not exist" and "belongs to someone else" — a
                        // different response for the second would confirm the id is real.
                        if (activityLog == null || !userId.equals(activityLog.getUserId())) {
                                return ResponseEntity.status(404).body(Map.of(
                                                "status", "error",
                                                "message", "Report not found"));
                        }
                        if (!"processed".equalsIgnoreCase(activityLog.getStatus())) {
                                // 'failed' rows hold an error marker rather than a report; 'raw'
                                // ones have not been analysed yet. Neither is something to render.
                                return ResponseEntity.status(404).body(Map.of(
                                                "status", "error",
                                                "message", "Report not ready"));
                        }

                        Map<String, Object> response = new LinkedHashMap<>();
                        response.put("id", activityLog.getId());
                        response.put("source_type", activityLog.getSourceType());
                        response.put("slide_id", activityLog.getSlideId());
                        response.put("source_id", activityLog.getSourceId());
                        // Title so a deep link renders the activity's real name rather than a
                        // generic label; null when the slide has since been deleted.
                        response.put("title", activityLog.getSlideId() == null ? null
                                        : slideRepository.findById(activityLog.getSlideId())
                                                        .map(Slide::getTitle)
                                                        .orElse(null));
                        response.put("processed_json", activityLog.getProcessedJson());
                        response.put("created_at", activityLog.getCreatedAt() != null
                                        ? activityLog.getCreatedAt().toLocalDateTime().toString()
                                        : null);
                        return ResponseEntity.ok(response);

                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error reading insight {} for user {}", activityLogId, userId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to read report"));
                }
        }

        @PostMapping("/process-on-demand")
        @Operation(summary = "Process the AI report for a single source on demand", description = "Synchronously runs LLM processing for the latest raw/failed activity log of the given user + source (assessment) and returns the processed result. Lets a learner generate the report immediately instead of waiting for the hourly scheduler.")
        public ResponseEntity<?> processOnDemand(
                        @RequestParam("userId") String userId,
                        @RequestParam("sourceId") String sourceId,
                        @RequestAttribute("user") CustomUserDetails userDetails) {

                log.info("[LLM-Analytics-API] On-demand processing requested for user: {}, sourceId: {}",
                                userId, sourceId);

                if (sourceId == null || sourceId.isEmpty()) {
                        return ResponseEntity.badRequest().body(Map.of(
                                        "status", "error",
                                        "message", "sourceId must be provided"));
                }

                try {
                        ActivityLog activityLog = activityLogProcessorService.processOnDemand(userId, sourceId);

                        if (activityLog == null) {
                                // No submission data captured for this user + source yet — nothing to process.
                                return ResponseEntity.ok(ProcessedActivityLogsResponse.builder()
                                                .activityLogs(List.of())
                                                .count(0)
                                                .build());
                        }

                        ProcessedActivityLogItem item = ProcessedActivityLogItem.builder()
                                        .id(activityLog.getId())
                                        .userId(activityLog.getUserId())
                                        .slideId(activityLog.getSlideId())
                                        .sourceId(activityLog.getSourceId())
                                        .sourceType(activityLog.getSourceType())
                                        .status(activityLog.getStatus())
                                        .processedJson(activityLog.getProcessedJson())
                                        .createdAt(activityLog.getCreatedAt() != null
                                                        ? activityLog.getCreatedAt().toLocalDateTime()
                                                        : null)
                                        .updatedAt(activityLog.getUpdatedAt() != null
                                                        ? activityLog.getUpdatedAt().toLocalDateTime()
                                                        : null)
                                        .build();

                        // Only surface successfully-processed rows to the client; a 'failed' row
                        // carries an error JSON, not a report, so return an empty result for it.
                        boolean processed = "processed".equalsIgnoreCase(activityLog.getStatus());
                        ProcessedActivityLogsResponse response = ProcessedActivityLogsResponse.builder()
                                        .activityLogs(processed ? List.of(item) : List.of())
                                        .count(processed ? 1 : 0)
                                        .build();

                        return ResponseEntity.ok(response);

                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error during on-demand processing for user: {}, sourceId: {}",
                                        userId, sourceId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to process report: " + e.getMessage()));
                }
        }

        // ==================== BACKEND/TESTING APIs ====================

        @PostMapping("/process-all")
        @Operation(summary = "Manually trigger processing of all raw activity logs")
        public ResponseEntity<Map<String, String>> processAllRawLogs() {
                log.info("[LLM-Analytics-API] Manual processing triggered");

                try {
                        activityLogProcessorService.processAllRawLogsManually();
                        return ResponseEntity.ok(Map.of(
                                        "status", "success",
                                        "message", "Processing started for all raw activity logs"));
                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error in manual processing", e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to process logs: " + e.getMessage()));
                }
        }

        @PostMapping("/reprocess/{activityLogId}")
        @Operation(summary = "Manually reprocess a specific activity log by ID")
        public ResponseEntity<Map<String, String>> reprocessActivityLog(@PathVariable String activityLogId) {
                log.info("[LLM-Analytics-API] Manual reprocess triggered for activity log ID: {}", activityLogId);

                try {
                        activityLogProcessorService.reprocessActivityLog(activityLogId);
                        return ResponseEntity.ok(Map.of(
                                        "status", "success",
                                        "message", "Activity log reprocessing started",
                                        "activityLogId", activityLogId.toString()));
                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error reprocessing activity log {}", activityLogId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to reprocess log: " + e.getMessage()));
                }
        }

        @GetMapping("/health")
        @Operation(summary = "Health check for LLM analytics service")
        public ResponseEntity<Map<String, String>> health() {
                return ResponseEntity.ok(Map.of(
                                "status", "healthy",
                                "message", "LLM Analytics service is running"));
        }

        @GetMapping("/scheduler/status")
        @Operation(summary = "Check scheduler status and get last run info")
        public ResponseEntity<Map<String, Object>> getSchedulerStatus() {
                return ResponseEntity.ok(activityLogProcessorService.getSchedulerStatus());
        }

        @PostMapping("/scheduler/trigger")
        @Operation(summary = "Manually trigger the scheduler job (for testing)")
        public ResponseEntity<Map<String, String>> triggerScheduler() {
                log.info("[LLM-Analytics-API] Manually triggering scheduler job");
                try {
                        activityLogProcessorService.processRawActivityLogs();
                        return ResponseEntity.ok(Map.of(
                                        "status", "success",
                                        "message", "Scheduler job triggered successfully"));
                } catch (Exception e) {
                        log.error("[LLM-Analytics-API] Error triggering scheduler", e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", "Failed to trigger scheduler: " + e.getMessage()));
                }
        }

        // ==================== INTERNAL/MICROSERVICE APIs ====================

        @GetMapping("/internal/processed-logs")
        @Operation(summary = "Internal: Get processed logs (HMAC auth, no JWT)")
        public ResponseEntity<?> getProcessedLogsInternal(
                        @RequestParam("userId") String userId,
                        @RequestParam(value = "sourceId", required = false) String sourceId) {
                try {
                        if (sourceId == null || sourceId.isEmpty()) {
                                return ResponseEntity.badRequest().body(Map.of("status", "error", "message", "sourceId required"));
                        }
                        List<ActivityLog> activityLogs = activityLogRepository.findByUserIdAndSourceIdAndStatusProcessed(userId, sourceId);
                        List<ProcessedActivityLogItem> items = activityLogs.stream()
                                        .map(al -> ProcessedActivityLogItem.builder()
                                                        .id(al.getId())
                                                        .userId(al.getUserId())
                                                        .slideId(al.getSlideId())
                                                        .sourceId(al.getSourceId())
                                                        .sourceType(al.getSourceType())
                                                        .status(al.getStatus())
                                                        .processedJson(al.getProcessedJson())
                                                        .createdAt(al.getCreatedAt() != null ? al.getCreatedAt().toLocalDateTime() : null)
                                                        .updatedAt(al.getUpdatedAt() != null ? al.getUpdatedAt().toLocalDateTime() : null)
                                                        .build())
                                        .toList();
                        return ResponseEntity.ok(new ProcessedActivityLogsResponse(items, items.size()));
                } catch (Exception e) {
                        return ResponseEntity.internalServerError().body(Map.of("status", "error", "message", e.getMessage()));
                }
        }

        /**
         * Every learner's processed analysis for one assessment, in one call.
         *
         * <p>Exists so assessment_service can build a CLASS-level AI report by
         * aggregating analyses that already exist, instead of spending a fresh
         * LLM call (and the institute's credits) per assessment. One row per
         * learner — their latest.
         *
         * <p>Deliberately returns only {@code user_id} + {@code processed_json}:
         * the caller aggregates and never needs the rest, and the payload for a
         * 600-learner assessment is large enough already.
         */
        @GetMapping("/internal/processed-logs/by-source")
        @Operation(summary = "Internal: every learner's processed analysis for one source (HMAC auth, no JWT)")
        public ResponseEntity<Map<String, Object>> getProcessedLogsBySource(
                        @RequestParam("sourceId") String sourceId) {
                if (sourceId == null || sourceId.isBlank()) {
                        return ResponseEntity.badRequest().body(Map.of(
                                        "status", "error",
                                        "message", "sourceId is required"));
                }
                try {
                        List<ActivityLog> logs = activityLogRepository.findProcessedBySourceId(sourceId);
                        List<Map<String, Object>> items = logs.stream()
                                        .map(a -> {
                                                Map<String, Object> row = new LinkedHashMap<>();
                                                row.put("user_id", a.getUserId());
                                                row.put("processed_json", a.getProcessedJson());
                                                return row;
                                        })
                                        .collect(Collectors.toList());
                        Map<String, Object> body = new LinkedHashMap<>();
                        body.put("source_id", sourceId);
                        body.put("count", items.size());
                        body.put("analyses", items);
                        return ResponseEntity.ok(body);
                } catch (Exception e) {
                        log.error("[LLM-Analytics-Internal] Failed to read analyses for source {}", sourceId, e);
                        return ResponseEntity.internalServerError().body(Map.of(
                                        "status", "error",
                                        "message", e.getMessage()));
                }
        }

        /**
         * Internal (HMAC, no JWT) sibling of {@link #processOnDemand}.
         *
         * <p>Exists for the admin-side "Download AI Report" action in
         * assessment_service: the teacher's copy of the report has to be generatable
         * on the spot rather than waiting for the hourly scheduler, and
         * assessment_service talks to admin_core over HMAC, so it cannot reach the
         * JWT-bound {@code /process-on-demand} above.
         *
         * <p>Unlike the client endpoint, this one reports the row's <b>real</b> status
         * instead of hiding a non-processed row behind an empty list. The caller needs
         * to tell an admin "this institute is out of AI credits"
         * ({@code skipped_no_credits}) apart from "the model call failed"
         * ({@code failed}) and "this learner never submitted" ({@code not_found}).
         */
        @PostMapping("/internal/process-on-demand")
        @Operation(summary = "Internal: generate the AI report for one user + source on demand (HMAC auth, no JWT)")
        public ResponseEntity<Map<String, Object>> processOnDemandInternal(
                        @RequestParam("userId") String userId,
                        @RequestParam("sourceId") String sourceId) {

                if (userId == null || userId.isBlank() || sourceId == null || sourceId.isBlank()) {
                        return ResponseEntity.badRequest().body(Map.of(
                                        "status", "error",
                                        "message", "userId and sourceId are required"));
                }

                log.info("[LLM-Analytics-Internal] On-demand processing requested for user: {}, sourceId: {}",
                                userId, sourceId);

                try {
                        ActivityLog activityLog = activityLogProcessorService.processOnDemand(userId, sourceId);

                        if (activityLog == null) {
                                Map<String, Object> body = new LinkedHashMap<>();
                                body.put("status", "not_found");
                                body.put("processed_json", null);
                                return ResponseEntity.ok(body);
                        }

                        Map<String, Object> body = new LinkedHashMap<>();
                        body.put("status", activityLog.getStatus());
                        body.put("activity_log_id", activityLog.getId());
                        body.put("processed_json",
                                        "processed".equalsIgnoreCase(activityLog.getStatus())
                                                        ? activityLog.getProcessedJson()
                                                        : null);
                        return ResponseEntity.ok(body);

                } catch (Exception e) {
                        log.error("[LLM-Analytics-Internal] On-demand processing failed for user: {}, sourceId: {}",
                                        userId, sourceId, e);
                        Map<String, Object> body = new LinkedHashMap<>();
                        body.put("status", "error");
                        body.put("message", e.getMessage());
                        return ResponseEntity.internalServerError().body(body);
                }
        }

        /**
         * Receive assessment submission data from assessment_service
         * This is called when a student submits an assessment
         * 
         * @param assessmentData The assessment attempt data with all answers and
         *                       results
         * @return Success response
         */
        @PostMapping("/assessment")
        @Operation(summary = "Internal API: Save assessment data from assessment_service", description = "HMAC authenticated endpoint for microservice communication")
        public ResponseEntity<Map<String, Object>> saveAssessmentData(@RequestBody Map<String, Object> assessmentData) {
                try {
                        llmActivityAnalyticsService.saveAssessmentRawDataFromExternal(assessmentData);

                        return ResponseEntity.ok(Map.of(
                                        "success", true,
                                        "message", "Assessment data saved for LLM analysis"));

                } catch (Exception e) {
                        log.error("Error processing assessment data", e);
                        return ResponseEntity.status(500).body(Map.of(
                                        "success", false,
                                        "message", "Error saving assessment data: " + e.getMessage()));
                }
        }
}
