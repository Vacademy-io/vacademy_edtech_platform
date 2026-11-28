package vacademy.io.admin_core_service.features.learner_tracking.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.credits.client.AuthorizeResult;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.learner_tracking.entity.ActivityLog;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogProcessingProjection;
import vacademy.io.admin_core_service.features.learner_tracking.repository.ActivityLogRepository;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Service to process raw activity logs with LLM and generate insights
 * Runs on scheduled basis to process entries with status='raw' and 'failed'
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ActivityLogProcessorService {

        private final ActivityLogRepository activityLogRepository;
        private final StudentAnalyticsLLMService studentAnalyticsLLMService;
        private final ObjectMapper objectMapper;
        private final CreditClient creditClient;
        private final ActivityLogQueueClaimService activityLogQueueClaimService;

        private static final int BATCH_SIZE = 10;
        private static final int ENTRIES_PER_RUN = 20;
        private static final String STATUS_RAW = "raw";
        private static final String STATUS_PROCESSED = "processed";
        private static final String STATUS_FAILED = "failed";

        /** In-flight status held while a replica works a claimed log. */
        private static final String STATUS_PROCESSING = "processing";

        /**
         * How many times a single log may be attempted before it is left alone. Without a
         * bound, the scheduler's `status IN ('raw','failed')` selection resurrected
         * permanently-broken logs every hour indefinitely.
         */
        private static final int MAX_PROCESSING_ATTEMPTS = 3;

        /**
         * A claim older than this is assumed to belong to a replica that died mid-batch and
         * is handed back. Comfortably longer than the worst-case batch: BATCH_SIZE logs x
         * the LLM response timeout.
         */
        private static final int STALE_CLAIM_MINUTES = 30;

        /**
         * Terminal-for-now status for logs belonging to an institute with no credit. They
         * are deliberately NOT left as 'raw': the scheduler takes the oldest entries
         * first, so an unpaid institute would otherwise sit at the head of the queue and
         * starve paying ones. Re-queue with
         * {@code UPDATE activity_log SET status='raw' WHERE status='skipped_no_credits'}
         * after a top-up.
         */
        private static final String STATUS_SKIPPED_NO_CREDITS = "skipped_no_credits";

        /**
         * Terminal-for-now status for logs an institute's AI usage limit (ai_service
         * {@code institute_ai_limits_policy} in ENFORCE) refused. Not left 'raw' for the same
         * queue-starvation reason as {@link #STATUS_SKIPPED_NO_CREDITS}. Re-queue with
         * {@code UPDATE activity_log SET status='raw' WHERE status='skipped_usage_limit'}
         * after the limit is raised or the window resets.
         */
        static final String STATUS_SKIPPED_USAGE_LIMIT = "skipped_usage_limit";

        /** ai_use_case_catalog key the limit gate is asked about. */
        static final String USE_CASE_LEARNER_ANALYTICS = "learner_analytics";

        /** Rough chars-per-token ratio, used only to size the pre-flight credit check. */
        private static final int CHARS_PER_TOKEN_ESTIMATE = 4;

        /** Mirrors StudentAnalyticsLLMService.MAX_COMPLETION_TOKENS for the estimate. */
        private static final int ESTIMATED_COMPLETION_TOKENS = 2000;

        // Scheduler tracking
        private final AtomicReference<LocalDateTime> lastRunTime = new AtomicReference<>();
        private final AtomicReference<LocalDateTime> nextRunTime = new AtomicReference<>();
        private final AtomicInteger totalProcessedCount = new AtomicInteger(0);
        private final AtomicInteger totalFailedCount = new AtomicInteger(0);
        /** Logs skipped because a usage limit refused them (logged per run when non-zero). */
        private final AtomicInteger totalSkippedByLimitCount = new AtomicInteger(0);

        /**
         * Scheduled job that runs every hour to process raw activity logs
         * Cron: 0 0 * * * * = every hour at minute 0
         */
        @Scheduled(cron = "0 0 * * * *")
        public void processRawActivityLogs() {
                LocalDateTime startTime = LocalDateTime.now();
                lastRunTime.set(startTime);
                nextRunTime.set(startTime.plusHours(1));

                log.info("[LLM-Analytics-Scheduler] ===== SCHEDULER RUN STARTED at {} =====", startTime);

                try {
                        // Hand back anything a dead replica left in flight before claiming more.
                        activityLogQueueClaimService.releaseStaleClaims(STALE_CLAIM_MINUTES);

                        // Claim rather than select: this job runs on all four admin-core replicas,
                        // and an unclaimed select had every replica calling the LLM on the same
                        // oldest-20 logs - a 4x multiplier on spend for identical work.
                        List<ActivityLogProcessingProjection> rawLogs = activityLogQueueClaimService.claimBatch(
                                        Arrays.asList(STATUS_RAW, STATUS_FAILED),
                                        MAX_PROCESSING_ATTEMPTS,
                                        ENTRIES_PER_RUN,
                                        STATUS_PROCESSING);

                        if (rawLogs.isEmpty()) {
                                log.info("[LLM-Analytics-Scheduler] No activity logs claimed - queue empty "
                                                + "or another replica took them");
                                return;
                        }

                        log.info("[LLM-Analytics-Scheduler] Found {} raw activity logs to process", rawLogs.size());

                        int processedInRun = 0;
                        int failedInRun = 0;
                        int skippedByLimitBefore = totalSkippedByLimitCount.get();

                        // Process in batches to avoid overwhelming the system
                        for (int i = 0; i < rawLogs.size(); i += BATCH_SIZE) {
                                int end = Math.min(i + BATCH_SIZE, rawLogs.size());
                                List<ActivityLogProcessingProjection> batch = rawLogs.subList(i, end);

                                log.info("[LLM-Analytics-Scheduler] Processing batch {}/{}", (i / BATCH_SIZE) + 1,
                                                (rawLogs.size() + BATCH_SIZE - 1) / BATCH_SIZE);

                                int[] results = processBatch(batch);
                                processedInRun += results[0];
                                failedInRun += results[1];
                        }

                        totalProcessedCount.addAndGet(processedInRun);
                        totalFailedCount.addAndGet(failedInRun);
                        int skippedByLimitInRun = totalSkippedByLimitCount.get() - skippedByLimitBefore;
                        if (skippedByLimitInRun > 0) {
                                log.info("[LLM-Analytics-Scheduler] {} activity log(s) skipped by AI usage limits "
                                                + "this run (status {})", skippedByLimitInRun,
                                                STATUS_SKIPPED_USAGE_LIMIT);
                        }

                        log.info("[LLM-Analytics-Scheduler] ===== SCHEDULER RUN COMPLETED ===== " +
                                        "Processed: {}, Failed: {}, Duration: {}s",
                                        processedInRun, failedInRun,
                                        java.time.Duration.between(startTime, LocalDateTime.now()).getSeconds());

                } catch (Exception e) {
                        log.error("[LLM-Analytics-Scheduler] Error in scheduled processing", e);
                }
        }

        private int[] processBatch(List<ActivityLogProcessingProjection> batch) {
                int processed = 0;
                int failed = 0;
                for (ActivityLogProcessingProjection activityLog : batch) {
                        try {
                                processActivityLog(activityLog);
                                processed++;
                        } catch (Exception e) {
                                log.error("[LLM-Analytics-Processing] Error processing activity log ID: {}",
                                                activityLog.getId(), e);
                                markAsFailed(activityLog.getId(), e.getMessage());
                                failed++;
                        }
                }
                return new int[] { processed, failed };
        }

        /**
         * Process a single activity log.
         * LLM call happens OUTSIDE any transaction to avoid holding DB connections
         * during the long HTTP request.
         */
        public void processActivityLog(ActivityLogProcessingProjection activityLog) {
                int rawJsonLength = activityLog.getRawJson() != null ? activityLog.getRawJson().length() : 0;
                log.info("[LLM-Analytics-Processing] Processing activity log ID: {}, Type: {}, RawJsonBytes: {}",
                                activityLog.getId(), activityLog.getSourceType(), rawJsonLength);

                if (activityLog.getRawJson() == null || activityLog.getRawJson().isEmpty()) {
                        log.warn("[LLM-Analytics-Processing] Activity log {} has no raw JSON, skipping",
                                        activityLog.getId());
                        // It is claimed at this point - resolve it rather than leaving it in flight
                        // for the stale-claim reaper to pick up half an hour later.
                        markAsFailed(activityLog.getId(), "No raw JSON to analyse");
                        return;
                }

                // Resolve who pays for this call before spending anything on it.
                String instituteId = resolveInstituteId(activityLog);
                if (instituteId == null) {
                        log.warn("[LLM-Analytics-Processing] Could not resolve an institute for activity log {} "
                                        + "(user {}). Processing it unattributed and uncharged.",
                                        activityLog.getId(), activityLog.getUserId());
                } else if (!hasCreditsFor(instituteId, activityLog)) {
                        log.warn("[LLM-Analytics-Processing] Institute {} has insufficient credits - "
                                        + "skipping activity log {} without calling the LLM",
                                        instituteId, activityLog.getId());
                        activityLogRepository.updateProcessedData(activityLog.getId(), null,
                                        STATUS_SKIPPED_NO_CREDITS);
                        return;
                } else if (blockedByUsageLimit(instituteId, activityLog)) {
                        // The limit gate already recorded the refusal; nothing is charged.
                        log.warn("[LLM-Analytics-Processing] AI usage limit reached for institute {} - "
                                        + "skipping activity log {} without calling the LLM",
                                        instituteId, activityLog.getId());
                        totalSkippedByLimitCount.incrementAndGet();
                        activityLogRepository.updateProcessedData(activityLog.getId(), null,
                                        STATUS_SKIPPED_USAGE_LIMIT);
                        return;
                }

                try {
                        long llmStart = System.nanoTime();
                        // Step 1: Call LLM (no DB connection held during this)
                        JsonNode insights = studentAnalyticsLLMService
                                        .generateStudentInsights(activityLog.getRawJson(),
                                                        activityLog.getSourceType(),
                                                        instituteId, activityLog.getUserId())
                                        .block();
                        long llmDurationMs = Duration.ofNanos(System.nanoTime() - llmStart).toMillis();
                        log.info("[LLM-Analytics-Processing] LLM call completed for activity log ID: {} in {} ms",
                                        activityLog.getId(), llmDurationMs);

                        if (insights == null) {
                                throw new RuntimeException("LLM returned null insights");
                        }

                        validateInsights(insights);
                        String processedJson = objectMapper.writeValueAsString(insights);

                        // Step 2: Quick DB update (connection borrowed and returned immediately)
                        long dbStart = System.nanoTime();
                        activityLogRepository.updateProcessedData(activityLog.getId(), processedJson, STATUS_PROCESSED);
                        long dbDurationMs = Duration.ofNanos(System.nanoTime() - dbStart).toMillis();
                        log.debug("[LLM-Analytics-Processing] DB update completed for activity log ID: {} in {} ms",
                                        activityLog.getId(), dbDurationMs);

                        log.info("[LLM-Analytics-Processing] Successfully processed activity log ID: {}",
                                        activityLog.getId());

                } catch (Exception e) {
                        log.error("[LLM-Analytics-Processing] Failed to process activity log ID: {}",
                                        activityLog.getId(), e);
                        markAsFailed(activityLog.getId(), e.getMessage());
                        throw new RuntimeException("Failed to process activity log", e);
                }
        }

        /**
         * Work out which institute owns an activity log.
         *
         * activity_log has no institute_id column, so there are two sources. Assessment
         * submissions arrive from assessment_service, which already derived the institute
         * and embedded it in the enriched payload - that value is authoritative. Everything
         * else (quiz, assignment, question, video and document activity) carries no
         * institute at all, so it is resolved from the learner's enrolment.
         *
         * @return the institute id, or null if neither source yields one
         */
        private String resolveInstituteId(ActivityLogProcessingProjection activityLog) {
                try {
                        JsonNode root = objectMapper.readTree(activityLog.getRawJson());
                        JsonNode embedded = root.get("instituteId");
                        if (embedded != null && embedded.isTextual() && !embedded.asText().isBlank()) {
                                return embedded.asText().trim();
                        }
                } catch (Exception e) {
                        log.debug("[LLM-Analytics-Processing] Could not read instituteId from raw JSON of {}: {}",
                                        activityLog.getId(), e.getMessage());
                }

                String userId = activityLog.getUserId();
                if (userId == null || userId.isBlank()) {
                        return null;
                }

                try {
                        return activityLogRepository.findInstituteIdByUserId(userId).orElse(null);
                } catch (Exception e) {
                        log.warn("[LLM-Analytics-Processing] Failed to resolve institute for user {}: {}",
                                        userId, e.getMessage());
                        return null;
                }
        }

        /**
         * Pre-flight affordability check, so an institute with an empty wallet never has
         * work done on its behalf.
         *
         * {@link CreditClient#checkCredits} fails OPEN - if ai_service is unreachable the
         * log is processed rather than dropped. That is deliberate: a credit-service blip
         * should not silently stop analytics for everyone.
         */
        private boolean hasCreditsFor(String instituteId, ActivityLogProcessingProjection activityLog) {
                int estimatedTokens = (activityLog.getRawJson().length() / CHARS_PER_TOKEN_ESTIMATE)
                                + ESTIMATED_COMPLETION_TOKENS;
                return creditClient.checkCredits(
                                instituteId,
                                RequestType.ANALYTICS.getValue(),
                                studentAnalyticsLLMService.getPrimaryAnalyticsModel(),
                                estimatedTokens,
                                MeteringFields.system("learner_analytics").build());
        }

        /**
         * The AI usage-limit gate (after, and in addition to, the unchanged credit check).
         * A SYSTEM job working for the learner: ai_service checks institute pools, SYSTEM
         * role-class rows and platform rows. No limits on for the institute = no call at
         * all; any failure = allowed.
         */
        private boolean blockedByUsageLimit(String instituteId, ActivityLogProcessingProjection activityLog) {
                try {
                        AuthorizeResult r = creditClient.authorize(instituteId, USE_CASE_LEARNER_ANALYTICS,
                                        RequestType.ANALYTICS.getValue(),
                                        MeteringFields.system(USE_CASE_LEARNER_ANALYTICS)
                                                        .subjectUserId(activityLog.getUserId())
                                                        .build(),
                                        null);
                        return AuthorizeResult.blocks(r);
                } catch (Exception e) {
                        return false;
                }
        }

        private void validateInsights(JsonNode insights) {
                // Validate required fields
                if (!insights.has("performance_analysis")) {
                        throw new RuntimeException("Missing performance_analysis in LLM response");
                }
                if (!insights.has("weaknesses")) {
                        throw new RuntimeException("Missing weaknesses in LLM response");
                }
                if (!insights.has("strengths")) {
                        throw new RuntimeException("Missing strengths in LLM response");
                }
                if (!insights.has("areas_of_improvement")) {
                        throw new RuntimeException("Missing areas_of_improvement in LLM response");
                }
                if (!insights.has("improvement_path")) {
                        throw new RuntimeException("Missing improvement_path in LLM response");
                }
                if (!insights.has("flashcards") || !insights.get("flashcards").isArray()) {
                        throw new RuntimeException("Missing or invalid flashcards in LLM response");
                }
        }

        private void markAsFailed(String activityLogId, String errorMessage) {
                try {
                        // Store error info in processed_json for debugging
                        String errorJson = String.format("{\"error\": \"%s\", \"timestamp\": \"%s\"}",
                                        errorMessage.replace("\"", "\\\""),
                                        java.time.Instant.now().toString());
                        activityLogRepository.updateProcessedData(activityLogId, errorJson, STATUS_FAILED);

                        log.info("[LLM-Analytics-Processing] Marked activity log {} as failed", activityLogId);
                } catch (Exception e) {
                        log.error("[LLM-Analytics-Processing] Failed to mark activity log {} as failed",
                                        activityLogId, e);
                }
        }

        /**
         * Manual trigger to process all raw logs (for testing or manual processing)
         */
        public void processAllRawLogsManually() {
                log.info("[LLM-Analytics-Manual] Manual processing triggered");
                processRawActivityLogs();
        }

        /**
         * Process the latest activity log for a user + source (assessment)
         * synchronously, on demand. Triggered when a learner opens the AI report and no
         * processed report exists yet, so they don't have to wait for the hourly
         * scheduler.
         *
         * @return the activity log after processing (status 'processed' on success,
         *         'failed' on LLM error), or {@code null} if no row exists for this
         *         user + source (e.g. submission data was never captured).
         */
        public ActivityLog processOnDemand(String userId, String sourceId) {
                log.info("[LLM-Analytics-OnDemand] Triggered for userId: {}, sourceId: {}", userId, sourceId);

                List<ActivityLog> logs = activityLogRepository
                                .findByUserIdAndSourceIdOrderByCreatedAtDesc(userId, sourceId);

                if (logs.isEmpty()) {
                        log.warn("[LLM-Analytics-OnDemand] No activity log found for userId: {}, sourceId: {}",
                                        userId, sourceId);
                        return null;
                }

                ActivityLog activityLog = logs.get(0);

                // Already processed by the scheduler (or a previous on-demand call) — return
                // as-is, don't spend another LLM call.
                if (STATUS_PROCESSED.equalsIgnoreCase(activityLog.getStatus())) {
                        log.info("[LLM-Analytics-OnDemand] Activity log {} already processed, returning cached result",
                                        activityLog.getId());
                        return activityLog;
                }

                // Process synchronously (raw or failed -> retry). processActivityLog updates
                // the row in place and marks it failed on error.
                try {
                        processActivityLog(toProcessingProjection(activityLog));
                } catch (Exception e) {
                        log.error("[LLM-Analytics-OnDemand] On-demand processing failed for activity log {}",
                                        activityLog.getId(), e);
                        // processActivityLog already marked the row as failed; fall through to
                        // re-fetch.
                }

                return activityLogRepository.findById(activityLog.getId()).orElse(activityLog);
        }

        /**
         * Adapt a full {@link ActivityLog} entity into the lightweight projection that
         * {@link #processActivityLog} consumes.
         */
        private ActivityLogProcessingProjection toProcessingProjection(ActivityLog activityLog) {
                return new ActivityLogProcessingProjection() {
                        @Override
                        public String getId() {
                                return activityLog.getId();
                        }

                        @Override
                        public String getUserId() {
                                return activityLog.getUserId();
                        }

                        @Override
                        public String getSourceType() {
                                return activityLog.getSourceType();
                        }

                        @Override
                        public String getRawJson() {
                                return activityLog.getRawJson();
                        }

                        @Override
                        public String getProcessedJson() {
                                return activityLog.getProcessedJson();
                        }

                        @Override
                        public String getStatus() {
                                return activityLog.getStatus();
                        }

                        @Override
                        public LocalDateTime getCreatedAt() {
                                return activityLog.getCreatedAt() != null
                                                ? activityLog.getCreatedAt().toLocalDateTime()
                                                : null;
                        }
                };
        }

        /**
         * Process a specific activity log by ID (for manual retry)
         */
        public void reprocessActivityLog(String activityLogId) {
                log.info("[LLM-Analytics-Manual] Manual reprocess triggered for activity log ID: {}", activityLogId);

                ActivityLog activityLog = activityLogRepository.findById(activityLogId)
                                .orElseThrow(() -> new RuntimeException("Activity log not found: " + activityLogId));

                // Reset status to raw to allow reprocessing
                activityLog.setStatus(STATUS_RAW);
                activityLogRepository.save(activityLog);

                processActivityLog(toProcessingProjection(activityLog));
        }

        /**
         * Get scheduler status and metrics
         */
        public Map<String, Object> getSchedulerStatus() {
                Map<String, Object> status = new HashMap<>();
                status.put("schedulerEnabled", true);
                status.put("cronExpression", "0 0 * * * * (Every hour at minute 0)");
                status.put("lastRunTime", lastRunTime.get() != null ? lastRunTime.get().toString() : "Never run");
                status.put("nextRunTime", nextRunTime.get() != null ? nextRunTime.get().toString() : "In next hour");
                status.put("totalProcessedCount", totalProcessedCount.get());
                status.put("totalFailedCount", totalFailedCount.get());

                // Get current queue size
                long rawCount = activityLogRepository.countByStatus(STATUS_RAW);
                long processedCount = activityLogRepository.countByStatus(STATUS_PROCESSED);
                long failedCount = activityLogRepository.countByStatus(STATUS_FAILED);

                status.put("currentQueueSize", rawCount);
                status.put("processedInDB", processedCount);
                status.put("failedInDB", failedCount);

                return status;
        }
}
