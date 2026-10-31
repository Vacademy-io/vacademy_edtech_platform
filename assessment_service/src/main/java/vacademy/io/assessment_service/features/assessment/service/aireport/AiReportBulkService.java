package vacademy.io.assessment_service.features.assessment.service.aireport;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.service.AssessmentDataEnrichmentService;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Generates the AI analysis for every submitted learner of an assessment who does not have
 * one yet, a few at a time. Each one that is generated spends the institute's AI credits
 * (charged by admin_core), so callers dry-run first to see the count.
 *
 * <p>Learners without a raw activity log (the submit-time hand-off to admin_core never
 * landed) get one rebuilt from their attempt first, exactly as on submit.
 */
@Slf4j
@Service
public class AiReportBulkService {

    private final JdbcTemplate jdbc;
    private final AdminCoreServiceClient adminCore;
    private final AssessmentDataEnrichmentService enrichment;
    private final StudentAttemptRepository attempts;
    private final AssessmentRepository assessments;

    private final Map<String, Job> jobs = new ConcurrentHashMap<>();

    public AiReportBulkService(JdbcTemplate jdbc, AdminCoreServiceClient adminCore, AssessmentDataEnrichmentService enrichment,
                               StudentAttemptRepository attempts, AssessmentRepository assessments) {
        this.jdbc = jdbc;
        this.adminCore = adminCore;
        this.enrichment = enrichment;
        this.attempts = attempts;
        this.assessments = assessments;
    }

    public static class Job {
        public final String id = UUID.randomUUID().toString();
        public final String assessmentId;
        public final boolean dryRun;
        public final boolean regenerateAll;
        public final AtomicInteger total = new AtomicInteger();
        public final AtomicInteger checked = new AtomicInteger();
        public final AtomicInteger alreadyHad = new AtomicInteger();
        public final AtomicInteger missing = new AtomicInteger();
        public final AtomicInteger generated = new AtomicInteger();
        public final AtomicInteger failed = new AtomicInteger();
        public final List<String> failures = Collections.synchronizedList(new ArrayList<>());
        public volatile String state = "RUNNING";
        public final Date startedAt = new Date();
        public volatile Date finishedAt;

        Job(String assessmentId, boolean dryRun, boolean regenerateAll) {
            this.assessmentId = assessmentId;
            this.dryRun = dryRun;
            this.regenerateAll = regenerateAll;
        }

        public Map<String, Object> view() {
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("job_id", id);
            v.put("assessment_id", assessmentId);
            v.put("dry_run", dryRun);
            v.put("mode", regenerateAll ? "ALL" : "MISSING");
            v.put("state", state);
            v.put("submitted_learners", total.get());
            v.put("checked", checked.get());
            v.put("already_had_ai_report", alreadyHad.get());
            v.put("missing", missing.get());
            v.put("generated", generated.get());
            v.put("failed", failed.get());
            v.put("failures", failures.size() > 20 ? failures.subList(0, 20) : failures);
            v.put("started_at", startedAt);
            v.put("finished_at", finishedAt);
            return v;
        }
    }

    public Map<String, Object> status(String jobId) {
        Job job = jobs.get(jobId);
        return job == null ? null : job.view();
    }

    /**
     * @param regenerateAll false: only learners without an analysis. true: everyone, rebuilt
     *                      from current data (fixes analyses written before marks/ranks settled).
     * @param onlyAttemptIds when non-empty, only these attempts (to try one before the rest)
     */
    public Map<String, Object> start(String assessmentId, String instituteId, boolean dryRun, int concurrency, Integer limit,
                                     boolean regenerateAll, Set<String> onlyAttemptIds) {
        Assessment assessment = assessments.findById(assessmentId)
                .orElseThrow(() -> new IllegalArgumentException("Assessment not found"));
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT x.attempt_id, x.user_id FROM (
                    SELECT sa.id AS attempt_id, aur.user_id,
                           ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    WHERE aur.assessment_id = ? AND aur.institute_id = ? AND sa.status = 'ENDED' AND aur.status = 'ACTIVE'
                ) x WHERE x.rn = 1
                """, assessmentId, instituteId);
        if (onlyAttemptIds != null && !onlyAttemptIds.isEmpty()) {
            rows = rows.stream().filter(r -> onlyAttemptIds.contains((String) r.get("attempt_id"))).toList();
        }
        Job job = new Job(assessmentId, dryRun, regenerateAll);
        job.total.set(rows.size());
        jobs.put(job.id, job);

        int threads = Math.max(1, Math.min(concurrency, 8));
        ExecutorService pool = Executors.newFixedThreadPool(threads, r -> {
            Thread t = new Thread(r, "ai-report-bulk-" + job.id.substring(0, 8));
            t.setDaemon(true);
            return t;
        });
        AtomicInteger budget = new AtomicInteger(limit != null && limit > 0 ? limit : Integer.MAX_VALUE);
        List<Future<?>> futures = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String attemptId = (String) row.get("attempt_id");
            String userId = (String) row.get("user_id");
            futures.add(pool.submit(() -> handle(job, assessment, attemptId, userId, budget)));
        }
        pool.shutdown();
        Thread watcher = new Thread(() -> {
            try {
                pool.awaitTermination(12, TimeUnit.HOURS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            job.state = "DONE";
            job.finishedAt = new Date();
            log.info("[ai-report-bulk] job {} done: {}", job.id, job.view());
        }, "ai-report-bulk-watch");
        watcher.setDaemon(true);
        watcher.start();
        return job.view();
    }

    private void handle(Job job, Assessment assessment, String attemptId, String userId, AtomicInteger budget) {
        try {
            String existing = adminCore.getProcessedAIReport(userId, assessment.getId());
            boolean has = existing != null && !existing.isBlank();
            if (has) job.alreadyHad.incrementAndGet();
            else job.missing.incrementAndGet();
            if (has && !job.regenerateAll) return;
            if (job.dryRun || budget.decrementAndGet() < 0) return;

            StudentAttempt attempt = attempts.findById(attemptId).orElse(null);
            if (attempt == null) throw new IllegalStateException("attempt not found");
            String instituteId = attempt.getRegistration() != null ? attempt.getRegistration().getInstituteId() : null;
            // Rebuild the raw log exactly as submit does, then generate it now.
            Map<String, Object> data = enrichment.buildEnrichedAssessmentData(attempt, assessment.getId(), assessment.getName(),
                    assessment.getAssessmentType(), assessment.getDuration(), 0, instituteId);
            adminCore.saveAssessmentRawDataAsync(data);
            AdminCoreServiceClient.AiReportGenerationResult result = adminCore.generateAiReportOnDemand(userId, assessment.getId());
            // "generating" = admin_core is still running the model after our read timeout; it
            // saves the result itself, so that counts as generated.
            if (result != null && (result.isProcessed() || "generating".equals(result.status()))) {
                job.generated.incrementAndGet();
            } else {
                job.failed.incrementAndGet();
                job.failures.add(attemptId + ": " + (result == null ? "no response" : result.status()));
            }
        } catch (Exception e) {
            job.failed.incrementAndGet();
            job.failures.add(attemptId + ": " + e.getMessage());
            log.warn("[ai-report-bulk] attempt {} failed: {}", attemptId, e.getMessage());
        } finally {
            job.checked.incrementAndGet();
        }
    }
}
